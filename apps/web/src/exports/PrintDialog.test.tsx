import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { installDialogPolyfill } from '../test/dialog'

const h = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@powersync/react', () => ({
  usePowerSync: () => ({}),
  useQuery: (sql: string) => ({
    data: sql.includes('document_versions')
      ? [{ doc_title: 'Libretto', version_number: 2, show_title: 'Songs for a New World' }]
      : sql.includes('FROM cues')
        ? [{ id: 'lx', n: 61 }]
        : [{ n: 3 }],
  }),
}))
vi.mock('../offline/useOnline', () => ({ useOnline: () => true }))
vi.mock('./flusher', () => ({ flushSoon: () => {} }))
vi.mock('./runPrintExport', () => ({ runPrintExport: (...args: unknown[]) => h.run(...args) }))
vi.mock('./printCore', () => ({}))
vi.mock('../markup/MarkupSession', () => ({
  useMarkupSession: () => ({
    showId: 's1',
    documentId: 'd1',
    versionId: 'v1',
    pages: new Array(43).fill(null),
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
  const dialog = await screen.findByRole('dialog', { name: 'Print Libretto v2' })
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Print Libretto v2' })).toBeNull(),
  )
  expect(dialog.isConnected).toBe(false)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Print' }))
})

test('Cancel also returns focus to the Print button', async () => {
  render(<PrintButton />)
  const print = screen.getByRole('button', { name: 'Print' })
  fireEvent.click(print)
  await screen.findByRole('dialog', { name: 'Print Libretto v2' })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Print Libretto v2' })).toBeNull(),
  )
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Print' }))
})

test('the sheet is the mockup\'s: show over-label, "Print Libretto v2", the page count, layer counts in mono, a note and a ghost Cancel', async () => {
  render(<PrintButton />)
  fireEvent.click(screen.getByRole('button', { name: 'Print' }))
  const dialog = await screen.findByRole('dialog', { name: 'Print Libretto v2' })
  expect(dialog.textContent).toContain('Songs for a New World')
  expect(dialog.textContent).toContain('43 pages')
  expect(dialog.textContent).toContain('61')
  expect(dialog.textContent).toContain('Saved to Exports. Works offline.')
  // The presets keep the names the e2e finds them by; "Clean copy" is theirs too.
  expect(screen.getByRole('button', { name: 'Calling script: all layers' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Clean copy' })).toBeTruthy()
  expect(screen.getByLabelText('Personal layer')).toBeTruthy()
  // Cancel is ghost (transparent border), the red one is Download PDF.
  expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('border-transparent')
  expect(screen.getByRole('button', { name: 'Download PDF' }).className).toContain('bg-red')
  expect(screen.queryByRole('button', { name: 'Export PDF' })).toBeNull()
})
