import { createRequire } from 'node:module'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import {
  DBAdapter,
  LockContext,
  PowerSyncDatabase,
  type RawQueryResult,
  type Transaction,
} from '@powersync/web'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  activateLocalUser,
  disposeLocalDatabase,
  endLocalSession,
  guardLocalDatabase,
  quiesceLocalWork,
} from '../auth/localWork'
import { ApiConnector } from './connector'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// Installed PowerSync methods, CRUD classes, bucket completion and transaction implementation;
// only the platform SQLite adapter is supplied here. This never opens a browser DB or a service.
class MemoryContext extends LockContext {
  beforeRead: (() => Promise<void>) | undefined
  constructor(readonly sqlite: DatabaseSync) {
    super()
  }
  async executeRaw(sql: string, parameters: SQLInputValue[] = []): Promise<RawQueryResult> {
    if (sql.includes('private_rows')) await this.beforeRead?.()
    const statement = this.sqlite.prepare(sql)
    const columns = statement.columns().map((column) => column.name)
    if (columns.length) {
      const rows = statement.all(...parameters)
      return { columnNames: columns, rawRows: rows.map((row) => columns.map((c) => row[c])) }
    }
    const result = statement.run(...parameters)
    return { columnNames: [], rawRows: [], rowsAffected: Number(result.changes) }
  }
}
class MemoryAdapter extends DBAdapter {
  readonly name = 'round3-disposable-memory'
  readonly sqlite = new DatabaseSync(':memory:')
  readonly context = new MemoryContext(this.sqlite)
  readonly checkpoints: unknown[][] = []
  beforeLock: (() => Promise<void>) | undefined
  beforeWrite: (() => Promise<void>) | undefined
  constructor() {
    super()
    this.sqlite.exec(`CREATE TABLE ps_crud(id INTEGER PRIMARY KEY, tx_id INTEGER, data TEXT);
      CREATE TABLE private_rows(title TEXT); INSERT INTO private_rows VALUES ('synthetic A');`)
    // The extension checkpoint scalar is irrelevant to queue deletion; keep it local and inert.
    this.sqlite.function('powersync_control', (operation, payload) => {
      this.checkpoints.push([operation, payload])
      return null
    })
    this.replaceQueue('A')
  }
  replaceQueue(account: string) {
    this.sqlite.exec('DELETE FROM ps_crud')
    this.sqlite.prepare('INSERT INTO ps_crud VALUES (1, 7, ?)').run(
      JSON.stringify({
        op: 'PUT',
        type: 'shows',
        id: `synthetic-${account}`,
        data: { title: account },
      }),
    )
  }
  async readLock<T>(callback: (ctx: LockContext) => Promise<T>) {
    expect(this).toBeInstanceOf(MemoryAdapter)
    return navigator.locks.request('round4-sdk-sqlite', { mode: 'exclusive' }, async () => {
      await this.beforeLock?.()
      return callback(this.context)
    })
  }
  async writeLock<T>(callback: (ctx: LockContext) => Promise<T>) {
    return navigator.locks.request('round4-sdk-sqlite', { mode: 'exclusive' }, async () => {
      await this.beforeWrite?.()
      return callback(this.context)
    })
  }
  async refreshSchema() {}
  close() {
    this.sqlite.close()
  }
}
function installedDatabase(adapter: DBAdapter): PowerSyncDatabase {
  // Test-only initialization of the installed prototype without its worker/files. The package's
  // public .d.ts intentionally hides these implementation fields; production never accesses them.
  const db = Object.create(PowerSyncDatabase.prototype)
  db.ready = true
  db._isReadyPromise = Promise.resolve()
  db._database = adapter
  db.bucketStorageAdapter = db.generateBucketStorageAdapter()
  return db
}
let adapter: MemoryAdapter
let db: PowerSyncDatabase
let raw: PowerSyncDatabase
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('binder.localDbOwner', 'A')
  localStorage.setItem('binder.localDbDevice', 'original-A')
  activateLocalUser('A')
  adapter = new MemoryAdapter()
  raw = installedDatabase(adapter)
  db = guardLocalDatabase(raw, 'A')
})
afterEach(() => {
  disposeLocalDatabase(db)
  adapter.close()
})

