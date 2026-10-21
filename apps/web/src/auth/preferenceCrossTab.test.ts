import 'fake-indexeddb/auto'
import { expect, test, vi } from 'vitest'
import { webLocks } from '../test/webLocks'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('P2 other-tab sign-out waits for the entire initial-load preference operation', async () => {
  vi.resetModules()
  vi.stubGlobal('navigator', { locks: webLocks() })
  localStorage.clear()
  localStorage.setItem('binder.localDbOwner', 'cross-tab-A')
  localStorage.setItem('binder.localDbClaim', 'original-claim-A')
  const tab = await import('./localWork')
  tab.activateLocalUser('cross-tab-A')
  const prefs = await import('../offline/keepOffline/store')
  const store = prefs.idbOfflinePrefsStore('cross-tab-A')
  const started = deferred<void>()
  const load = deferred<[]>()
  vi.spyOn(store, 'list').mockImplementationOnce(() => {
    started.resolve()
    return load.promise
  })
  const writing = prefs.setKeepOffline('cross-tab-A', 'synthetic-show', true)
  await started.promise
  vi.resetModules()
  const otherTab = await import('./localWork')
  otherTab.activateLocalUser('cross-tab-A')
  let acquired = false
  const clearing = otherTab.quiesceLocalWork().then(async (release) => {
    acquired = true
    try {
      otherTab.endLocalSession()
      await prefs.clearOfflinePrefs('cross-tab-A')
    } finally {
      await release()
    }
  })
  for (let i = 0; i < 30; i++) await Promise.resolve()
  const clearedBeforeLoad = acquired
  load.resolve([])
  await writing
  await clearing
  expect(clearedBeforeLoad).toBe(false)
  expect(await store.list()).toEqual([])
  expect(prefs.getOfflinePrefs().prefs.size).toBe(0)
})
