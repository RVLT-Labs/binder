import type { PowerSyncDatabase, WatchedQuery } from '@powersync/web'

/** Coordinate local writers with sign-out. Web Locks also serialize cooperating tabs. */
let paused = false
let owner: string | null = null
let generation = 0
let exclusiveHeld = false
let endingClaim: {
  userId: string
  epoch: number
  ticket: string | null
  revokedTicket: string
} | null = null
const resumed = new Set<() => void>()
const active = new Set<Promise<unknown>>()
const LOCK = 'binder-local-data'

function storageOwner(): string | null {
  try {
    return localStorage.getItem('binder.localDbOwner')
  } catch {
    return null
  }
}

let verifiedTicket: string | null = null
const claims = new WeakMap<
  object,
  {
    userId: string
    epoch: number
    ticket: string | null
    valid: boolean
    database: object
    dispose?: () => void
  }
>()

function storageTicket(): string | null {
  try {
    // Legacy markers used the upload namespace as the claim ticket. New claims separate
    // the two so revocation cannot change the replay identity of retained CRUD uploads.
    return (
      localStorage.getItem('binder.localDbClaim') ?? localStorage.getItem('binder.localDbDevice')
    )
  } catch {
    return null
  }
}

function assertOwner(
  userId?: string,
  epoch = generation,
  ticket = verifiedTicket,
  inFlight = false,
) {
  if (
    (!inFlight && paused) ||
    epoch !== generation ||
    (userId && (userId !== owner || userId !== storageOwner())) ||
    ticket !== storageTicket()
  ) {
    throw new Error(
      'Local work is paused for sign-out or this session has changed. Try again after signing in.',
    )
  }
}

/** Track the entire operation, including generation and persistence, before any awaits. */
export function runLocalWork<T>(work: () => Promise<T>, userId?: string): Promise<T> {
  const epoch = generation
  const ticket = verifiedTicket
  const execute = () => {
    // A queued cross-tab operation must recheck ownership after acquiring its shared lock.
    assertOwner(userId, epoch, ticket, true)
    return work()
  }
  try {
    assertOwner(userId, epoch, ticket)
    const locks = globalThis.navigator?.locks
    const task = Promise.resolve(
      locks ? locks.request(LOCK, { mode: 'shared' }, execute) : execute(),
    )
    active.add(task)
    void task.then(
      () => active.delete(task),
      () => active.delete(task),
    )
    return task
  } catch (error) {
    return Promise.reject(error)
  }
}

/** Stop new writers, await existing ones, then hold an exclusive lock through the final clear. */
export async function quiesceLocalWork(wait = false): Promise<() => Promise<void>> {
  while (paused && wait) await new Promise<void>((resolve) => resumed.add(resolve))
  if (paused) throw new Error('Sign-out is already in progress.')
  const locks = globalThis.navigator?.locks
  if (!locks) {
    throw new Error(
      'Web Locks are unavailable; cross-tab exclusion cannot be established. Nothing was removed.',
    )
  }
  paused = true
  await Promise.allSettled([...active])
  let unlock = () => {}
  let lockDone = Promise.resolve()
  const release = async () => {
    exclusiveHeld = false
    paused = false
    unlock()
    await lockDone.catch(() => {})
    for (const resolve of resumed) resolve()
    resumed.clear()
  }
  try {
    if (locks) {
      await new Promise<void>((resolve, reject) => {
        lockDone = locks
          .request(
            LOCK,
            { mode: 'exclusive' },
            () =>
              new Promise<void>((done) => {
                exclusiveHeld = true
                unlock = done
                resolve()
              }),
          )
          .then(
            () => {},
            (error) => {
              reject(error)
            },
          )
      })
    }
    return release
  } catch (error) {
    await release()
    throw error
  }
}

export function activateLocalUser(userId: string): void {
  if (owner !== userId) generation++
  if (storageOwner() !== userId || storageTicket() === null) {
    throw new Error('The local database owner could not be verified.')
  }
  owner = userId
  verifiedTicket = storageTicket()
  endingClaim = null
}

