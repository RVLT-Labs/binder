import type { CommonPowerSyncDatabase } from '@powersync/web'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { type ReactElement, useEffect } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { ApiConnector } from './connector'

const claimLocalDb = vi.fn()
const connect = vi.fn(async (_connector: ApiConnector) => {})
vi.mock('./db', () => ({ createPowerSync: () => ({ connect, disconnectAndClear: vi.fn() }) }))
vi.mock('./ownership', () => ({
  claimLocalDb: async (...args: unknown[]) => {
    await claimLocalDb(...args)
    localStorage.setItem('binder.localDbOwner', args[1] as string)
    localStorage.setItem('binder.localDbDevice', 'provider-ticket')
  },
  writeOwner: vi.fn(),
  deviceId: () => 'provider-upload-namespace',
}))
const clearOtherOutboxes = vi.fn(async (_userId: string) => {})
vi.mock('../blobs/fetchBlob', () => ({ clearBlobCache: vi.fn(async () => {}) }))
vi.mock('../exports/outbox', () => ({
  resumeExportUploads: vi.fn(),
  clearOtherOutboxes: (u: string) => clearOtherOutboxes(u),
}))

const { PowerSyncProvider, getPowerSync } = await import('./provider')

let queryClient: QueryClient
const render = (ui: ReactElement) =>
  rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)

beforeEach(() => {
  queryClient = new QueryClient()
  claimLocalDb.mockReset()
  claimLocalDb.mockImplementation(async (_db, userId: string) => {
    localStorage.setItem('binder.localDbOwner', userId)
    localStorage.setItem('binder.localDbDevice', 'provider-ticket')
  })
  connect.mockClear()
})

test('renders the app once the local database is claimed', async () => {
  claimLocalDb.mockResolvedValue(undefined)
  render(
    <PowerSyncProvider userId="u1">
      <p>the app</p>
    </PowerSyncProvider>,
  )
  expect(await screen.findByText('the app')).toBeTruthy()
  expect(connect).toHaveBeenCalledOnce()
})

test("a change of owner also clears every other user's export outbox", async () => {
  claimLocalDb.mockImplementation(async (_db, _user, clearForeign: () => Promise<void>) => {
    await clearForeign()
  })
  render(
    <PowerSyncProvider userId="u1">
      <p>the app</p>
    </PowerSyncProvider>,
  )
  expect(await screen.findByText('the app')).toBeTruthy()
  expect(clearOtherOutboxes).toHaveBeenCalledWith('u1')
})

test("a change of owner clears the previous user's cached query answers; the same owner keeps them", async () => {
  queryClient.setQueryData(['history', 'show-1'], ['the previous user saw this'])
  claimLocalDb.mockImplementation(async () => {})
  const same = render(
    <PowerSyncProvider userId="u1">
      <p>the app</p>
    </PowerSyncProvider>,
  )
  expect(await screen.findByText('the app')).toBeTruthy()
  expect(queryClient.getQueryData(['history', 'show-1'])).toBeDefined()
  same.unmount()

  claimLocalDb.mockImplementation(async (_db, _user, clearForeign: () => Promise<void>) => {
    await clearForeign()
  })
  render(
    <PowerSyncProvider userId="u2">
      <p>the app</p>
    </PowerSyncProvider>,
  )
  expect(await screen.findByText('the app')).toBeTruthy()
  expect(queryClient.getQueryData(['history', 'show-1'])).toBeUndefined()
})

test('a failure to open local storage shows why instead of a blank screen', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  claimLocalDb.mockRejectedValue(new DOMException('OPFS is not available', 'SecurityError'))
  render(
    <PowerSyncProvider userId="u1">
      <p>the app</p>
    </PowerSyncProvider>,
  )
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain(
    "This browser could not open Binder's local storage: OPFS is not available",
  )
  expect(screen.queryByText('the app')).toBeNull()
  expect(connect).not.toHaveBeenCalled()
})

test('B13 account changes await existing local work before claiming or clearing storage', async () => {
  const { runLocalWork } = await import('../auth/localWork')
  let finish = () => {}
  let markStarted = () => {}
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const active = runLocalWork(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
        markStarted()
      }),
  )
  await started
  claimLocalDb.mockResolvedValue(undefined)
  render(
    <PowerSyncProvider userId="u2">
      <p>new account</p>
    </PowerSyncProvider>,
  )
  const claimedBeforeSettled = claimLocalDb.mock.calls.length
  finish()
  await active
  await screen.findByText('new account')
  expect(claimedBeforeSettled).toBe(0)
})

test('R2 a storage claim transition unmounts the old account screens and subscriptions', async () => {
  const disposed = vi.fn()
  function Screen() {
    useEffect(() => disposed, [])
    return <p>private account screen</p>
  }
  claimLocalDb.mockResolvedValue(undefined)
  localStorage.setItem('binder.localDbOwner', 'u1')
  localStorage.setItem('binder.localDbDevice', 'original-ticket')
  render(
    <PowerSyncProvider userId="u1">
      <Screen />
    </PowerSyncProvider>,
  )
  await screen.findByText('private account screen')
  localStorage.setItem('binder.localDbOwner', 'u2')
  localStorage.setItem('binder.localDbDevice', 'other-ticket')
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'binder.localDbDevice' })))
  expect(screen.queryByText('private account screen')).toBeNull()
  expect(disposed).toHaveBeenCalledOnce()
})

test('round4 provider connects raw SDK with original verified facade/account and expires its connector on cleanup', async () => {
  const view = render(
    <PowerSyncProvider userId="u1">
      <p>claimed app</p>
    </PowerSyncProvider>,
  )
  await screen.findByText('claimed app')
  await waitFor(() => expect(connect).toHaveBeenCalledOnce())
  expect(connect.mock.contexts[0]).toBe(getPowerSync())
  const connector = connect.mock.calls[0][0]
  const fetcher = vi.fn(async () =>
    Response.json({
      token: 'synthetic',
      expiresAt: new Date(0).toISOString(),
      endpoint: 'http://synthetic.invalid',
    }),
  )
  vi.stubGlobal('fetch', fetcher)
  await connector.fetchCredentials()
  expect(fetcher).toHaveBeenCalledWith(
    '/api/sync/token',
    expect.objectContaining({ headers: { 'X-Binder-Expected-User': 'u1' } }),
  )
  view.unmount()
  const next = vi.fn(async () => null)
  await expect(
    connector.uploadData({ getNextCrudTransaction: next } as unknown as CommonPowerSyncDatabase),
  ).rejects.toThrow(/session has changed/)
  expect(next).not.toHaveBeenCalled()
  await expect(connector.fetchCredentials()).rejects.toThrow(/session has changed/)
  expect(fetcher).toHaveBeenCalledOnce()
})