async function capability(kind: 'batch' | 'transaction' | 'iterator') {
  const iterable = db.getCrudTransactions()
  expect(iterable).not.toBeInstanceOf(Promise)
  const result =
    kind === 'batch'
      ? await db.getCrudBatch()
      : kind === 'transaction'
        ? await db.getNextCrudTransaction()
        : (await iterable[Symbol.asyncIterator]().next()).value
  if (!result) throw new Error('Expected the synthetic CRUD handle')
  return result
}

test.each(['batch', 'transaction', 'iterator'] as const)(
  'round3 retained installed SDK %s completion cannot delete a replacement queue',
  async (kind) => {
    const handle = await capability(kind)
    expect(handle.crud[0].id).toBe('synthetic-A')
    const complete = handle.complete // Captured before revocation, as an uploader would do.
    disposeLocalDatabase(db)
    adapter.replaceQueue('B') // Numeric id deliberately overlaps the retained completion.
    localStorage.setItem('binder.localDbOwner', 'B')
    localStorage.setItem('binder.localDbDevice', 'replacement-B')
    activateLocalUser('B')
    await expect(complete('123')).rejects.toThrow(/session has changed/)
    expect(adapter.sqlite.prepare('SELECT count(*) AS n FROM ps_crud').get()?.n).toBe(1)
  },
)

