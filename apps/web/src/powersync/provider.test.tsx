import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

const claimLocalDb = vi.fn()
const connect = vi.fn(async () => {})
vi.mock('./db', () => ({ createPowerSync: () => ({ connect, disconnectAndClear: vi.fn() }) }))
vi.mock('./ownership', () => ({
  claimLocalDb: (...args: unknown[]) => claimLocalDb(...args),
  writeOwner: vi.fn(),
}))
const clearOtherOutboxes = vi.fn(async (_userId: string) => {})
vi.mock('../blobs/fetchBlob', () => ({ clearBlobCache: vi.fn(async () => {}) }))
vi.mock('../exports/outbox', () => ({ clearOtherOutboxes: (u: string) => clearOtherOutboxes(u) }))

const { PowerSyncProvider } = await import('./provider')

let queryClient: QueryClient
const render = (ui: ReactElement) =>
  rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)

beforeEach(() => {
  queryClient = new QueryClient()
  claimLocalDb.mockReset()
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
