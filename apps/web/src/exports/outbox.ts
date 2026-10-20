import {
  type LayerRef,
  type PrintOptions,
  sanitizeExportFilename,
  validateExportFilename,
} from '@binder/shared'
import { clear, createStore, del, set, values } from 'idb-keyval'
import { captureLocalAccountWork } from '../auth/localWork'
import { pushNotice } from '../components/noticeStore'

/**
 * An export waiting to have its record uploaded. The file has already been downloaded to the
 * user's device; this is the copy that gives the show its ExportRecord once there is a network.
 */
export interface PendingExport {
  /** The export's id (UUIDv7): the same id on every retry, so the server can recognise a replay. */
  id: string
  showId: string
  /** Whose export this is. A flush never sends an entry that belongs to someone else. */
  userId: string
  meta: {
    id: string
    kind: string
    filename: string
    layerSelection: LayerRef[]
    createdAt: string
    /** What a script print was asked for. Absent on entries queued before print options existed. */
    options?: PrintOptions
  }
  bytes: Uint8Array
  contentType: string
}

/** Where pending exports are kept. One store holds one user's entries. */
export interface OutboxStore {
  put(p: PendingExport): Promise<void>
  list(): Promise<PendingExport[]>
  remove(id: string): Promise<void>
  clear(): Promise<void>
}

export interface FlushResult {
  /** Uploaded and removed. */
  sent: number
  /** Still waiting: the network or the server failed, or the session needs signing in again. */
  kept: number
  /** Refused for good by the server and removed, each with a notice. */
  dropped: number
}

const OUTBOX_DB_PREFIX = 'binder-exports-'
const stores = new Map<string, OutboxStore>()
const pausedUsers = new Set<string>()

/**
 * The IndexedDB-backed store for one user: a database of its own, `binder-exports-<userId>`, so
 * entries belong to one user, and signing out can delete exactly that user's files.
 */
export function idbOutboxStore(userId: string): OutboxStore {
  let store = stores.get(userId)
  if (!store) {
    const idb = createStore(`${OUTBOX_DB_PREFIX}${userId}`, 'pending')
    store = {
      put: (p) => set(p.id, p, idb),
      list: () => values<PendingExport>(idb),
      remove: (id) => del(id, idb),
      clear: () => clear(idb),
    }
    stores.set(userId, store)
  }
  return store
}

const listeners = new Set<() => void>()
const changed = () => {
  for (const fn of [...listeners]) fn()
}

/** Calls `fn` whenever this page adds to or removes from an outbox (for the "waiting to upload" list). */
export function subscribeOutbox(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export async function enqueueExport(
  p: PendingExport,
  store: OutboxStore = idbOutboxStore(p.userId),
): Promise<void> {
  await store.put(p)
  changed()
}

/** The user's entries still waiting to upload, oldest first. */
export async function pendingExports(
  userId: string,
  store: OutboxStore = idbOutboxStore(userId),
): Promise<PendingExport[]> {
  return (await store.list())
    .filter((p) => p.userId === userId)
    .sort((a, b) => a.meta.createdAt.localeCompare(b.meta.createdAt) || a.id.localeCompare(b.id))
}

/**
 * Deletes every pending export of the user (sign-out). A flush running for that store is cancelled
 * first: it makes no further post, so a sign-out racing a flush can never send the user's file under
 * whoever signs in next. (A request already on the wire cannot be recalled.)
 */
export async function clearOutbox(
  userId: string,
  store: OutboxStore = idbOutboxStore(userId),
): Promise<void> {
  cancelRun(store)
  await store.clear()
  changed()
}

/**
 * Empties every user's outbox except `keepUserId`'s: run when the device's local database changes
 * owner (see `claimLocalDb`). A previous user's queued PDFs may carry their personal layer, and the
 * new user must neither see nor upload them. The download already happened on that user's turn;
 * only the still-unrecorded ExportRecord is lost. Stores are emptied, not deleted: idb-keyval holds
 * its connection open, which would block `deleteDatabase`. Where the browser cannot list its
 * databases (`indexedDB.databases` is missing), only stores this page has opened are emptied.
 */
export async function clearOtherOutboxes(keepUserId: string): Promise<void> {
  const keep = `${OUTBOX_DB_PREFIX}${keepUserId}`
  const names = new Set<string>()
  try {
    for (const db of (await indexedDB.databases?.()) ?? []) {
      if (db.name?.startsWith(OUTBOX_DB_PREFIX)) names.add(db.name)
    }
  } catch {
    // Not listable: fall back to what this page opened.
  }
  for (const [userId, store] of stores) {
    if (`${OUTBOX_DB_PREFIX}${userId}` !== keep) {
      cancelRun(store)
      names.add(`${OUTBOX_DB_PREFIX}${userId}`)
    }
  }
  names.delete(keep)
  for (const name of names) await clear(createStore(name, 'pending'))
  changed()
}

/**
 * The entry as it should be sent. A script PDF queued by older code could carry a name the server
 * now refuses (a space before `.pdf` after a cut, a leading dot), so that name is made safe first.
 * The file on the user's device keeps the name it was downloaded with; only the record's differs.
 */
function forUpload(p: PendingExport): PendingExport {
  if (p.meta.kind !== 'pdf-script' || validateExportFilename(p.meta.filename).ok) return p
  return { ...p, meta: { ...p.meta, filename: sanitizeExportFilename(p.meta.filename) } }
}

/** Uploads one entry as `POST /api/shows/:showId/exports`: the `meta` field, then the file. */
export function postExport(p: PendingExport, signal?: AbortSignal): Promise<Response> {
  const form = new FormData()
  form.append('meta', JSON.stringify(p.meta))
  form.append('file', new Blob([p.bytes as BlobPart], { type: p.contentType }), p.meta.filename)
  return fetch(`/api/shows/${encodeURIComponent(p.showId)}/exports`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Binder-Expected-User': p.userId },
    signal,
    body: form,
  })
}