test('round3 completion registers before yielding, drains before sign-out and preserves SDK checkpoint deletion', async () => {
  const handle = await capability('batch')
  const started = deferred()
  const finish = deferred()
  adapter.beforeWrite = async () => {
    started.resolve()
    await finish.promise
  }
  const pending = handle.complete('123')
  await started.promise
  let acquired = false
  const draining = quiesceLocalWork().then((release) => {
    acquired = true
    return release
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  try {
    expect(acquired).toBe(false)
  } finally {
    finish.resolve()
    await pending
    const release = await draining
    await release()
  }
  expect(adapter.sqlite.prepare('SELECT count(*) AS n FROM ps_crud').get()?.n).toBe(0)
})

test.each(['readLock', 'readTransaction'] as const)(
  'round3 delayed installed SDK %s never enters a stale callback',
  async (method) => {
    const finish = deferred()
    adapter.beforeLock = () => finish.promise
    const callback = vi.fn(async (ctx: LockContext) => ctx.getAll('SELECT * FROM private_rows'))
    const pending = db[method](callback)
    disposeLocalDatabase(db)
    finish.resolve()
    await expect(pending).rejects.toThrow(/session has changed/)
    expect(callback).not.toHaveBeenCalled()
  },
)

test.each(['readLock', 'readTransaction'] as const)(
  'round3 %s checks after each pending context read before callback consumes rows',
  async (method) => {
    const started = deferred()
    const finish = deferred()
    adapter.context.beforeRead = async () => {
      started.resolve()
      await finish.promise
    }
    const consume = vi.fn()
    const pending = db[method](async (ctx) => {
      consume(await ctx.getAll('SELECT * FROM private_rows'))
    })
    await started.promise
    disposeLocalDatabase(db)
    finish.resolve()
    await expect(pending).rejects.toThrow(/session has changed/)
    expect(consume).not.toHaveBeenCalled()
  },
)

test.each(['readLock', 'readTransaction'] as const)(
  'round3 %s keeps SDK receiver, rollback and callback lifetime; retained reads expire',
  async (method) => {
    let retained!: LockContext
    expect(
      await db[method](async (ctx) => {
        retained = ctx
        expect(await ctx.get<{ title: string }>('SELECT * FROM private_rows')).toEqual({
          title: 'synthetic A',
        })
        return 'callback-result'
      }),
    ).toBe('callback-result')
    expect(adapter.sqlite.isTransaction).toBe(false)
    await expect(retained.getAll('SELECT * FROM private_rows')).rejects.toThrow(/session|callback/)
  },
)

test('round3 read transaction rejection rolls back using the installed SDK after claim revocation', async () => {
  const pending = db.readTransaction(async (tx: Transaction) => {
    await tx.execute("INSERT INTO private_rows VALUES ('temporary')")
    disposeLocalDatabase(db)
    await tx.getAll('SELECT * FROM private_rows')
  })
  await expect(pending).rejects.toThrow(/session has changed/)
  expect(adapter.sqlite.isTransaction).toBe(false)
  expect(adapter.sqlite.prepare('SELECT count(*) AS n FROM private_rows').get()?.n).toBe(1)
})

test.each(['batch', 'transaction', 'iterator'] as const)(
  'round3 installed %s completes normally with its original checkpoint and Promise return',
  async (kind) => {
    const handle = await capability(kind)
    const pending = handle.complete('123')
    expect(pending).toBeInstanceOf(Promise)
    await pending
    expect(adapter.sqlite.prepare('SELECT count(*) AS n FROM ps_crud').get()?.n).toBe(0)
  },
)

test.each(['batch', 'transaction', 'iterator'] as const)(
  'round3 %s completion keeps the original claim even after same-user reactivation without events',
  async (kind) => {
    const handle = await capability(kind)
    localStorage.setItem('binder.localDbClaim', 'replacement-A')
    activateLocalUser('A')
    await expect(handle.complete('123')).rejects.toThrow(/session has changed/)
    expect(adapter.sqlite.prepare('SELECT count(*) AS n FROM ps_crud').get()?.n).toBe(1)
  },
)

test('round3 completion queued behind a cooperating exclusive lock rechecks before mutation', async () => {
  const handle = await capability('batch')
  const started = deferred()
  const finish = deferred()
  const exclusive = navigator.locks.request(
    'binder-local-data',
    { mode: 'exclusive' },
    async () => {
      started.resolve()
      await finish.promise
    },
  )
  await started.promise
  const pending = handle.complete('123')
  disposeLocalDatabase(db)
  finish.resolve()
  await exclusive
  await expect(pending).rejects.toThrow(/session has changed/)
  expect(adapter.sqlite.prepare('SELECT count(*) AS n FROM ps_crud').get()?.n).toBe(1)
})

test('round3 default SDK completion and explicit checkpoint forwarding keep their installed behavior', async () => {
  const first = await capability('batch')
  await first.complete()
  expect(adapter.checkpoints).toEqual([['target_checkpoint_request_id', '9223372036854775807']])
  adapter.replaceQueue('A')
  adapter.sqlite
    .prepare('INSERT INTO ps_crud VALUES (2, 8, ?)')
    .run(
      JSON.stringify({ op: 'PUT', type: 'shows', id: 'synthetic-next', data: { title: 'next' } }),
    )
  const batch = await db.getCrudBatch(1)
  if (!batch) throw new Error('Expected limited synthetic batch')
  expect(batch.haveMore).toBe(true)
  await batch.complete('321')
  expect(adapter.checkpoints.at(-1)).toEqual(['target_checkpoint_request_id', '321'])
  expect(adapter.sqlite.prepare('SELECT id FROM ps_crud').all()).toEqual([{ id: 2 }])
})

test('round4 executeRaw registers before the installed SDK waits for its write lease', async () => {
  const started = deferred()
  const finish = deferred()
  adapter.beforeWrite = async () => {
    started.resolve()
    await finish.promise
  }
  const pending = db.executeRaw("INSERT INTO private_rows VALUES ('registered write')")
  const outcome = pending.then(
    () => 'written',
    () => 'rejected',
  )
  await started.promise
  let acquired = false
  const draining = quiesceLocalWork().then((release) => {
    acquired = true
    return release
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const acquiredBeforeWrite = acquired
  // If exclusion incorrectly overtook the pending write, simulate revocation while held.
  if (acquired) disposeLocalDatabase(db)
  finish.resolve()
  const result = await outcome
  const release = await draining
  await release()
  expect(acquiredBeforeWrite).toBe(false)
  expect(result).toBe('written')
  expect(adapter.sqlite.prepare('SELECT count(*) AS n FROM private_rows').get()?.n).toBe(2)
})

test.each(['readLock', 'readTransaction'] as const)(
  'round4 %s takes lifecycle exclusion before waiting for an SDK lease',
  async (method) => {
    const started = deferred()
    const finish = deferred()
    adapter.beforeLock = async () => {
      started.resolve()
      await finish.promise
    }
    const pending = db[method](async (ctx) => ctx.execute('SELECT 1'))
    await started.promise
    let acquired = false
    const exclusive = navigator.locks.request(
      'binder-local-data',
      { mode: 'exclusive' },
      async () => {
        acquired = true
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    const acquiredBeforeLease = acquired
    finish.resolve()
    await pending
    await exclusive
    expect(acquiredBeforeLease).toBe(false)
  },
)

test.each(['readLock', 'readTransaction'] as const)(
  'round4 %s avoids SDK lease / lifecycle inversion with an exclusive count waiting',
  async (method) => {
    const entered = deferred()
    const proceed = deferred()
    const cleanup = deferred()
    const events: string[] = []
    const pending = db[method](async (ctx) => {
      entered.resolve()
      await proceed.promise
      await ctx.execute('SELECT 1')
      events.push('callback')
    })
    await entered.promise
    // A second tab's sign-out obtains lifecycle exclusion and then needs the same SQLite lease.
    let count = Promise.resolve()
    const counting = navigator.locks.request(
      'binder-local-data',
      { mode: 'exclusive' },
      async () => {
        count = adapter.get<{ n: number }>('SELECT count(*) AS n FROM ps_crud').then(() => {
          events.push('count')
        })
        await Promise.race([count, cleanup.promise])
      },
    )
    // Avoid a permanent cycle on RED: the cleanup signal releases the exclusive waiter.
    // The callback must normally finish without this escape hatch.
    proceed.resolve()
    const completed = await Promise.race([
      pending.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 80)),
    ])
    cleanup.resolve()
    await pending
    await counting
    await count
    expect(completed).toBe(true)
    expect(events).toEqual(['callback', 'count'])
  },
)

test.each(['writeLock', 'writeTransaction'] as const)(
  'round4 %s expires retained context writes and rolls back on stale transaction use',
  async (method) => {
    let retained!: LockContext
    await db[method](async (ctx) => {
      retained = ctx
      await ctx.execute('SELECT 1')
    })
    await expect(
      retained.executeRaw("INSERT INTO private_rows VALUES ('escaped')"),
    ).rejects.toThrow(/callback|session/)
    expect(adapter.sqlite.prepare('SELECT count(*) AS n FROM private_rows').get()?.n).toBe(1)
    if (method === 'writeTransaction') {
      await expect(
        db.writeTransaction(async (ctx) => {
          await ctx.execute("INSERT INTO private_rows VALUES ('temporary')")
          disposeLocalDatabase(db)
          await ctx.execute('SELECT 1')
        }),
      ).rejects.toThrow(/session/)
      expect(adapter.sqlite.isTransaction).toBe(false)
      expect(adapter.sqlite.prepare('SELECT count(*) AS n FROM private_rows').get()?.n).toBe(1)
    }
  },
)

function queueEntries(count: number) {
  adapter.sqlite.exec('DELETE FROM ps_crud')
  const insert = adapter.sqlite.prepare('INSERT INTO ps_crud VALUES (?, 7, ?)')
  for (let i = 1; i <= count; i++)
    insert.run(
      i,
      JSON.stringify({
        op: 'PUT',
        type: 'shows',
        id: `synthetic-${i}`,
        data: { title: 'A' },
      }),
    )
}
function queueCount() {
  return adapter.sqlite.prepare('SELECT count(*) AS n FROM ps_crud').get()?.n
}
// Protected SDK method is exposed only for this probe; it is the real upload callback factory.
function sdkUpload(connector: ApiConnector) {
  return (
    raw as unknown as {
      commonSyncOptions(connector: ApiConnector, options: object): { uploadCrud(): Promise<void> }
    }
  ).commonSyncOptions(connector, {}).uploadCrud
}

test('round4 installed SDK supplies raw receiver; whole callback drains even before first CRUD await and completion', async () => {
  const connector = new ApiConnector(db, 'A')
  const receive = vi.spyOn(connector, 'uploadData')
  const started = deferred()
  const finish = deferred()
  const completing = deferred()
  const finishCompletion = deferred()
  adapter.beforeLock = async () => {
    started.resolve()
    await finish.promise
  }
  adapter.beforeWrite = async () => {
    completing.resolve()
    await finishCompletion.promise
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ applied: 1, rejected: [] })),
  )
  const upload = sdkUpload(connector)()
  await started.promise
  let acquired = false
  const draining = quiesceLocalWork().then((release) => {
    acquired = true
    return release
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const beforeFirstAwait = acquired
  finish.resolve()
  await completing.promise
  await new Promise((resolve) => setTimeout(resolve, 0))
  const beforeCompletion = acquired
  finishCompletion.resolve()
  await upload
  await (await draining)()
  expect(receive).toHaveBeenCalledWith(raw)
  expect(raw).not.toBe(db)
  expect(beforeFirstAwait).toBe(false)
  expect(beforeCompletion).toBe(false)
  expect(queueCount()).toBe(0)
})

test('round4 401-entry cookie change rejects chunk two with original expectation and retains replay identity', async () => {
  queueEntries(401)
  const connector = new ApiConnector(db, 'A')
  const bodies: { batchId: string; chunk: { index: number }; entries: unknown[] }[] = []
  const headers: unknown[] = []
  let cookie = 'A'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      headers.push(init?.headers)
      if (cookie === 'B') return Response.json({ message: 'account mismatch' }, { status: 412 })
      cookie = 'B' // First chunk accepted as A; changed cookie on the next request.
      return Response.json({ applied: 400, rejected: [] })
    }),
  )
  await expect(sdkUpload(connector)()).rejects.toThrow(/account mismatch/)
  expect(bodies.map((body) => body.chunk.index)).toEqual([0, 1])
  expect(headers).toEqual(Array(2).fill(expect.objectContaining({ 'X-Binder-Expected-User': 'A' })))
  expect(queueCount()).toBe(401)
  expect(localStorage.getItem('binder.localDbDevice')).toBe('original-A')
  const originalBatch = bodies[0].batchId
  expect(bodies.every((body) => body.batchId === 'original-A-7')).toBe(true)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).batchId).toBe(originalBatch)
      return Response.json({ applied: 0, rejected: [], replay: true })
    }),
  )
  await sdkUpload(connector)()
  expect(queueCount()).toBe(0)
})

