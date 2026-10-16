import type { CueListRow } from '@binder/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { CueDetail } from './CueDetail'

const row = (over: Partial<CueListRow> = {}): CueListRow => ({
  id: 'c1',
  display: '2.20',
  type: 'go',
  label: 'Verse 2 swell',
  page: 'p.1',
  documentTitle: '',
  trigger: 'And the road will end',
  notes: 'singing overlaps',
  flags: [],
  placed: true,
  anchor: { documentId: 'd', documentVersionId: 'v', pageIndex: 0, x: 1, y: 2, status: 'ok' },
  ...over,
})
const department = { code: 'SND', colour: '#2F6BD6' }

const detail = (over: Partial<Parameters<typeof CueDetail>[0]> = {}) => {
  const onEdit = vi.fn()
  const onShowOnPage = vi.fn()
  const utils = render(
    <CueDetail
      row={row()}
      department={department}
      readOnly={null}
      phone={false}
      onEdit={onEdit}
      onShowOnPage={onShowOnPage}
      history={<p>history rows</p>}
      {...over}
    />,
  )
  return { ...utils, onEdit, onShowOnPage }
}

test('the head names the department and the cue number in 18 px mono, with Show on page beside it', () => {
  const { onShowOnPage } = detail()
  const section = screen.getByRole('region', { name: 'Cue details' })
  expect(section.textContent).toContain('SND')
  const number = screen.getByText('2.20')
  expect(number.className).toContain('font-mono')
  expect(number.className).toContain('text-[18px]')
  fireEvent.click(screen.getByRole('button', { name: 'Show on page' }))
  expect(onShowOnPage).toHaveBeenCalledTimes(1)
})

test('an unplaced cue cannot be shown on a page, and the panel says so', () => {
  detail({ row: row({ placed: false, anchor: null, trigger: '', page: '—' }) })
  expect((screen.getByRole('button', { name: 'Show on page' }) as HTMLButtonElement).disabled).toBe(
    true,
  )
  expect(screen.getByText(/not on a page yet/i)).toBeTruthy()
  expect(screen.queryByText('Trigger')).toBeNull()
})

test('the label and notes save on Enter or blur; an unchanged value saves nothing', () => {
  const { onEdit } = detail()
  const label = screen.getByLabelText('Label')
  fireEvent.focus(label)
  fireEvent.change(label, { target: { value: 'Verse two swell' } })
  fireEvent.keyDown(label, { key: 'Enter' })
  expect(onEdit).toHaveBeenCalledWith({ label: 'Verse two swell' })
  onEdit.mockClear()
  const notes = screen.getByLabelText('Notes')
  fireEvent.focus(notes)
  fireEvent.blur(notes)
  expect(onEdit).not.toHaveBeenCalled()
  fireEvent.focus(notes)
  fireEvent.change(notes, { target: { value: 'ride the pad' } })
  fireEvent.blur(notes)
  expect(onEdit).toHaveBeenCalledWith({ notes: 'ride the pad' })
})

test('the trigger is the quote in a department-ruled block with its page', () => {
  detail()
  const quote = screen.getByText(/And the road will end/)
  expect(quote.className).toContain('font-mono')
  expect(quote.textContent).toContain('p.1')
})

test('a read-only cue disables its fields and gives the reason', () => {
  detail({ readOnly: "You can't edit SND cues." })
  expect(screen.getByText("You can't edit SND cues.")).toBeTruthy()
  expect(screen.getByLabelText('Label').matches(':disabled')).toBe(true)
  expect(screen.getByLabelText('Notes').matches(':disabled')).toBe(true)
})

test('history sits under its own section label', () => {
  detail()
  expect(screen.getByText('History')).toBeTruthy()
  expect(screen.getByText('history rows')).toBeTruthy()
})

test('on a phone the number and type are here too, since cards do not edit: a bad number is an error', () => {
  const { onEdit } = detail({ phone: true })
  const number = screen.getByLabelText('Number')
  fireEvent.focus(number)
  fireEvent.change(number, { target: { value: 'abc' } })
  fireEvent.keyDown(number, { key: 'Enter' })
  expect(screen.getByRole('alert').textContent).toMatch(/Cue numbers look like/)
  expect(onEdit).not.toHaveBeenCalled()
  fireEvent.change(number, { target: { value: '2.5' } })
  fireEvent.keyDown(number, { key: 'Enter' })
  expect(onEdit).toHaveBeenCalledWith({ major: 2, minor: 50 })
  fireEvent.click(screen.getByRole('radio', { name: 'Warn' }))
  expect(onEdit).toHaveBeenCalledWith({ type: 'warn' })
})

test('on desktop the number and type are in the table, not the panel', () => {
  detail({ phone: false })
  expect(screen.queryByLabelText('Number')).toBeNull()
  expect(screen.queryByRole('radiogroup', { name: 'Type' })).toBeNull()
})
