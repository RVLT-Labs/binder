import { act, fireEvent, render } from '@testing-library/react'
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

const renderButtons = (over: Partial<Parameters<typeof CueSheetButtons>[0]> = {}) =>
  render(
    <CueSheetButtons departmentId="d-lx" departmentCode="LX" editContext={() => ctx} {...over} />,
  )

test('PDF, XLSX and CSV buttons each export their format for the department, then ask for a flush', async () => {
  const { getByRole } = renderButtons()
  for (const [label, format] of [
    ['PDF', 'pdf'],
    ['XLSX', 'xlsx'],
    ['CSV', 'csv'],
  ] as const) {
    await act(async () => {
      fireEvent.click(getByRole('button', { name: label }))
    })
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
  const { getByRole } = renderButtons()
  await act(async () => {
    fireEvent.click(getByRole('button', { name: 'CSV' }))
  })
  expect(getNotices().at(-1)?.message).toMatch(/recorded in Exports when you are back online/)
})

test('a failure is a notice naming the department, and the buttons come back', async () => {
  runCueSheetExport.mockRejectedValue(new Error('disk full'))
  const { getByRole } = renderButtons()
  await act(async () => {
    fireEvent.click(getByRole('button', { name: 'XLSX' }))
  })
  expect(getNotices().at(-1)).toMatchObject({
    kind: 'error',
    message: 'Could not export the LX cue sheet: disk full',
  })
  expect(flushSoon).not.toHaveBeenCalled()
  expect((getByRole('button', { name: 'XLSX' }) as HTMLButtonElement).disabled).toBe(false)
})

test('does nothing before the session is ready', async () => {
  const { getByRole } = renderButtons({ editContext: () => null })
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
  const { getByRole } = renderButtons()
  await act(async () => {
    fireEvent.click(getByRole('button', { name: 'XLSX' }))
  })
  expect(getByRole('button', { name: 'Preparing…' })).toBeTruthy()
  expect((getByRole('button', { name: 'PDF' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => {
    finish({ id: 'e', filename: 'x.xlsx', bytes: new Uint8Array() })
  })
  expect((getByRole('button', { name: 'PDF' }) as HTMLButtonElement).disabled).toBe(false)
})