export function endLocalSession(): void {
  if (owner) {
    // Revoke other tabs' original claims immediately after server sign-out, while retaining
    // the owner marker so a failed clear can still be recovered by that same account.
    if (storageOwner() === owner && storageTicket() === verifiedTicket) {
      const revokedTicket = crypto.randomUUID()
      localStorage.setItem('binder.localDbClaim', revokedTicket)
      endingClaim = { userId: owner, epoch: generation, ticket: verifiedTicket, revokedTicket }
    }
    owner = ''
    generation++
  }
}

/** Only the exclusive sign-out holder can count CRUD after auth teardown disposes the facade.
 * This fixed query returns no account rows and never restores ordinary read/export access. */
export async function countLocalUploadsForSignOut(db: object, userId: string): Promise<number> {
  const claim = claims.get(db)
  const check = () => {
    if (!exclusiveHeld || !claim || claim.userId !== userId || storageOwner() !== userId)
      throw new Error('The sign-out database owner could not be verified.')
    const ticket = storageTicket()
    const current = owner === userId && generation === claim.epoch && ticket === claim.ticket
    const ending =
      owner === '' &&
      generation === claim.epoch + 1 &&
      endingClaim?.userId === userId &&
      endingClaim.epoch === claim.epoch &&
      endingClaim.ticket === claim.ticket &&
      endingClaim.revokedTicket === ticket
    if (!current && !ending) throw new Error('The sign-out database session has changed.')
  }
  check()
  const raw = claim?.database as Pick<PowerSyncDatabase, 'get'>
  const result = await raw.get<{ n: number }>('SELECT count(*) AS n FROM ps_crud')
  check()
  return result.n
}

/** A cache producer keeps this original claim across network waits and account changes. */
export function captureLocalCacheWork() {
  const userId = owner ?? undefined
  const epoch = generation
  const ticket = verifiedTicket
  const check = () => assertOwner(userId, epoch, ticket)
  const checkClaim = () => assertOwner(userId, epoch, ticket, true)
  return {
    check,
    checkClaim,
    async commit<T>(work: () => Promise<T>): Promise<T> {
      check()
      const execute = async (lock: Lock | null) => {
        if (!lock) throw new Error('Local storage is busy changing sessions. Try again.')
        check()
        return work()
      }
      const locks = globalThis.navigator?.locks
      // Never queue a nested shared lock behind an exclusive waiter: an export may already
      // hold the outer shared lock. A skipped cache copy is retried; it never blocks sign-out.
      const task = locks
        ? locks.request(LOCK, { mode: 'shared', ifAvailable: true }, execute)
        : execute({} as Lock)
      active.add(task)
      try {
        return await task
      } finally {
        active.delete(task)
      }
    },
    subscribe(invalidate: () => void) {
      const onStorage = () => {
        try {
          checkClaim()
        } catch {
          invalidate()
        }
      }
      window.addEventListener('storage', onStorage)
      window.addEventListener('focus', onStorage)
      return () => {
        window.removeEventListener('storage', onStorage)
        window.removeEventListener('focus', onStorage)
      }
    },
  }
}

/** Account-bound work must start from a verified local claim, never a remembered server user. */
export function captureLocalAccountWork(userId = owner) {
  if (!userId || owner !== userId) throw new Error('Local account session has changed.')
  const claim = captureLocalCacheWork()
  claim.check()
  return {
    ...claim,
    userId,
    run<T>(work: () => Promise<T>): Promise<T> {
      claim.check()
      return runLocalWork(async () => {
        claim.checkClaim()
        return work()
      }, userId)
    },
  }
}

/** Exports use the original provider claim, even if another claim has since been activated. */
export function runDatabaseWork<T>(db: object, userId: string, work: () => Promise<T>): Promise<T> {
  try {
    assertDatabaseOwner(db, userId)
  } catch (error) {
    return Promise.reject(error)
  }
  return runLocalWork(async () => {
    assertDatabaseOwner(db, userId)
    return work()
  }, userId)
}

/** Check the facade's verified claim again before an export downloads or persists its bytes. */
export function assertDatabaseOwner(db: object, userId: string): void {
  const claim = claims.get(db)
  if (!claim?.valid || claim.userId !== userId)
    throw new Error('Local database session has changed.')
  assertOwner(userId, claim.epoch, claim.ticket, true)
}

export function disposeLocalDatabase(db: object): void {
  claims.get(db)?.dispose?.()
}

