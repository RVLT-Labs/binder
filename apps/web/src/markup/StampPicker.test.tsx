import { fireEvent, render } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { chosenStamp, StampPicker } from './StampPicker'
import { readStamps, withStamps } from './stampSettings'

test('it offers the stamps of the set and reports a choice', () => {
  const onChange = vi.fn()
  const { getByLabelText } = render(
    <StampPicker stamps={['Enter', 'Exit']} value="Exit" onChange={onChange} />,
  )
  const select = getByLabelText('Stamp') as HTMLSelectElement
  expect([...select.options].map((o) => o.value)).toEqual(['Enter', 'Exit'])
  expect(select.value).toBe('Exit')
  fireEvent.change(select, { target: { value: 'Enter' } })
  expect(onChange).toHaveBeenCalledWith('Enter')
})

test('with nothing chosen, or a choice that left the set, the first stamp is the one placed', () => {
  expect(chosenStamp(['A', 'B'], null)).toBe('A')
  expect(chosenStamp(['A', 'B'], 'Gone')).toBe('A')
  expect(chosenStamp(['A', 'B'], 'B')).toBe('B')
  expect(chosenStamp([], null)).toBeNull()
})

test('a stamp set the owner saved is what the picker lists', () => {
  const saved = withStamps('{}', ['Hold', 'Go'])
  const { getByLabelText } = render(
    <StampPicker stamps={readStamps(saved)} value={null} onChange={() => {}} />,
  )
  expect([...(getByLabelText('Stamp') as HTMLSelectElement).options].map((o) => o.value)).toEqual([
    'Hold',
    'Go',
  ])
})
