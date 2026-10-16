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
    <CueListTable
      rows={[row()]}
      selectedId={null}
      readOnly={null}
      onEdit={onEdit}
      onSelect={() => {}}
    />,
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
    <CueListTable
      rows={[row()]}
      selectedId={null}
      readOnly={null}
      onEdit={onEdit}
      onSelect={() => {}}
    />,
  )
  const input = numberField(container)
  fireEvent.focus(input)
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onEdit).not.toHaveBeenCalled()
})

test('a read-only list disables every field', () => {
  const { container } = render(
    <CueListTable
      rows={[row()]}
      selectedId={null}
      readOnly="archived"
      onEdit={() => {}}
      onSelect={() => {}}
    />,
  )
  for (const el of container.querySelectorAll('input, select')) {
    expect((el as HTMLInputElement).disabled).toBe(true)
  }
})

test('duplicate and anchor flags show as badges', () => {
  const { getByText } = render(
    <CueListTable
      rows={[row({ flags: ['duplicate', 'approximate', 'older-version'] })]}
      selectedId={null}
      readOnly={null}
      onEdit={() => {}}
      onSelect={() => {}}
    />,
  )
  expect(getByText('duplicate')).toBeTruthy()
  expect(getByText('approx.')).toBeTruthy()
  expect(getByText('older version')).toBeTruthy()
})

test('a click on a row selects it; a click in a field does not', () => {
  const onSelect = vi.fn()
  const { container } = render(
    <CueListTable
      rows={[row(), row({ id: 'c2', placed: false, anchor: null, page: '—' })]}
      selectedId={null}
      readOnly={null}
      onEdit={() => {}}
      onSelect={onSelect}
    />,
  )
  fireEvent.click(numberField(container))
  expect(onSelect).not.toHaveBeenCalled()
  fireEvent.click(container.querySelector('tr[data-cue-id="c1"] .cue-trigger') as HTMLElement)
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(onSelect.mock.calls[0]?.[0].id).toBe('c1')
  // the page cell is text now: "Show on page" lives in the panel
  fireEvent.click(container.querySelector('tr[data-cue-id="c1"] .cue-page') as HTMLElement)
  expect(onSelect).toHaveBeenCalledTimes(2)
  expect(container.querySelector('.cue-page button')).toBeNull()
  // an unplaced cue can be selected too (its panel says it is not on a page)
  fireEvent.click(container.querySelector('tr[data-cue-id="c2"] .cue-trigger') as HTMLElement)
  expect(onSelect.mock.calls[2]?.[0].id).toBe('c2')
})

test('Enter or Space on a focused row selects it; Enter inside a field only commits that field', () => {
  const onSelect = vi.fn()
  const { container } = render(
    <CueListTable
      rows={[row()]}
      selectedId={null}
      readOnly={null}
      onEdit={() => {}}
      onSelect={onSelect}
    />,
  )
  const tr = container.querySelector('tr[data-cue-id="c1"]') as HTMLElement
  expect(tr.tabIndex).toBe(0)
  fireEvent.keyDown(numberField(container), { key: 'Enter' })
  expect(onSelect).not.toHaveBeenCalled()
  fireEvent.keyDown(tr, { key: 'Enter' })
  fireEvent.keyDown(tr, { key: ' ' })
  expect(onSelect).toHaveBeenCalledTimes(2)
})

test('the selected row carries the red outline and fill, and says it is current', () => {
  const { container } = render(
    <CueListTable
      rows={[row(), row({ id: 'c2' })]}
      selectedId="c2"
      readOnly={null}
      onEdit={() => {}}
      onSelect={() => {}}
    />,
  )
  const [a, b] = [...container.querySelectorAll('tr[data-cue-id]')] as HTMLElement[]
  expect(a?.getAttribute('aria-current')).toBeNull()
  expect(b?.getAttribute('aria-current')).toBe('true')
  expect(b?.getAttribute('data-selected')).toBe('true')
  expect(b?.className).toContain('outline-red')
})

test('the number is mono and tabular, the trigger mono, the page right-aligned, and the type is Go, Standby or Warn', () => {
  const { container } = render(
    <CueListTable
      rows={[row()]}
      selectedId={null}
      readOnly={null}
      onEdit={() => {}}
      onSelect={() => {}}
    />,
  )
  expect(numberField(container).className).toContain('font-mono')
  expect(numberField(container).className).toContain('tabular-nums')
  expect(container.querySelector('.cue-trigger')?.className).toContain('font-mono')
  expect(container.querySelector('.cue-page')?.className).toContain('text-right')
  const type = within(container).getByLabelText('Type, row 1') as HTMLSelectElement
  expect([...type.options].map((o) => o.text)).toEqual(['Go', 'Standby', 'Warn'])
})

test('the number error clears when the stored value is typed back, and on Escape', () => {
  const onEdit = vi.fn()
  const { container, queryByRole } = render(
    <CueListTable
      rows={[row()]}
      selectedId={null}
      readOnly={null}
      onEdit={onEdit}
      onSelect={() => {}}
    />,
  )
  const input = numberField(container)

  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: 'abc' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(queryByRole('alert')).not.toBeNull()
  // Retyping the stored number and leaving the field is not an edit, and the error goes.
  fireEvent.change(input, { target: { value: '12' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(queryByRole('alert')).toBeNull()
  expect(onEdit).not.toHaveBeenCalled()

  fireEvent.change(input, { target: { value: 'abc' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(queryByRole('alert')).not.toBeNull()
  fireEvent.change(input, { target: { value: '12' } })
  fireEvent.blur(input)
  expect(queryByRole('alert')).toBeNull()

  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: 'abc' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(queryByRole('alert')).not.toBeNull()
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: 'zzz' } })
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(queryByRole('alert')).toBeNull()
  expect(onEdit).not.toHaveBeenCalled()
})