test('round4 revoked claim after delayed chunk one stops subsequent chunks and raw SDK completion', async () => {
  queueEntries(401)
  const connector = new ApiConnector(db, 'A')
  const started = deferred()
  const finish = deferred()
  const fetcher = vi.fn(async () => {
    started.resolve()
    await finish.promise
    return Response.json({ applied: 400, rejected: [] })
  })
  vi.stubGlobal('fetch', fetcher)
  const upload = sdkUpload(connector)()
  const rejected = expect(upload).rejects.toThrow(/session has changed/)
  await started.promise
  localStorage.setItem('binder.localDbClaim', 'revoked-in-other-tab')
  finish.resolve()
  await rejected
  expect(fetcher).toHaveBeenCalledOnce()
  expect(queueCount()).toBe(401)
  expect(localStorage.getItem('binder.localDbDevice')).toBe('original-A')
  activateLocalUser('A')
  await expect(connector.uploadData(raw)).rejects.toThrow(/session has changed/)
})

test('round4 completion refuses claim revocation during rejection label lookup', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        applied: 0,
        rejected: [{ table: 'cues', id: 'synthetic-A', message: 'rejected' }],
      }),
    ),
  )
  vi.spyOn(raw, 'getOptional').mockImplementation(async () => {
    disposeLocalDatabase(db)
    return null
  })
  await expect(new ApiConnector(db, 'A').uploadData(raw)).rejects.toThrow(/session has changed/)
  expect(queueCount()).toBe(1)
})

