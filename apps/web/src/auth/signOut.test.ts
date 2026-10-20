import { beforeEach, expect, test, vi } from 'vitest'
import { clearNotices, getNotices } from '../components/noticeStore'
import { signOutAndClear } from './signOut'

beforeEach(() => clearNotices())

function deps(signOut: () => Promise<{ error: { message?: string } | null }>) {
  return {
    signOut: vi.fn(signOut),
    clearLocalData: vi.fn(async () => {}),
    clearOutbox: vi.fn(async () => {}),
    clearOfflinePrefs: vi.fn(async () => {}),
    stopOfflineRunner: vi.fn(async () => {}),
    stopExportRunner: vi.fn(async () => {}),
    clearCache: vi.fn(),
    toLogin: vi.fn(async () => {}),
    pendingUploads: vi.fn(async () => 0),
    pendingExports: vi.fn(async () => 0),
    confirm: vi.fn(() => true),
  }
}

test('signs out on the server, then clears local data and goes to login', async () => {
  const d = deps(async () => ({ error: null }))
  await signOutAndClear(d)
  expect(d.clearLocalData).toHaveBeenCalledOnce()
  expect(d.clearOutbox).toHaveBeenCalledOnce()
  expect(d.clearCache).toHaveBeenCalledOnce()
  expect(d.toLogin).toHaveBeenCalledOnce()
  expect(d.signOut.mock.invocationCallOrder[0]).toBeLessThan(
    d.clearLocalData.mock.invocationCallOrder[0],
  )
})

test('sign-out clears offline preferences and stops the runner before clearing the cache', async () => {
  const d = deps(async () => ({ error: null }))
  await signOutAndClear(d)
  expect(d.clearOfflinePrefs).toHaveBeenCalledOnce()
  expect(d.stopOfflineRunner).toHaveBeenCalledOnce()
  // clearLocalData empties the blob cache, so the runner must be stopped (and settled) first.
  expect(d.stopOfflineRunner.mock.invocationCallOrder[0]).toBeLessThan(
    d.clearLocalData.mock.invocationCallOrder[0],
  )
  expect(d.stopOfflineRunner.mock.invocationCallOrder[0]).toBeLessThan(
    d.clearOfflinePrefs.mock.invocationCallOrder[0],
  )
  expect(d.clearOfflinePrefs.mock.invocationCallOrder[0]).toBeLessThan(
    d.clearLocalData.mock.invocationCallOrder[0],
  )
})

test('the runner is awaited: clearLocalData waits for it to settle', async () => {
  const d = deps(async () => ({ error: null }))
  let settled = false
  d.stopOfflineRunner.mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 10))
    settled = true
  })
  d.clearLocalData.mockImplementation(async () => {
    expect(settled).toBe(true)
  })
  await signOutAndClear(d)
  expect(d.clearLocalData).toHaveBeenCalledOnce()
})

