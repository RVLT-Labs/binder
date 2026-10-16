import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { installDialogPolyfill } from '../test/dialog'

const h = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@powersync/react', () => ({ usePowerSync: () => ({}) }))
vi.mock('../offline/useOnline', () => ({ useOnline: () => true }))
vi.mock('./flusher', () => ({ flushSoon: () => {} }))
vi.mock('./runPrintExport', () => ({ runPrintExport: (...args: unknown[]) => h.run(...args) }))
vi.mock('./printCore', () => ({}))
vi.mock('../markup/MarkupSession', () => ({
  useMarkupSession: () => ({
    documentId: 'd1',
    versionId: 'v1',
    userId: 'u1',
    departments: [{ id: 'lx', code: 'LX', hidden: 0, colour: '#C9811F' }],
    editContext: () => ({}),
  }),
}))

import { PrintButton } from './PrintDialog'

beforeEach(() => {
  // Radix's checkbox measures itself; jsdom has no ResizeObserver.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  installDialogPolyfill()
  h.run.mockReset()
})

test('after a successful export the dialog closes and focus is back on the Print button', async () => {
  h.run.mockResolvedValue({ filename: 'show.pdf' })
  render(<PrintButton />)
  const print = screen.getByRole('button', { name: 'Print' })
  print.focus()
  fireEvent.click(print)
  const dialog = await screen.findByRole('dialog', { name: 'Print' })
  fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Print' })).toBeNull())
  expect(dialog.isConnected).toBe(false)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Print' }))
})

test('Cancel also returns focus to the Print button', async () => {
  render(<PrintButton />)
  const print = screen.getByRole('button', { name: 'Print' })
  fireEvent.click(print)
  await screen.findByRole('dialog', { name: 'Print' })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Print' })).toBeNull())
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Print' }))
})