test('round4 stale connector construction and no-current-session uploads refuse before any SDK or network work', async () => {
  const connector = new ApiConnector(db, 'A')
  const fetcher = vi.fn()
  const next = vi.spyOn(raw, 'getNextCrudTransaction')
  vi.stubGlobal('fetch', fetcher)
  endLocalSession()
  expect(() => new ApiConnector(db, 'A')).toThrow(/session has changed/)
  await expect(connector.uploadData(raw)).rejects.toThrow(/session has changed/)
  await expect(connector.fetchCredentials()).rejects.toThrow(/session has changed/)
  expect(next).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
  expect(queueCount()).toBe(1)
  expect(localStorage.getItem('binder.localDbDevice')).toBe('original-A')
})

test('round4 installed SharedWorker abort ends only its wait; lifecycle still drains the actual raw callback', async () => {
  const require = createRequire(import.meta.url)
  const workerUrl = new URL(
    './worker/sync/SharedSyncImplementation.js',
    pathToFileURL(require.resolve('@powersync/web')),
  )
  const { SharedSyncImplementation } = await import(/* @vite-ignore */ workerUrl.href)
  // SDK checks property presence with `in`; the general test proxy only implements get.
  vi.stubGlobal('navigator', { locks: navigator.locks })
  const worker = new SharedSyncImplementation()
  worker.syncParams = { streamOptions: {} }
  const connector = new ApiConnector(db, 'A')
  const uploadCrud = sdkUpload(connector)
  const started = deferred()
  const finish = deferred()
  let actual!: Promise<void>
  const closeListeners: (() => void)[] = []
  worker.ports.push({
    isClosing: false,
    closeListeners,
    clientProvider: {
      uploadCrud: () => {
        actual = uploadCrud()
        return actual
      },
    },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      started.resolve()
      await finish.promise
      return Response.json({ applied: 1, rejected: [] })
    }),
  )
  const stream = worker.generateStreamingImplementation()
  const abort = new AbortController()
  const waiting = stream.options.uploadCrud(abort.signal)
  await started.promise
  abort.abort(new Error('synthetic disconnect'))
  await expect(waiting).rejects.toThrow('synthetic disconnect')
  expect(queueCount()).toBe(1)
  let acquired = false
  const draining = quiesceLocalWork().then((release) => {
    acquired = true
    return release
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const acquiredBeforeCallback = acquired
  finish.resolve()
  await actual
  await (await draining)()
  await stream.dispose()
  expect(acquiredBeforeCallback).toBe(false)
  expect(queueCount()).toBe(0)
  expect(closeListeners).toEqual([])
})

test('round4 missing server session retains installed CRUD and upload namespace', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'unauthenticated' }, { status: 401 })),
  )
  const connector = new ApiConnector(db, 'A')
  await expect(connector.uploadData(raw)).rejects.toThrow(/401/)
  expect(queueCount()).toBe(1)
  expect(localStorage.getItem('binder.localDbDevice')).toBe('original-A')
  await expect(connector.fetchCredentials()).resolves.toBeNull()
})

test('round4 credentials captured before a claim change never reach the SDK after the response', async () => {
  const started = deferred()
  const finish = deferred()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      started.resolve()
      await finish.promise
      return Response.json({
        token: 'synthetic',
        endpoint: 'http://synthetic.invalid',
        expiresAt: new Date(0).toISOString(),
      })
    }),
  )
  const credentials = new ApiConnector(db, 'A').fetchCredentials()
  const rejected = expect(credentials).rejects.toThrow(/session has changed/)
  await started.promise
  disposeLocalDatabase(db)
  finish.resolve()
  await rejected
})
