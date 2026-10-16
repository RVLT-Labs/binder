import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { clearNotices, getNotices } from '../components/noticeStore'
import type { EditContext } from '../markup/mutations'

let online = true
const runCueSheetExport = vi.fn()
const flushSoon = vi.fn()
vi.mock('@powersync/react', () => ({ usePowerSync: () => ({ marker: 'db' }) }))
vi.mock('../offline/useOnline', () => ({ useOnline: () => online }))
vi.mock('../exports/flusher', () => ({ flushSoon: () => flushSoon() }))
vi.mock('../exports/runCueSheetExport', () => ({
  runCueSheetExport: (...args: unknown[]) => runCueSheetExport(...args),
}))
const { CueSheetButtons } = await import('./CueSheetButtons')

const ctx: EditContext = {
  showId: 's1',
  userId: 'u1',
  scope: { role: 'viewer', departments: [] },
}

beforeEach(() => {
  online = true
  clearNotices()
  vi.clearAllMocks()
  runCueSheetExport.mockResolvedValue({
    id: 'e1',
    filename: 'Show - LX cue sheet.pdf',
    bytes: new Uint8Array(),
  })
})

const renderButtons = (over: Partial<Parameters<typeof CueSheetButtons>[0]> = {}) => {
  const utils = render(
    <CueSheetButtons departmentId="d-lx" departmentCode="LX" editContext={() => ctx} {...over} />,
  )
  // The formats sit behind the top bar's Export button, as in the mockup.
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Export' }))
  return { ...utils, open }
}

test('the Export button opens the "Export cue sheet" group of PDF, XLSX and CSV, which closes after one', () => {
  const { open } = renderButtons()
  expect(screen.queryByRole('group', { name: 'Export cue sheet' })).toBeNull()
  open()
  const group = screen.getByRole('group', { name: 'Export cue sheet' })
  expect(group.querySelectorAll('button')).toHaveLength(3)
  expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
    'PDF',
    'XLSX',
    'CSV',
  ])
})

test('PDF, XLSX and CSV buttons each export their format for the department, then ask for a flush', async () => {
  const { getByRole, open } = renderButtons()
  for (const [label, format] of [
    ['PDF', 'pdf'],
    ['XLSX', 'xlsx'],
    ['CSV', 'csv'],
  ] as const) {
    open()
    await act(async () => {
      fireEvent.click(getByRole('button', { name: label }))
    })
    expect(screen.queryByRole('group', { name: 'Export cue sheet' })).toBeNull()
    expect(runCueSheetExport).toHaveBeenLastCalledWith({ marker: 'db' }, ctx, {
      departmentId: 'd-lx',
      format,
    })
  }
  expect(flushSoon).toHaveBeenCalledTimes(3)
  expect(getNotices().at(-1)?.message).toBe('Downloaded Show - LX cue sheet.pdf.')
})

test('offline, the notice says the record waits for the network', async () => {
  online = false
  const { getByRole, open } = renderButtons()
  open()
  await act(async () => {
    fireEvent.click(getByRole('button', { name: 'CSV' }))
  })
  expect(getNotices().at(-1)?.message).toMatch(/recorded in Exports when you are back online/)
})

test('a failure is a notice naming the department, and the buttons come back', async () => {
  runCueSheetExport.mockRejectedValue(new Error('disk full'))
  const { getByRole, open } = renderButtons()
  open()
  await act(async () => {
    fireEvent.click(getByRole('button', { name: 'XLSX' }))
  })
  expect(getNotices().at(-1)).toMatchObject({
    kind: 'error',
    message: 'Could not export the LX cue sheet: disk full',
  })
  expect(flushSoon).not.toHaveBeenCalled()
  open()
  expect((getByRole('button', { name: 'XLSX' }) as HTMLButtonElement).disabled).toBe(false)
})

test('does nothing before the session is ready', async () => {
  const { getByRole, open } = renderButtons({ editContext: () => null })
  open()
  await act(async () => {
    fireEvent.click(getByRole('button', { name: 'PDF' }))
  })
  expect(runCueSheetExport).not.toHaveBeenCalled()
})

test('while one export runs the others wait, and the running one says so', async () => {
  let finish: (v: unknown) => void = () => {}
  runCueSheetExport.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const { getByRole, open } = renderButtons()
  open()
  await act(async () => {
    fireEvent.click(getByRole('button', { name: 'XLSX' }))
  })
  // the group stays open while it works, so the running one can say so
  expect(getByRole('button', { name: 'Preparing…' })).toBeTruthy()
  expect((getByRole('button', { name: 'PDF' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => {
    finish({ id: 'e', filename: 'x.xlsx', bytes: new Uint8Array() })
  })
  open()
  expect((getByRole('button', { name: 'PDF' }) as HTMLButtonElement).disabled).toBe(false)
})

test('the group variant (the phone menu) is the group with no Export button, and calls onDone after an export', async () => {
  const onDone = vi.fn()
  render(
    <CueSheetButtons
      departmentId="d-lx"
      departmentCode="LX"
      editContext={() => ctx}
      variant="group"
      onDone={onDone}
    />,
  )
  expect(screen.queryByRole('button', { name: 'Export' })).toBeNull()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }))
  })
  expect(runCueSheetExport).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledTimes(1)
})
