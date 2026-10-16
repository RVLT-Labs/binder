import { render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  status: { connected: true, connecting: false },
  pending: 0,
}))
vi.mock('@powersync/react', () => ({ useStatus: () => h.status }))
vi.mock('./usePendingChanges', () => ({ usePendingChanges: () => h.pending }))
vi.mock('../offline/useOnline', () => ({ useOnline: () => h.status.connected }))
const { SyncStatus } = await import('./SyncStatus')

beforeEach(() => {
  h.status = { connected: true, connecting: false }
  h.pending = 0
})

test('says Synced, then Syncing… with the count while changes upload', () => {
  const { rerender } = render(<SyncStatus />)
  expect(screen.getByLabelText('Sync status').textContent).toBe('Synced')
  h.pending = 3
  rerender(<SyncStatus />)
  expect(screen.getByLabelText('Sync status').textContent).toBe('Syncing… 3')
})

test('offline is just "Offline" (the count is the banner\'s); the number stays on data-pending for tests', () => {
  h.status = { connected: false, connecting: false }
  h.pending = 2
  render(<SyncStatus />)
  const status = screen.getByLabelText('Sync status')
  expect(status.textContent).toBe('Offline')
  expect(status.getAttribute('data-pending')).toBe('2')
})

test('compact keeps the dot and gives the word to assistive technology only', () => {
  render(<SyncStatus compact />)
  const word = screen.getByText('Synced')
  expect(word.className).toContain('sr-only')
  // still the output's text, so a screen reader and a test read the same thing
  expect(screen.getByLabelText('Sync status').textContent).toBe('Synced')
})
