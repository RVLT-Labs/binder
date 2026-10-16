import { blobUrlsForShow, type ShowBlobRows } from '../prefetch'

/**
 * Keep-offline runner: keeps the blobs of every show switched On in the Cache API, by set
 * difference. For each enabled show it takes `blobUrlsForShow(rows)` (current version first), lists
 * what the cache already holds with one `cache.keys()` call, and fetches the rest. Because the
 * plan is `urls - cached`, the same pass handles a first enable, a new revision, and a browser
 * eviction, with no bookkeeping about what is "new".
 *
 * This is pure logic over injected `RunnerDeps` (database, cache, storage estimate, locks), so it
 * is tested with fakes. `KeepOfflineRunner` (the root mount) and `browserRunnerDeps` supply the real
 * ones. Timers are the global `setTimeout`.
 *
 * What triggers a pass: `update` (a preference or the set of local shows changed), `notifySync`
 * (the ready versions or page rows changed; debounced 2 s so a burst of sync is one pass), and
 * `resume` (the `online` event, the page becoming visible again, a retry by the user). A retry
 * timer follows a failure or a full disk.
 *
 * There is deliberately no service-worker background sync. PowerSync only syncs while a page is
 * open, so a worker could not learn that a new version exists, and Background Sync and Periodic
 * Sync are Chromium-only (iOS Safari has neither). Instead every open reconciles: whatever was
 * missed while the app was closed is fetched the next time it opens. iOS may also evict storage
 * for a site that is not installed to the Home Screen, so "stays offline-ready" is strongest for
 * the installed app; the next reconcile refetches whatever was evicted.
 */

/** How many blobs download at once (the manual "Make available offline" button uses 6). */
const CONCURRENCY = 2
/** Blobs per batch: the storage estimate is checked before each. */
const BATCH = 10
const MIN_HEADROOM = 150 * 1024 * 1024
const HEADROOM_FRACTION = 0.1
/** Retry waits after a failure or a full disk; the last is the cap. */
const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000]
/** A burst of sync changes settles for this long before it triggers a pass. */
const SYNC_DEBOUNCE_MS = 2_000
export const LOCK_NAME = 'binder-keep-offline'

export type ShowState =
  /** Nothing to do, or all of it done. */
  | 'idle'
  /** Fetching. */
  | 'working'
  /** No network: waiting. Not an error. */
  | 'offline'
  /** Paused by the browser's data-saver mode. */
  | 'paused'
  /** The device has no room: out of storage headroom or `cache.put` refused. */
  | 'full'
  /** Some files could not be saved; a retry is scheduled. */
  | 'failed'

export interface ShowStatus {
  state: ShowState
  /** Files this show needs on the device. */
  total: number
  /** Files still to fetch. */
  missing: number
  /** Files that failed in the latest pass. */
  failed: number
}

export interface LocksLike {
  request<T>(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown | null) => Promise<T>,
  ): Promise<T>
}

export interface RunnerDeps {
  /** The rows `blobUrlsForShow` reads, from the local database. */
  loadRows(showId: string): Promise<ShowBlobRows>
  /** The paths (`/blobs/...`) already in the cache: one `cache.keys()` call. */
  cachedUrls(): Promise<ReadonlySet<string>>
  /** Fetches one blob. It must honour `signal`, but the runner does not rely on it. */
  fetchBlob(url: string, signal: AbortSignal): Promise<Response>
  /** Stores a 200 response in the cache; throws on a quota error. */
  putBlob(url: string, res: Response): Promise<void>
  /** Deletes a show's document blobs (`/blobs/shows/<id>/documents/`), never its export blobs. */
  deleteShowBlobs(showId: string): Promise<unknown>
  /** Deletes a show's keep-offline preference (the show left this device). */
  dropPreference(showId: string): Promise<void>
  /** `navigator.storage.estimate()`; undefined where unsupported. */
  estimate(): Promise<{ usage?: number; quota?: number } | undefined>
  isOnline(): boolean
  /** `navigator.connection?.saveData`. */
  saveData(): boolean
  /** `navigator.locks`; undefined where unsupported, and then every tab runs (harmless). */
  locks?: LocksLike
  /** Called after blobs were stored, so screens that say what is on the device look again. */
  onStored?(): void
}

export interface RunnerInput {
  /** Shows whose preference is On. */
  enabled: readonly string[]
  /**
   * Every show in the local `shows` table, or null until that table has loaded. A show with a
   * preference that is not in this set was removed from this device: its preference and blobs go.
   * Pass null until the first sync has landed so an empty table never looks like "all removed".
   */
  localShows: ReadonlySet<string> | null
}

export interface KeepOfflineRunner {
  update(input: RunnerInput): void
  /** The ready versions or page rows may have changed; `signature` is a string that changes with them. */
  notifySync(signature: string): void
  /** The network came back, the page became visible, or the user asked again: reset the backoff and run. */
  resume(): void
  /** Aborts every fetch, ignores any late put, and resolves once nothing is writing to the cache. */
  stop(): Promise<void>
  /** Resolves when no pass is running. */
  whenIdle(): Promise<void>
  getStatus(): ReadonlyMap<string, ShowStatus>
  subscribe(listener: () => void): () => void
}

