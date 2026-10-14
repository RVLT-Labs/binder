import { render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const claimLocalDb = vi.fn()
const connect = vi.fn(async () => {})
vi.mock('./db', () => ({ createPowerSync: () => ({ connect, disconnectAndClear: vi.fn() }) }))
vi.mock('./ownership', () => ({
  claimLocalDb: (...args: unknown[]) => claimLocalDb(...args),
  writeOwner: vi.fn(),
}))
vi.mock('../blobs/fetchBlob', () => ({ clearBlobCache: vi.fn(async () => {}) }))

const { PowerSyncProvider } = await import('./provider')

beforeEach(() => {
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
