import 'fake-indexeddb/auto'
import { afterEach, expect, test, vi } from 'vitest'
import {
  clearOfflinePrefs,
  clearOtherOfflinePrefs,
  getOfflinePrefs,
  idbOfflinePrefsStore,
  loadOfflinePrefs,
  type OfflinePrefsStore,
  setKeepOffline,
} from './store'

afterEach(async () => {
  await clearOfflinePrefs('u1')
  await clearOfflinePrefs('u2')
})

test('preferences are per user', async () => {
  await loadOfflinePrefs('u1')
  await setKeepOffline('u1', 'show-a', true)
  await setKeepOffline('u2', 'show-b', true)
  // Each user's database holds only their own shows.
  expect((await idbOfflinePrefsStore('u1').list()).map(([id]) => id)).toEqual(['show-a'])
  expect((await idbOfflinePrefsStore('u2').list()).map(([id]) => id)).toEqual(['show-b'])
  // The in-memory mirror follows the user it was last loaded or written for.
  expect([...getOfflinePrefs().prefs.keys()]).toEqual(['show-b'])
  await loadOfflinePrefs('u1')
  expect(getOfflinePrefs().userId).toBe('u1')
  expect([...getOfflinePrefs().prefs.keys()]).toEqual(['show-a'])
})

test('a preference survives a reload and Off removes it', async () => {
  await setKeepOffline('u1', 'show-a', true)
  await loadOfflinePrefs('u1')
  const pref = getOfflinePrefs().prefs.get('show-a')
  expect(pref).toEqual({ on: true, enabledAt: expect.any(String) })
  await setKeepOffline('u1', 'show-a', false)
  expect(getOfflinePrefs().prefs.has('show-a')).toBe(false)
  expect(await idbOfflinePrefsStore('u1').list()).toEqual([])
})

test("clearOtherOfflinePrefs keeps the current user's", async () => {
  await setKeepOffline('u2', 'show-b', true)
  await setKeepOffline('u1', 'show-a', true)
  await clearOtherOfflinePrefs('u1')
  expect((await idbOfflinePrefsStore('u1').list()).map(([id]) => id)).toEqual(['show-a'])
  expect(await idbOfflinePrefsStore('u2').list()).toEqual([])
  expect([...getOfflinePrefs().prefs.keys()]).toEqual(['show-a'])
})

test('clearOfflinePrefs empties the user store and the mirror', async () => {
  await setKeepOffline('u1', 'show-a', true)
  await clearOfflinePrefs('u1')
  expect(await idbOfflinePrefsStore('u1').list()).toEqual([])
  expect(getOfflinePrefs().prefs.size).toBe(0)
})

test('switching on asks the browser to keep storage; switching off does not', async () => {
  const persist = vi.fn(async () => true)
  vi.stubGlobal('navigator', { ...navigator, storage: { persist } })
  await setKeepOffline('u1', 'show-a', true)
  expect(persist).toHaveBeenCalledOnce()
  await setKeepOffline('u1', 'show-a', false)
  expect(persist).toHaveBeenCalledOnce()
})

test('a refused persist or a store write that fails leaves the mirror true to the store', async () => {
  vi.stubGlobal('navigator', {
    ...navigator,
    storage: {
      persist: async () => {
        throw new Error('no')
      },
    },
  })
  await expect(setKeepOffline('u1', 'show-a', true)).resolves.toBeUndefined()
  const broken: OfflinePrefsStore = {
    get: async () => undefined,
    set: async () => {
      throw new Error('IndexedDB is blocked')
    },
    remove: async () => {},
    list: async () => [],
    clear: async () => {},
  }
  await loadOfflinePrefs('u1')
  await expect(setKeepOffline('u1', 'show-z', true, broken)).rejects.toThrow('blocked')
  expect(getOfflinePrefs().prefs.has('show-z')).toBe(false)
})