test('a failing runner stop or preference clear stops the sign-out', async () => {
  const d = deps(async () => ({ error: null }))
  d.stopOfflineRunner.mockRejectedValue(new Error('x'))
  d.clearOfflinePrefs.mockRejectedValue(new Error('IndexedDB is blocked'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await signOutAndClear(d)
  expect(d.clearLocalData).not.toHaveBeenCalled()
  expect(d.toLogin).not.toHaveBeenCalled()
})

test('keeps local data and the session when the server refuses sign-out', async () => {
  const d = deps(async () => ({ error: { message: 'Internal error' } }))
  await signOutAndClear(d)
  expect(d.clearLocalData).not.toHaveBeenCalled()
  expect(d.clearOutbox).not.toHaveBeenCalled()
  expect(d.stopOfflineRunner).not.toHaveBeenCalled()
  expect(d.clearOfflinePrefs).not.toHaveBeenCalled()
  expect(d.clearCache).not.toHaveBeenCalled()
  expect(d.toLogin).not.toHaveBeenCalled()
  expect(getNotices()).toEqual([
    expect.objectContaining({
      kind: 'error',
      message: expect.stringContaining('Could not sign out'),
    }),
  ])
})

test('keeps local data when the sign-out request cannot be sent (offline)', async () => {
  const d = deps(async () => {
    throw new TypeError('Failed to fetch')
  })
  await expect(signOutAndClear(d)).resolves.toBeUndefined()
  expect(d.clearLocalData).not.toHaveBeenCalled()
  expect(getNotices()).toHaveLength(1)
})

test('a failing outbox clear stops the sign-out', async () => {
  const d = deps(async () => ({ error: null }))
  d.clearOutbox.mockRejectedValue(new Error('IndexedDB is blocked'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await signOutAndClear(d)
  expect(d.clearLocalData).not.toHaveBeenCalled()
  expect(d.toLogin).not.toHaveBeenCalled()
})

test('with changes still waiting to upload, asks first and signs out only on yes', async () => {
  const d = deps(async () => ({ error: null }))
  d.pendingUploads.mockResolvedValue(3)
  await signOutAndClear(d)
  expect(d.confirm).toHaveBeenCalledWith(
    "3 changes haven't uploaded yet. Queued changes and pending exports will be removed from this device. Sign out anyway?",
  )
  expect(d.signOut).toHaveBeenCalledOnce()
  expect(d.clearLocalData).toHaveBeenCalledOnce()
  expect(d.toLogin).toHaveBeenCalledOnce()
})

test('says "1 change hasn\'t" for a single pending change', async () => {
  const d = deps(async () => ({ error: null }))
  d.pendingUploads.mockResolvedValue(1)
  await signOutAndClear(d)
  expect(d.confirm).toHaveBeenCalledWith(
    "1 change hasn't uploaded yet. Queued changes and pending exports will be removed from this device. Sign out anyway?",
  )
})

test('a no leaves the session and every local row alone', async () => {
  const d = deps(async () => ({ error: null }))
  d.pendingUploads.mockResolvedValue(2)
  d.confirm.mockReturnValue(false)
  await signOutAndClear(d)
  expect(d.signOut).not.toHaveBeenCalled()
  expect(d.clearOutbox).not.toHaveBeenCalled()
  expect(d.clearLocalData).not.toHaveBeenCalled()
  expect(d.clearCache).not.toHaveBeenCalled()
  expect(d.toLogin).not.toHaveBeenCalled()
  expect(getNotices()).toEqual([])
})

test('nothing pending means no question', async () => {
  const d = deps(async () => ({ error: null }))
  await signOutAndClear(d)
  expect(d.confirm).not.toHaveBeenCalled()
  expect(d.toLogin).toHaveBeenCalledOnce()
})

test('a queue that cannot be counted stops the sign-out conservatively', async () => {
  const d = deps(async () => ({ error: null }))
  d.pendingUploads.mockRejectedValue(new Error('database is closed'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await signOutAndClear(d)
  expect(d.confirm).not.toHaveBeenCalled()
  expect(d.toLogin).not.toHaveBeenCalled()
})

test('B13 an export-only outbox warns about removal and cancel preserves everything', async () => {
  const d = { ...deps(async () => ({ error: null })), pendingExports: vi.fn(async () => 2) }
  d.confirm.mockReturnValue(false)
  await signOutAndClear(d)
  expect(d.confirm).toHaveBeenCalledWith(expect.stringMatching(/2 pending exports.*removed/i))
  expect(d.signOut).not.toHaveBeenCalled()
  expect(d.clearOutbox).not.toHaveBeenCalled()
  expect(d.clearLocalData).not.toHaveBeenCalled()
})

test.each(['pendingUploads', 'pendingExports'] as const)(
  'B13 failing %s count keeps all local data and does not end the session',
  async (count) => {
    const d = deps(async () => ({ error: null }))
    d[count].mockRejectedValue(new Error('storage unavailable'))
    await signOutAndClear(d)
    expect(d.signOut).not.toHaveBeenCalled()
    expect(d.clearLocalData).not.toHaveBeenCalled()
    expect(d.clearOutbox).not.toHaveBeenCalled()
    expect(getNotices().at(-1)?.message).toMatch(/could not check.*nothing.*removed/i)
  },
)

test('B13 a late queue increase is confirmed before ending the session', async () => {
  const d = deps(async () => ({ error: null }))
  d.pendingUploads.mockResolvedValueOnce(0).mockResolvedValue(1)
  d.confirm.mockReturnValue(false)
  await signOutAndClear(d)
  expect(d.confirm).toHaveBeenCalled()
  expect(d.signOut).not.toHaveBeenCalled()
  expect(d.clearLocalData).not.toHaveBeenCalled()
})

test('B13 work added while the server signs out is retained rather than silently discarded', async () => {
  const d = deps(async () => {
    d.pendingExports.mockResolvedValue(1)
    return { error: null }
  })
  await signOutAndClear(d)
  expect(d.clearOutbox).not.toHaveBeenCalled()
  expect(d.clearLocalData).not.toHaveBeenCalled()
  expect(getNotices().at(-1)?.message).toMatch(/local.*retained/i)
})

test('B13 server-first sign-out awaits the export runner before clearing', async () => {
  const d = {
    ...deps(async () => ({ error: null })),
    stopExportRunner: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10))
      settled = true
    }),
  }
  let settled = false
  d.clearOutbox.mockImplementation(async () => {
    expect(settled).toBe(true)
  })
  await signOutAndClear(d)
  expect(d.stopExportRunner).toHaveBeenCalledOnce()
  expect(d.signOut.mock.invocationCallOrder[0]).toBeLessThan(
    d.stopExportRunner.mock.invocationCallOrder[0],
  )
})

test('R1 missing Web Locks refuses count-zero destructive sign-out', async () => {
  vi.stubGlobal('navigator', {})
  const d = deps(async () => ({ error: null }))
  await signOutAndClear(d)
  expect(d.signOut).not.toHaveBeenCalled()
  expect(d.clearLocalData).not.toHaveBeenCalled()
  expect(d.clearOutbox).not.toHaveBeenCalled()
  expect(getNotices()[0]?.message).toMatch(/exclusion|Web Locks/)
})

test('R1 missing Web Locks retains a delayed competing tab write after zero counts', async () => {
  vi.stubGlobal('navigator', {})
  let finish = () => {}
  const rows: string[] = []
  // Another tab has its own active set. Its pending write is invisible to this tab's counters.
  const competing = new Promise<void>((resolve) => {
    finish = resolve
  }).then(() => {
    rows.push('other tab unsynced edit')
  })
  const d = deps(async () => ({ error: null }))
  d.clearLocalData.mockImplementation(async () => {
    rows.length = 0
  })
  d.clearOutbox.mockImplementation(async () => {
    finish()
    await competing
  })
  await signOutAndClear(d)
  finish()
  await competing
  expect(d.signOut).not.toHaveBeenCalled()
  expect(d.clearLocalData).not.toHaveBeenCalled()
  expect(rows).toEqual(['other tab unsynced edit'])
})
