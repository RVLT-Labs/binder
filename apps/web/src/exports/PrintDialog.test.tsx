import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { installDialogPolyfill } from '../test/dialog'

const h = vi.hoisted(() => ({
  run: vi.fn(),
  /** The first page's size in points, and the show's settings text: set per test. */
  page: { width: 595.28, height: 841.89 },
  settings: '{"markerSides":{"snd":"right"}}',
}))
vi.mock('@powersync/react', () => ({
  usePowerSync: () => ({}),
  useQuery: (sql: string) => ({
    data: sql.includes('document_versions')
      ? [
          {
            doc_title: 'Libretto',
            version_number: 2,
            show_title: 'Songs for a New World',
            page_count: 43,
            settings: h.settings,
          },
        ]
      : sql.includes('FROM cues')
        ? [
            { id: 'lx', n: 61 },
            { id: 'snd', n: 28 },
          ]
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
    pages: new Array(43).fill(null).map(() => ({ ...h.page })),
    userId: 'u1',
    departments: [
      { id: 'lx', code: 'LX', hidden: 0, colour: '#C9811F' },
      { id: 'snd', code: 'SND', hidden: 0, colour: '#4F8BE8' },
    ],
    markerSide: (id: string) => (id === 'snd' ? 'right' : 'left'),
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
  h.page = { width: 595.28, height: 841.89 }
  h.settings = '{"markerSides":{"snd":"right"}}'
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
  expect(dialog.textContent).toContain('28')
  expect(dialog.textContent).toContain('Saved to Exports. Works offline.')
  // The presets are the mockup's two links; "All" keeps the name the e2e finds it by.
  expect(screen.getByRole('button', { name: 'Calling script: all layers' }).textContent).toBe('All')
  expect(screen.getByRole('button', { name: 'Only mine' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Clean copy' })).toBeNull()
  expect(screen.getByLabelText('Personal layer')).toBeTruthy()
  // Cancel is ghost (transparent border), the red one is Download PDF.
  expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('border-transparent')
  expect(screen.getByRole('button', { name: 'Download PDF' }).className).toContain('bg-red')
  expect(screen.queryByRole('button', { name: 'Export PDF' })).toBeNull()
})

async function openDialog() {
  render(<PrintButton />)
  fireEvent.click(screen.getByRole('button', { name: 'Print' }))
  return screen.findByRole('dialog', { name: 'Print Libretto v2' })
}
const download = () => screen.getByRole('button', { name: 'Download PDF' }) as HTMLButtonElement
const rangeInput = () => screen.getByLabelText('Page range') as HTMLInputElement
const fileName = () => screen.getByLabelText('File name') as HTMLInputElement
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } })

test("the sheet has the mockup's sections: Layers, Pages, Paper, Include, the preview and the file name", async () => {
  const dialog = await openDialog()
  expect(within(dialog).getByRole('radio', { name: 'All 43' }).getAttribute('aria-checked')).toBe(
    'true',
  )
  expect(within(dialog).getByRole('radio', { name: 'Range' }).getAttribute('aria-checked')).toBe(
    'false',
  )
  expect(rangeInput().placeholder).toBe('1–43')
  expect(rangeInput().className).toContain('font-mono')
  expect(within(dialog).getByRole('radio', { name: 'A4' }).getAttribute('aria-checked')).toBe(
    'true',
  )
  expect(within(dialog).getByRole('radio', { name: 'Letter' })).toBeTruthy()
  for (const name of ['Cue notes', 'Standby and warn tags', 'Annotations']) {
    expect(
      (within(dialog).getByRole('checkbox', { name }) as HTMLElement).getAttribute('aria-checked'),
    ).toBe('true')
  }
  expect(
    within(dialog).getByRole('img', { name: 'Preview: LX tags on the left, SND on the right' }),
  ).toBeTruthy()
  expect(within(dialog).getByText('Sides follow the show settings')).toBeTruthy()
  expect(fileName().value).toBe('songs-for-a-new-world-libretto-v2-all-layers.pdf')
  expect(fileName().className).toContain('font-mono')
  expect(dialog.textContent).not.toContain('Footer layers')
})

test('range input shows the error and disables Download when invalid', async () => {
  await openDialog()
  fireEvent.click(screen.getByRole('radio', { name: 'Range' }))
  // Nothing typed yet: Download waits, with no scolding.
  expect(download().disabled).toBe(true)
  expect(rangeInput().getAttribute('aria-invalid')).not.toBe('true')
  type(rangeInput(), '1-99')
  expect(rangeInput().getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByText('This script has 43 pages.')).toBeTruthy()
  expect(rangeInput().getAttribute('aria-describedby')).toBe(
    screen.getByText('This script has 43 pages.').id,
  )
  expect(download().disabled).toBe(true)
  type(rangeInput(), 'a-b')
  expect(screen.getByText('Pages look like 1–43 or 3, 7–9.')).toBeTruthy()
  expect(download().disabled).toBe(true)
  type(rangeInput(), '2–3, 7')
  expect(rangeInput().getAttribute('aria-invalid')).not.toBe('true')
  expect(screen.queryByText(/This script has/)).toBeNull()
  expect(download().disabled).toBe(false)
  // Going back to All pages ignores whatever the range says.
  type(rangeInput(), '99')
  expect(download().disabled).toBe(true)
  fireEvent.click(screen.getByRole('radio', { name: 'All 43' }))
  expect(download().disabled).toBe(false)
})

test('typing in the range field switches to Range', async () => {
  await openDialog()
  type(rangeInput(), '5')
  expect(screen.getByRole('radio', { name: 'Range' }).getAttribute('aria-checked')).toBe('true')
})

test('file name follows the choices until edited, then stays', async () => {
  await openDialog()
  expect(fileName().value).toBe('songs-for-a-new-world-libretto-v2-all-layers.pdf')
  fireEvent.click(screen.getByRole('checkbox', { name: 'SND' }))
  expect(fileName().value).toBe('songs-for-a-new-world-libretto-v2-LX.pdf')
  fireEvent.click(screen.getByRole('button', { name: 'Only mine' }))
  expect(fileName().value).toBe('songs-for-a-new-world-libretto-v2-personal.pdf')
  fireEvent.click(screen.getByRole('button', { name: 'Calling script: all layers' }))
  expect(fileName().value).toBe('songs-for-a-new-world-libretto-v2-all-layers.pdf')
  type(fileName(), 'tech-rehearsal.pdf')
  fireEvent.click(screen.getByRole('checkbox', { name: 'SND' }))
  expect(fileName().value).toBe('tech-rehearsal.pdf')
})

test('an invalid file name disables Download with the reason', async () => {
  await openDialog()
  type(fileName(), 'a/b.pdf')
  expect(fileName().getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByText(`File names can't contain / \\ : * ? " < > |`)).toBeTruthy()
  expect(fileName().getAttribute('aria-describedby')).toBe(
    screen.getByText(`File names can't contain / \\ : * ? " < > |`).id,
  )
  expect(download().disabled).toBe(true)
  type(fileName(), '')
  expect(screen.getByText('Give the file a name.')).toBeTruthy()
  expect(download().disabled).toBe(true)
  type(fileName(), 'fine')
  expect(fileName().getAttribute('aria-invalid')).not.toBe('true')
  expect(download().disabled).toBe(false)
})

test('submit passes pages, paper and include flags to runPrintExport', async () => {
  h.run.mockResolvedValue({ filename: 'x.pdf' })
  await openDialog()
  fireEvent.click(screen.getByRole('radio', { name: 'Range' }))
  type(rangeInput(), '2 – 3, 3')
  fireEvent.click(screen.getByRole('radio', { name: 'Letter' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Standby and warn tags' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Annotations' }))
  type(fileName(), 'act-one')
  fireEvent.click(download())
  await waitFor(() => expect(h.run).toHaveBeenCalledOnce())
  const [, , input] = h.run.mock.calls[0] as [unknown, unknown, Record<string, unknown>]
  expect(input).toEqual({
    documentId: 'd1',
    versionId: 'v1',
    layers: [
      { kind: 'department', id: 'lx' },
      { kind: 'department', id: 'snd' },
    ],
    options: {
      pages: '2-3',
      paper: 'Letter',
      includeStandbyWarn: false,
      includeAnnotations: false,
      includeCueNotes: true,
    },
    filename: 'act-one',
  })
})

test('an untouched dialog prints all pages on the paper the script already is, with the default name', async () => {
  h.run.mockResolvedValue({ filename: 'x.pdf' })
  await openDialog()
  fireEvent.click(download())
  await waitFor(() => expect(h.run).toHaveBeenCalledOnce())
  const input = h.run.mock.calls[0]?.[2] as { options: object; filename: string }
  expect(input.options).toEqual({
    pages: 'all',
    paper: 'A4',
    includeStandbyWarn: true,
    includeAnnotations: true,
    includeCueNotes: true,
  })
  expect(input.filename).toBe('songs-for-a-new-world-libretto-v2-all-layers.pdf')
})

test("the paper starts at the one nearest page 1's size, within 3%, else the show's setting", async () => {
  // A Letter script in an A4 show: Letter, so printing changes nothing.
  h.page = { width: 612, height: 792 }
  h.settings = '{"paperSize":"A4"}'
  let dialog = await openDialog()
  expect(within(dialog).getByRole('radio', { name: 'Letter' }).getAttribute('aria-checked')).toBe(
    'true',
  )
  cleanup()
  // A landscape A4 page counts as A4.
  h.page = { width: 841.89, height: 595.28 }
  h.settings = '{"paperSize":"Letter"}'
  dialog = await openDialog()
  expect(within(dialog).getByRole('radio', { name: 'A4' }).getAttribute('aria-checked')).toBe(
    'true',
  )
  cleanup()
  // A page near neither: the show's paper.
  h.page = { width: 500, height: 700 }
  h.settings = '{"paperSize":"Letter"}'
  dialog = await openDialog()
  expect(within(dialog).getByRole('radio', { name: 'Letter' }).getAttribute('aria-checked')).toBe(
    'true',
  )
})

test('"Only mine" prints just the personal layer; All brings the departments back', async () => {
  await openDialog()
  fireEvent.click(screen.getByRole('button', { name: 'Only mine' }))
  expect(screen.getByLabelText('Personal layer').getAttribute('aria-checked')).toBe('true')
  expect(screen.getByRole('checkbox', { name: 'LX' }).getAttribute('aria-checked')).toBe('false')
  expect(screen.getByText('Only you will see this export.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Calling script: all layers' }))
  expect(screen.getByLabelText('Personal layer').getAttribute('aria-checked')).toBe('false')
  expect(screen.getByRole('checkbox', { name: 'LX' }).getAttribute('aria-checked')).toBe('true')
})

test('the preview follows the layers, the paper and the standby toggle', async () => {
  const dialog = await openDialog()
  const preview = () => within(dialog).getByRole('img')
  fireEvent.click(screen.getByRole('checkbox', { name: 'SND' }))
  expect(preview().getAttribute('aria-label')).toBe('Preview: LX tags on the left')
  expect(preview().querySelectorAll('[data-kind="standby"]')).toHaveLength(1)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Standby and warn tags' }))
  expect(preview().querySelectorAll('[data-kind="standby"]')).toHaveLength(0)
  const a4Height = Number(preview().getAttribute('height'))
  fireEvent.click(screen.getByRole('radio', { name: 'Letter' }))
  expect(Number(preview().getAttribute('height'))).toBeLessThan(a4Height)
})
