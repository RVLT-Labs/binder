import { clear, createStore, del, entries, get, set } from 'idb-keyval'
import { useSyncExternalStore } from 'react'

/**
 * The keep-offline preference of one show on this device: present means On, absent means Off.
 * Per device and per user, never synced (the cache it drives is per device too).
 */
export interface OfflinePref {
  on: true
  /** When it was switched on (ISO), for the switch's help text and for debugging. */
  enabledAt: string
}

/** Where one user's preferences are kept. */
export interface OfflinePrefsStore {
  get(showId: string): Promise<OfflinePref | undefined>
  set(showId: string, pref: OfflinePref): Promise<void>
  remove(showId: string): Promise<void>
  list(): Promise<[showId: string, pref: OfflinePref][]>
  clear(): Promise<void>
}

const DB_PREFIX = 'binder-offline-'
const KEY_PREFIX = 'show:'
const stores = new Map<string, OfflinePrefsStore>()

/**
 * The IndexedDB-backed store for one user: a database of its own, `binder-offline-<userId>`, so
 * preferences belong to one user and sign-out can empty exactly that user's. Mirrors the export
 * outbox (`exports/outbox.ts`).
 */
export function idbOfflinePrefsStore(userId: string): OfflinePrefsStore {
  let store = stores.get(userId)
  if (!store) {
    const idb = createStore(`${DB_PREFIX}${userId}`, 'prefs')
    store = {
      get: (showId) => get<OfflinePref>(`${KEY_PREFIX}${showId}`, idb),
      set: (showId, pref) => set(`${KEY_PREFIX}${showId}`, pref, idb),
      remove: (showId) => del(`${KEY_PREFIX}${showId}`, idb),
      list: async () =>
        (await entries<string, OfflinePref>(idb))
          .filter(([key]) => typeof key === 'string' && key.startsWith(KEY_PREFIX))
          .map(([key, pref]) => [key.slice(KEY_PREFIX.length), pref]),
      clear: () => clear(idb),
    }
    stores.set(userId, store)
  }
  return store
}

/** The in-memory mirror of the signed-in user's preferences. Replaced, never mutated. */
export interface OfflinePrefsSnapshot {
  /** Whose preferences these are; null before any load. */
  userId: string | null
  /** Show id to preference, in the order they were switched on. */
  prefs: ReadonlyMap<string, OfflinePref>
}

let snapshot: OfflinePrefsSnapshot = { userId: null, prefs: new Map() }
const listeners = new Set<() => void>()

function publish(next: OfflinePrefsSnapshot): void {
  snapshot = next
  for (const l of [...listeners]) l()
}

export const subscribeOfflinePrefs = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const getOfflinePrefs = (): OfflinePrefsSnapshot => snapshot

/** The mirror, for components and the runner mount: re-renders when a preference changes. */
export function useOfflinePrefs(): OfflinePrefsSnapshot {
  return useSyncExternalStore(subscribeOfflinePrefs, getOfflinePrefs)
}

/** Whether keep-offline is On for this show. */
export function useKeepOffline(showId: string): boolean {
  return useOfflinePrefs().prefs.has(showId)
}

/** Reads the user's preferences from IndexedDB into the mirror (at start-up, and on a user change). */
export async function loadOfflinePrefs(
  userId: string,
  store: OfflinePrefsStore = idbOfflinePrefsStore(userId),
): Promise<void> {
  const list = await store.list()
  list.sort((a, b) => a[1].enabledAt.localeCompare(b[1].enabledAt) || a[0].localeCompare(b[0]))
  publish({ userId, prefs: new Map(list) })
}

/** Asks the browser not to evict this origin's storage; a refusal (or no support) is not an error. */
async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.()
  } catch {}
}

/**
 * Switches keep-offline on or off for a show. The store is written first, so the mirror (and so
 * the runner) never says On for something that was not saved; a failed write rejects and leaves
 * the mirror as it was. Switching on asks for persistent storage, once per switch-on.
 */
export async function setKeepOffline(
  userId: string,
  showId: string,
  on: boolean,
  store: OfflinePrefsStore = idbOfflinePrefsStore(userId),
): Promise<void> {
  if (snapshot.userId !== userId) await loadOfflinePrefs(userId, store)
  // The mirror is re-read after each await: another call may have published meanwhile, and
  // publishing a copy taken before the write would drop its change.
  const current = () => (snapshot.userId === userId ? snapshot.prefs : null)
  if (on) {
    if (current()?.has(showId)) return
    const pref: OfflinePref = { on: true, enabledAt: new Date().toISOString() }
    await store.set(showId, pref)
    const prefs = current()
    if (prefs) publish({ userId, prefs: new Map(prefs).set(showId, pref) })
    await requestPersistence()
  } else {
    await store.remove(showId)
    const prefs = current()
    if (prefs?.has(showId)) {
      const next = new Map(prefs)
      next.delete(showId)
      publish({ userId, prefs: next })
    }
  }
}

/** Forgets one show's preference (the runner does this when the show leaves this device). */
export const dropOfflinePref = (userId: string, showId: string): Promise<void> =>
  setKeepOffline(userId, showId, false)

/** Deletes the user's preferences (sign-out): every show starts Off for the next sign-in. */
export async function clearOfflinePrefs(
  userId: string,
  store: OfflinePrefsStore = idbOfflinePrefsStore(userId),
): Promise<void> {
  await store.clear()
  if (snapshot.userId === userId) publish({ userId, prefs: new Map() })
}

/**
 * Empties every user's preferences except `keepUserId`'s: run when the device's local database
 * changes owner (see `claimLocalDb`), beside `clearOtherOutboxes`. Stores are emptied, not deleted:
 * idb-keyval holds its connection open, which would block `deleteDatabase`. Where the browser
 * cannot list its databases, only stores this page has opened are emptied.
 */
export async function clearOtherOfflinePrefs(keepUserId: string): Promise<void> {
  const keep = `${DB_PREFIX}${keepUserId}`
  const names = new Set<string>()
  try {
    for (const db of (await indexedDB.databases?.()) ?? []) {
      if (db.name?.startsWith(DB_PREFIX)) names.add(db.name)
    }
  } catch {
    // Not listable: fall back to what this page opened.
  }
  for (const userId of stores.keys()) names.add(`${DB_PREFIX}${userId}`)
  names.delete(keep)
  for (const name of names) await clear(createStore(name, 'prefs'))
  if (snapshot.userId !== null && snapshot.userId !== keepUserId) {
    publish({ userId: keepUserId, prefs: new Map() })
  }
}
