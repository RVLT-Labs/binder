import type { LayerRef } from '@binder/shared'
import { clear, createStore, del, set, values } from 'idb-keyval'
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

const stores = new Map<string, OutboxStore>()

/**
 * The IndexedDB-backed store for one user: a database of its own, `binder-exports-<userId>`, so
 * entries belong to one user, and signing out can delete exactly that user's files.
 */
export function idbOutboxStore(userId: string): OutboxStore {
  let store = stores.get(userId)
  if (!store) {
    const idb = createStore(`binder-exports-${userId}`, 'pending')
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

/** Deletes every pending export of the user (sign-out). */
export async function clearOutbox(
  userId: string,
  store: OutboxStore = idbOutboxStore(userId),
): Promise<void> {
  await store.clear()
  changed()
}

/** Uploads one entry as `POST /api/shows/:showId/exports`: the `meta` field, then the file. */
export function postExport(p: PendingExport): Promise<Response> {
  const form = new FormData()
  form.append('meta', JSON.stringify(p.meta))
  form.append('file', new Blob([p.bytes as BlobPart], { type: p.contentType }), p.meta.filename)
  return fetch(`/api/shows/${encodeURIComponent(p.showId)}/exports`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
}

/**
 * Whether a refusal is final. Most 4xx answers say the server will never take this file (bad
 * request, forbidden, too large, a conflicting id), so waiting would not help. Signed out (401),
 * request timeout (408) and throttling (429) can pass, so the entry stays.
 */
const isFinalRefusal = (status: number): boolean =>
  status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429

async function reasonOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null
  return typeof body?.message === 'string' && body.message
    ? body.message
    : `the server answered ${res.status}`
}

interface Run {
  /** Set when a flush is requested while this one is running: it goes round again. */
  again: boolean
  promise: Promise<FlushResult>
}
const runs = new WeakMap<OutboxStore, Run>()

/**
 * Uploads the user's pending exports, oldest first. 2xx removes the entry; a final 4xx removes it
 * with a notice naming the file; network errors and 5xx keep it for the next flush (a network
 * error ends the run, since the rest would fail the same way). Only entries owned by `userId` are
 * ever sent. One run per store at a time: a flush asked for while another is running joins it, and
 * the run goes round again so an entry queued meanwhile is not left behind.
 */
export function flushOutbox(
  userId: string,
  opts: { store?: OutboxStore; post?: (p: PendingExport) => Promise<Response> } = {},
): Promise<FlushResult> {
  const store = opts.store ?? idbOutboxStore(userId)
  const post = opts.post ?? postExport
  const running = runs.get(store)
  if (running) {
    running.again = true
    return running.promise
  }

  const run = { again: false } as Run
  run.promise = (async () => {
    const total: FlushResult = { sent: 0, kept: 0, dropped: 0 }
    const tried = new Set<string>()
    try {
      let offline = false
      do {
        run.again = false
        for (const p of await pendingExports(userId, store)) {
          // Within one run an entry gets one attempt: a 503 is not hammered by the second pass.
          if (tried.has(p.id)) continue
          tried.add(p.id)
          if (offline) {
            total.kept++
            continue
          }
          let res: Response
          try {
            res = await post(p)
          } catch {
            offline = true
            total.kept++
            continue
          }
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
      } while (run.again && !offline)
    } finally {
      runs.delete(store)
      changed()
    }
    return total
  })()
  runs.set(store, run)
  return run.promise
}
