import type { CueListRow } from '@binder/core'
import { fireEvent, render, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { CueListTable } from './CueListTable'

const row = (over: Partial<CueListRow> = {}): CueListRow => ({
  id: 'c1',
  display: '12',
  type: 'go',
  label: 'Sunrise',
  page: 'p.2',
  documentTitle: '',
  trigger: 'and so it begins',
  notes: '',
  flags: [],
  placed: true,
  anchor: {
    documentId: 'd',
    documentVersionId: 'v',
    pageIndex: 1,
    x: 1,
    y: 2,
    status: 'ok',
  },
  ...over,
})

const numberField = (c: HTMLElement) =>
  within(c).getByLabelText('Number, row 1') as HTMLInputElement

test('a valid number is saved as parsed; "abc" shows the error and writes nothing', () => {
  const onEdit = vi.fn()
  const { container, queryByRole, getByRole } = render(
    <CueListTable rows={[row()]} readOnly={null} onEdit={onEdit} onOpen={() => {}} />,
  )
  const input = numberField(container)
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: 'abc' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(getByRole('alert').textContent).toMatch(/Cue numbers look like/)
  expect(onEdit).not.toHaveBeenCalled()

  fireEvent.change(input, { target: { value: '12.5' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onEdit).toHaveBeenCalledWith('c1', { major: 12, minor: 50 })
  expect(queryByRole('alert')).toBeNull()
})

test('an unchanged number writes nothing', () => {
  const onEdit = vi.fn()
  const { container } = render(
    <CueListTable rows={[row()]} readOnly={null} onEdit={onEdit} onOpen={() => {}} />,
  )
  const input = numberField(container)
  fireEvent.focus(input)
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onEdit).not.toHaveBeenCalled()
})

test('a read-only list disables every field', () => {
  const { container } = render(
    <CueListTable rows={[row()]} readOnly="archived" onEdit={() => {}} onOpen={() => {}} />,
  )
  for (const el of container.querySelectorAll('input, select')) {
    expect((el as HTMLInputElement).disabled).toBe(true)
  }
})

test('duplicate and anchor flags show as badges', () => {
  const { getByText } = render(
    <CueListTable
      rows={[row({ flags: ['duplicate', 'older-version'] })]}
      readOnly={null}
      onEdit={() => {}}
      onOpen={() => {}}
    />,
  )
  expect(getByText('Duplicate')).toBeTruthy()
  expect(getByText('Older version')).toBeTruthy()
})

test('a click on a placed row opens it; a click in a field or on an unplaced row does not', () => {
  const onOpen = vi.fn()
  const { container } = render(
    <CueListTable
      rows={[row(), row({ id: 'c2', placed: false, anchor: null, page: '—' })]}
      readOnly={null}
      onEdit={() => {}}
      onOpen={onOpen}
    />,
  )
  fireEvent.click(numberField(container))
  expect(onOpen).not.toHaveBeenCalled()
  fireEvent.click(container.querySelector('tr[data-cue-id="c1"] .cue-trigger') as HTMLElement)
  expect(onOpen).toHaveBeenCalledTimes(1)
  expect(onOpen.mock.calls[0]?.[0].id).toBe('c1')
  fireEvent.click(container.querySelector('tr[data-cue-id="c2"] .cue-trigger') as HTMLElement)
  expect(onOpen).toHaveBeenCalledTimes(1)
})