const isQuotaError = (err: unknown): boolean => {
  const e = err as { name?: string; code?: number } | null
  return (
    e?.name === 'QuotaExceededError' || e?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e?.code === 22
  )
}

const abortError = () => new DOMException('The operation was aborted.', 'AbortError')

/** Rejects as soon as `signal` aborts, and disposes of a response that arrives after that. */
function raceAbort(p: Promise<Response>, signal: AbortSignal): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const discard = (res: Response) => void res.body?.cancel().catch(() => {})
    if (signal.aborted) {
      p.then(discard, () => {})
      reject(abortError())
      return
    }
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (res) => {
        signal.removeEventListener('abort', onAbort)
        if (signal.aborted) discard(res)
        else resolve(res)
      },
      (err) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}

/** A controller that aborts when any of `parents` does. */
function linked(...parents: AbortSignal[]): AbortController {
  const c = new AbortController()
  for (const p of parents) {
    if (p.aborted) c.abort()
    else p.addEventListener('abort', () => c.abort(), { once: true })
  }
  return c
}

interface Plan {
  id: string
  total: number
  missing: string[]
  stored: number
  failed: number
}

export function createKeepOfflineRunner(deps: RunnerDeps): KeepOfflineRunner {
  let stopped = false
  let enabled: string[] = []
  let localShows: ReadonlySet<string> | null = null
  let statuses: ReadonlyMap<string, ShowStatus> = new Map()
  const listeners = new Set<() => void>()
  /** Aborted when a show is switched Off or pruned: its fetches stop, others go on. */
  const showAborts = new Map<string, AbortController>()
  let passAbort: AbortController | null = null
  let running: Promise<void> | null = null
  let again = false
  let backoffStep = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let syncTimer: ReturnType<typeof setTimeout> | undefined
  let lastSignature: string | undefined

  const emit = () => {
    for (const l of [...listeners]) l()
  }
  function setStatus(id: string, status: ShowStatus | null): void {
    const next = new Map(statuses)
    if (status) next.set(id, status)
    else next.delete(id)
    statuses = next
    emit()
  }
  const showAbortFor = (id: string): AbortController => {
    const existing = showAborts.get(id)
    if (existing) return existing
    const c = new AbortController()
    showAborts.set(id, c)
    return c
  }

  function clearRetry(): void {
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    retryTimer = undefined
  }
  function scheduleRetry(): void {
    clearRetry()
    const wait = BACKOFF_MS[Math.min(backoffStep, BACKOFF_MS.length - 1)]
    backoffStep++
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      schedule()
    }, wait)
  }

  /** Whether the device has room: free space under max(150 MB, 10 % of the quota) means no. */
  async function lowOnSpace(): Promise<boolean> {
    try {
      const est = await deps.estimate()
      if (!est || est.quota === undefined || est.usage === undefined) return false
      return est.quota - est.usage < Math.max(MIN_HEADROOM, est.quota * HEADROOM_FRACTION)
    } catch {
      return false
    }
  }

  async function pruneRemoved(): Promise<void> {
    if (!localShows) return
    const gone = enabled.filter((id) => !localShows?.has(id))
    for (const id of gone) {
      showAborts.get(id)?.abort()
      showAborts.delete(id)
      enabled = enabled.filter((e) => e !== id)
      setStatus(id, null)
      try {
        await deps.deleteShowBlobs(id)
        await deps.dropPreference(id)
      } catch (err) {
        console.error(`could not drop show ${id} from keep-offline`, err)
      }
    }
  }

  async function runPass(): Promise<void> {
    const pass = new AbortController()
    passAbort = pass
    let hadFailure = false
    let outcome = 'ok' as 'ok' | 'full' | 'offline'
    let anyStored = false

    await pruneRemoved()
    const ids = [...enabled]
    if (ids.length === 0 || pass.signal.aborted) return

    let cached: ReadonlySet<string>
    try {
      cached = await deps.cachedUrls()
    } catch {
      cached = new Set()
    }
    const plans: Plan[] = []
    for (const id of ids) {
      if (pass.signal.aborted) return
      try {
        const urls = blobUrlsForShow(await deps.loadRows(id))
        plans.push({
          id,
          total: urls.length,
          missing: urls.filter((u) => !cached.has(u)),
          stored: 0,
          failed: 0,
        })
      } catch (err) {
        console.error(`could not read show ${id} for keep-offline`, err)
        hadFailure = true
      }
    }
    if (pass.signal.aborted) return

    const publish = (p: Plan, state: ShowState) => {
      if (!enabled.includes(p.id) || pass.signal.aborted) return
      setStatus(p.id, {
        state,
        total: p.total,
        missing: p.missing.length - p.stored,
        failed: p.failed,
      })
    }

    const waiting: ShowState | null = !deps.isOnline()
      ? 'offline'
      : deps.saveData()
        ? 'paused'
        : null
    for (const p of plans) publish(p, p.missing.length === 0 ? 'idle' : (waiting ?? 'working'))
    if (waiting) return

    for (const p of plans) {
      if (p.missing.length === 0) continue
      const signal = linked(pass.signal, showAbortFor(p.id).signal).signal
      const queue = [...p.missing]

      const fetchOne = async (url: string): Promise<void> => {
        try {
          const res = await raceAbort(deps.fetchBlob(url, signal), signal)
          if (res.status !== 200) {
            void res.body?.cancel().catch(() => {})
            throw new Error(`the server answered ${res.status}`)
          }
          // Not raced: a put that has begun is awaited, so `stop()` resolves only once nothing can
          // still write to the cache. Its body comes from the aborted fetch, so it ends quickly.
          await deps.putBlob(url, res)
          p.stored++
          anyStored = true
          publish(p, 'working')
        } catch (err) {
          if (signal.aborted) return
          if (isQuotaError(err)) outcome = 'full'
          else if (err instanceof TypeError && !deps.isOnline()) outcome = 'offline'
          else {
            p.failed++
            hadFailure = true
            publish(p, 'working')
          }
        }
      }
      while (queue.length > 0 && outcome === 'ok' && !signal.aborted) {
        if (await lowOnSpace()) {
          outcome = 'full'
          break
        }
        const batch = queue.splice(0, BATCH)
        const it = batch[Symbol.iterator]()
        const next = async () => {
          for (let r = it.next(); !r.done; r = it.next()) {
            await fetchOne(r.value)
            if (outcome !== 'ok' || signal.aborted) return
          }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, next))
      }
    }

    if (anyStored && !pass.signal.aborted) deps.onStored?.()
    // Aborted (a show was added, or stop): the next pass, if any, reports.
    if (pass.signal.aborted) return
    for (const p of plans) {
      const left = p.missing.length - p.stored
      if (left === 0 && p.failed === 0) publish(p, 'idle')
      else if (outcome === 'full') publish(p, 'full')
      else if (outcome === 'offline') publish(p, 'offline')
      else publish(p, p.failed > 0 ? 'failed' : 'idle')
    }
    if (outcome === 'offline') return // the online event resumes it
    if (outcome === 'full' || hadFailure) scheduleRetry()
    else backoffStep = 0
  }

  /** Runs one pass as the Web Locks leader; where locks are missing or fail, runs it directly. */
  async function runAsLeader(): Promise<void> {
    if (!deps.locks) return runPass()
    let ran = false
    try {
      await deps.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
        // Another tab holds it and is doing the work; this one shows On without progress.
        if (lock === null) return
        ran = true
        await runPass()
      })
    } catch (err) {
      if (!ran) return runPass()
      throw err
    }
  }

  function schedule(): void {
    if (stopped) return
    clearRetry()
    if (running) {
      again = true
      return
    }
    running = (async () => {
      try {
        do {
          again = false
          try {
            await runAsLeader()
          } catch (err) {
            console.error('keep-offline pass failed', err)
            if (!stopped) scheduleRetry()
          }
        } while (again && !stopped)
      } finally {
        running = null
        passAbort = null
      }
    })()
  }

  return {
    update(input) {
      if (stopped) return
      const next = [...input.enabled]
      const added = next.some((id) => !enabled.includes(id))
      for (const id of enabled) {
        if (!next.includes(id)) {
          showAborts.get(id)?.abort()
          showAborts.delete(id)
          setStatus(id, null)
        }
      }
      enabled = next
      localShows = input.localShows
      const pruneNeeded = localShows !== null && next.some((id) => !localShows?.has(id))
      if (added) {
        // A show switched on catches up at once: restart the running pass so it is not queued
        // behind a long one. What is already stored is skipped by the set difference.
        passAbort?.abort()
        backoffStep = 0
      }
      if (added || pruneNeeded) schedule()
    },
    notifySync(signature) {
      if (stopped) return
      if (lastSignature === undefined) {
        lastSignature = signature
        return
      }
      if (signature === lastSignature) return
      lastSignature = signature
      if (syncTimer !== undefined) clearTimeout(syncTimer)
      syncTimer = setTimeout(() => {
        syncTimer = undefined
        backoffStep = 0
        schedule()
      }, SYNC_DEBOUNCE_MS)
    },
    resume() {
      if (stopped) return
      backoffStep = 0
      schedule()
    },
    async stop() {
      stopped = true
      clearRetry()
      if (syncTimer !== undefined) clearTimeout(syncTimer)
      syncTimer = undefined
      passAbort?.abort()
      for (const c of showAborts.values()) c.abort()
      showAborts.clear()
      await running?.catch(() => {})
      statuses = new Map()
      emit()
    },
    whenIdle: () => running ?? Promise.resolve(),
    getStatus: () => statuses,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
