import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { DepartmentSwitch, FilterBox, FlagPills } from './CueListFilters'

const departments = [
  { id: 'lx', code: 'LX', colour: '#C9811F', count: 61 },
  { id: 'snd', code: 'SND', colour: '#2F6BD6', count: 28 },
  { id: 'tm', code: 'TM', colour: '#7A55D6', count: 7 },
]

test('the department switcher is a Segmented "Department" with a count on each', () => {
  const onChange = vi.fn()
  render(<DepartmentSwitch departments={departments} value="snd" onChange={onChange} />)
  const group = screen.getByRole('radiogroup', { name: 'Department' })
  const radios = within(group).getAllByRole('radio')
  expect(radios.map((r) => r.textContent)).toEqual(['LX61', 'SND28', 'TM7'])
  expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
  // the count is mono
  expect(within(radios[1] as HTMLElement).getByText('28').className).toContain('font-mono')
  fireEvent.click(radios[0] as HTMLElement)
  expect(onChange).toHaveBeenCalledWith('lx')
})

test('flag pills show their count with the word and toggle with aria-pressed', () => {
  const onToggle = vi.fn()
  render(
    <FlagPills
      counts={{ duplicate: 1, approximate: 3, unresolved: 0 }}
      active={{ duplicate: true, approximate: false, unresolved: false }}
      onToggle={onToggle}
    />,
  )
  const dup = screen.getByRole('button', { name: '1 duplicate' })
  expect(dup.getAttribute('aria-pressed')).toBe('true')
  const approx = screen.getByRole('button', { name: '3 approximate' })
  expect(approx.getAttribute('aria-pressed')).toBe('false')
  // a flag nobody has is not offered
  expect(screen.queryByRole('button', { name: /unresolved/ })).toBeNull()
  fireEvent.click(approx)
  expect(onToggle).toHaveBeenCalledWith('approximate')
})

test('a pressed pill stays while its count is 0 so it can be switched off', () => {
  render(
    <FlagPills
      counts={{ duplicate: 0, approximate: 0, unresolved: 0 }}
      active={{ duplicate: true, approximate: false, unresolved: false }}
      onToggle={() => {}}
    />,
  )
  expect(screen.getByRole('button', { name: '0 duplicate' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
})

test('the filter box has the / key hint, and "/" outside a field focuses it', () => {
  const onChange = vi.fn()
  render(<FilterBox value="" onChange={onChange} />)
  const input = screen.getByRole('searchbox', { name: 'Filter cues' })
  expect(screen.getByText('/')).toBeTruthy()
  fireEvent.keyDown(document.body, { key: '/' })
  expect(document.activeElement).toBe(input)
  fireEvent.change(input, { target: { value: 'harm' } })
  expect(onChange).toHaveBeenCalledWith('harm')
})

test('"/" typed in another field is text, not the filter shortcut', () => {
  render(
    <>
      <input aria-label="other" />
      <FilterBox value="" onChange={() => {}} />
    </>,
  )
  const other = screen.getByLabelText('other')
  other.focus()
  fireEvent.keyDown(other, { key: '/' })
  expect(document.activeElement).toBe(other)
})