/**
 * Whether a refusal is final. Most 4xx answers say the server will never take this file (bad
 * request, forbidden, too large, a conflicting id), so waiting would not help. Signed out (401),
 * request timeout (408), account precondition (412) and throttling (429) can pass, so the entry stays.
 */
const isFinalRefusal = (status: number): boolean =>
  status >= 400 &&
  status < 500 &&
  status !== 401 &&
  status !== 408 &&
  status !== 412 &&
  status !== 429

async function reasonOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null
  return typeof body?.message === 'string' && body.message
    ? body.message
    : `the server answered ${res.status}`
}

interface Run {
  /** Set when a flush is requested while this one is running: it goes round again. */
  again: boolean
  /** Set by `clearOutbox`: the run makes no further post. */
  cancelled: boolean
  controller: AbortController
  promise: Promise<FlushResult>
}
const runs = new WeakMap<OutboxStore, Run>()

/** Stops the store's running flush before its next post, and lets the next flush start a fresh run. */
function cancelRun(store: OutboxStore): void {
  const run = runs.get(store)
  if (run) {
    run.cancelled = true
    run.controller.abort()
    runs.delete(store)
  }
}

/**
 * Uploads the user's pending exports, oldest first. 2xx removes the entry; a final 4xx removes it
 * with a notice naming the file; network errors and 5xx keep it for the next flush (a network
 * error ends the run, since the rest would fail the same way; any other error keeps the entry, is
 * logged, and the run goes on). Only entries owned by `userId` are
 * ever sent. One run per store at a time: a flush asked for while another is running joins it, and
 * the run goes round again so an entry queued meanwhile is not left behind.
 */
export function flushOutbox(
  userId: string,
  opts: {
    store?: OutboxStore
    post?: (p: PendingExport, signal?: AbortSignal) => Promise<Response>
  } = {},
): Promise<FlushResult> {
  const store = opts.store ?? idbOutboxStore(userId)
  if (pausedUsers.has(userId))
    return pendingExports(userId, store).then((pending) => ({
      sent: 0,
      kept: pending.length,
      dropped: 0,
    }))
  let claim: ReturnType<typeof captureLocalAccountWork>
  try {
    claim = captureLocalAccountWork(userId)
    if (!navigator.locks) throw new Error('Export uploads require the shared local lifecycle lock.')
  } catch (error) {
    return Promise.reject(error)
  }
  const post = opts.post ?? postExport
  const running = runs.get(store)
  if (running) {
    running.again = true
    return running.promise
  }

  const run = { again: false, cancelled: false, controller: new AbortController() } as Run
  const unsubscribe = claim.subscribe(() => {
    run.cancelled = true
    run.controller.abort()
  })
  run.promise = claim
    .run(async () => {
      const total: FlushResult = { sent: 0, kept: 0, dropped: 0 }
      const tried = new Set<string>()
      try {
        let offline = false
        do {
          run.again = false
          for (const p of await pendingExports(userId, store)) {
            // Within one run an entry gets one attempt: a 503 is not hammered by the second pass.
            claim.checkClaim()
            if (run.cancelled) break
            if (tried.has(p.id)) continue
            tried.add(p.id)
            if (offline) {
              total.kept++
              continue
            }
            let res: Response
            try {
              claim.checkClaim()
              res = await post(forUpload(p), run.controller.signal)
              claim.checkClaim()
            } catch (err) {
              claim.checkClaim()
              total.kept++
              // fetch rejects with a TypeError when there is no network. Anything else is a bug or a
              // storage problem: keep the entry, say so, and carry on rather than calling it offline.
              if (err instanceof TypeError) offline = true
              else console.error(`could not upload export ${p.meta.filename}`, err)
              continue
            }
            if (run.cancelled) break
            if (res.ok) {
              await store.remove(p.id)
              total.sent++
            } else if (isFinalRefusal(res.status)) {
              await store.remove(p.id)
              total.dropped++
              pushNotice({
                kind: 'error',
                message: `${p.meta.filename} was downloaded, but Binder could not record it: ${await reasonOf(res)}.`,
              })
            } else {
              total.kept++
            }
          }
        } while (run.again && !offline && !run.cancelled)
      } finally {
        if (runs.get(store) === run) runs.delete(store)
        changed()
      }
      return total
    })
    .finally(() => {
      unsubscribe()
      if (runs.get(store) === run) runs.delete(store)
    })
  runs.set(store, run)
  return run.promise
}

/** Server sign-out succeeded: prevent another post and await any request already on the wire. */
export async function stopExportUploads(userId: string): Promise<void> {
  pausedUsers.add(userId)
  const store = idbOutboxStore(userId)
  const run = runs.get(store)
  cancelRun(store)
  await run?.promise
}

/** Only a successfully claimed local session can resume this user's exports. */
export function resumeExportUploads(userId: string): void {
  pausedUsers.delete(userId)
}