/** Notifies on storage transitions and on returning to a suspended tab. Never claims a new owner. */
export function onLocalClaimInvalidated(db: object, invalidate: () => void): () => void {
  const claim = claims.get(db)
  const check = () => {
    try {
      if (!claim?.valid) throw new Error('No verified claim')
      assertOwner(claim.userId, claim.epoch, claim.ticket, true)
    } catch {
      invalidate()
    }
  }
  window.addEventListener('storage', check)
  window.addEventListener('focus', check)
  window.addEventListener('pageshow', check)
  return () => {
    window.removeEventListener('storage', check)
    window.removeEventListener('focus', check)
    window.removeEventListener('pageshow', check)
  }
}

/** Guard reads and retained capabilities; invoke SDK methods on their original receivers. */
export function guardLocalDatabase<T extends object>(db: T, userId: string): T {
  const epoch = generation
  const ticket = verifiedTicket
  const claim = { userId, epoch, ticket, database: db, valid: true, dispose: () => {} }
  const check = () => {
    if (!claim.valid) throw new Error('Local database session has changed.')
    assertOwner(userId, epoch, ticket, true)
  }
  const read = async (work: () => unknown) => {
    check()
    const result = await work()
    check()
    return result
  }
  // Completion is a later mutation, not part of fetching the batch. Register it before
  // yielding, and recheck this facade's original claim after the lifecycle lock is acquired.
  const completion = (result: unknown): unknown => {
    if (!result || typeof result !== 'object') return result
    return new Proxy(result, {
      get(batch, key) {
        const value = Reflect.get(batch, key, batch)
        if (key === 'complete' && typeof value === 'function')
          return (...args: unknown[]) =>
            runDatabaseWork(facade, userId, async () => value.apply(batch, args))
        return typeof value === 'function' ? value.bind(batch) : value
      },
    })
  }
  const databaseCallback = (callback: (context: object) => unknown) => async (context: object) => {
    check()
    let open = true
    const contextRead = (work: () => unknown) =>
      read(() => {
        if (!open) throw new Error('Local database callback has ended.')
        return work()
      })
    const guarded = new Proxy(context, {
      get(target, key) {
        const value = Reflect.get(target, key, target)
        if (typeof value !== 'function') return value
        // The enclosing callback already holds lifecycle exclusion, before its SDK lease.
        // Reacquiring shared here can queue behind an exclusive waiter and deadlock both.
        return (...args: unknown[]) => contextRead(() => value.apply(target, args))
      },
    })
    try {
      const result = await callback(guarded)
      check()
      return result
    } finally {
      open = false
    }
  }
  const closers = new Set<() => void>()
  const controller = new AbortController()
  const invalidate = () => {
    if (!claim.valid) return
    claim.valid = false
    controller.abort()
    for (const close of closers) close()
    closers.clear()
    unsubscribe()
  }
  const handler = (callbacks: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(callbacks).map(([name, callback]) => [
        name,
        typeof callback === 'function'
          ? (...args: unknown[]) => {
              try {
                check()
              } catch {
                invalidate()
                return
              }
              return callback(...args)
            }
          : callback,
      ]),
    )
  const iterable = (source: AsyncIterable<unknown>, crud = false): AsyncIterable<unknown> => ({
    async *[Symbol.asyncIterator]() {
      check()
      for await (const value of source) {
        check()
        yield crud ? completion(value) : value
      }
    },
  })
  const facade = new Proxy(db, {
    get(target, key) {
      const value = Reflect.get(target, key, target)
      if (typeof value !== 'function') return value
      if (['readLock', 'readTransaction', 'writeLock', 'writeTransaction'].includes(String(key))) {
        return (callback: (context: object) => unknown, ...args: unknown[]) =>
          runDatabaseWork(facade, userId, async () =>
            value.call(target, databaseCallback(callback), ...args),
          )
      }
      if (key === 'getCrudBatch' || key === 'getNextCrudTransaction')
        return (...args: unknown[]) => read(() => value.apply(target, args)).then(completion)
      if (key === 'getCrudTransactions')
        return (...args: unknown[]) => {
          check()
          return iterable(value.apply(target, args), true)
        }
      if (key === 'execute' || key === 'executeRaw' || key === 'executeBatch') {
        return (...args: unknown[]) =>
          runDatabaseWork(facade, userId, async () => value.apply(target, args))
      }
      if (
        [
          'getAll',
          'get',
          'getOptional',
          'getUploadQueueStats',
          'getClientId',
          'executeReadOnly',
          'resolveTables',
        ].includes(String(key))
      ) {
        return (...args: unknown[]) => read(() => value.apply(target, args))
      }
      if (key === 'query' || key === 'customQuery') {
        return (
          input: Parameters<PowerSyncDatabase['customQuery']>[0] &
            Parameters<PowerSyncDatabase['query']>[0],
        ) => {
          const real = target as unknown as PowerSyncDatabase
          const query =
            key === 'customQuery'
              ? input
              : {
                  compile: () => ({ sql: input.sql, parameters: input.parameters ?? [] }),
                  execute: async () => {
                    const rows = await real.getAll<Record<string, unknown>>(input.sql, [
                      ...(input.parameters ?? []),
                    ])
                    return input.mapper ? rows.map(input.mapper) : rows
                  },
                }
          const build = () =>
            real.customQuery({
              compile: () => {
                check()
                return query.compile()
              },
              execute: (options) => read(() => query.execute(options)) as Promise<unknown[]>,
            })
          return new Proxy(
            {},
            {
              get(_q, method) {
                if (method !== 'watch' && method !== 'differentialWatch') return undefined
                return (...args: unknown[]) => {
                  // Installed useQuery creates watches in passive effects, which can reconnect
                  // after revocation. Return an already-closed subscription, never a new SDK
                  // capability. Building a query is lazy; its execution remains claim-checked.
                  try {
                    check()
                  } catch {
                    invalidate()
                    return {
                      closed: true,
                      listenerMeta: {
                        counts: { total: 0 },
                        registerListener: () => () => {},
                      },
                      state: {
                        data: [],
                        isLoading: false,
                        isFetching: false,
                        error: null,
                        lastUpdated: null,
                      },
                      registerListener: () => () => {},
                      updateSettings: async () => {},
                      close: async () => {},
                    } satisfies WatchedQuery<unknown[]>
                  }
                  const built = build()
                  const watched = Reflect.apply(Reflect.get(built, method, built), built, args)
                  const close = () => watched.close()
                  closers.add(close)
                  watched.registerListener({
                    closed: () => {
                      closers.delete(close)
                    },
                  })
                  return watched
                }
              },
            },
          )
        }
      }
      if (
        [
          'watch',
          'watchWithCallback',
          'watchWithAsyncGenerator',
          'onChange',
          'onChangeWithCallback',
          'onChangeWithAsyncGenerator',
        ].includes(String(key))
      ) {
        return (...args: unknown[]) => {
          check()
          const change = String(key).startsWith('onChange')
          const index = change ? 0 : 2
          const callbacks = args[index] as Record<string, unknown> | undefined
          const hasHandler =
            callbacks &&
            (typeof callbacks.onResult === 'function' || typeof callbacks.onChange === 'function')
          const optionsIndex = hasHandler ? index + 1 : index
          if (hasHandler) args[index] = handler(callbacks)
          const options = (args[optionsIndex] ?? {}) as { signal?: AbortSignal }
          args[optionsIndex] = {
            ...options,
            signal: options.signal
              ? AbortSignal.any([options.signal, controller.signal])
              : controller.signal,
          }
          const result = value.apply(target, args)
          if (typeof result === 'function') closers.add(result)
          return result?.[Symbol.asyncIterator] ? iterable(result) : result
        }
      }
      if (key === 'registerListener')
        return (callbacks: Record<string, unknown>) => {
          // React can reconnect passive effects after the provider revokes this facade.
          // A stale subscription grants no capability: do not attach it to the shared SDK.
          try {
            check()
          } catch {
            invalidate()
            return () => {}
          }
          const dispose = value.call(target, handler(callbacks))
          closers.add(dispose)
          return () => {
            closers.delete(dispose)
            dispose()
          }
        }
      return (...args: unknown[]) => {
        check()
        const result = value.apply(target, args)
        if (result?.[Symbol.asyncIterator]) return iterable(result)
        if (result && typeof result.then === 'function')
          return result.then((answer: unknown) => {
            check()
            return answer
          })
        check()
        return result
      }
    },
  })
  claim.dispose = invalidate
  claims.set(facade, claim)
  const unsubscribe = onLocalClaimInvalidated(facade, invalidate)
  return facade
}
