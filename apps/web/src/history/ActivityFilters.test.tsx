import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { ActivityFilters } from './ActivityFilters'

const departments = [
  { id: 'd1', code: 'LX', colour: '#e8a838' },
  { id: 'd2', code: 'SND', colour: '#4f8cff' },
]

const setup = (over: Partial<Parameters<typeof ActivityFilters>[0]> = {}) => {
  const onLayer = vi.fn()
  const onKind = vi.fn()
  render(
    <ActivityFilters
      departments={departments}
      userId="u1"
      layer=""
      kind="all"
      onLayerChange={onLayer}
      onKindChange={onKind}
      {...over}
    />,
  )
  return { onLayer, onKind }
}

test('Layer is a segmented radiogroup: All layers, each department by code, then Personal', () => {
  setup()
  const group = screen.getByRole('radiogroup', { name: 'Layer' })
  expect(
    within(group)
      .getAllByRole('radio')
      .map((r) => r.textContent),
  ).toEqual(['All layers', 'LX', 'SND', 'Personal'])
  expect(
    within(group).getByRole('radio', { name: 'All layers' }).getAttribute('aria-checked'),
  ).toBe('true')
})

test('choosing a layer reports its key; All layers reports the empty string', () => {
  const { onLayer } = setup({ layer: 'department:d1' })
  const group = screen.getByRole('radiogroup', { name: 'Layer' })
  fireEvent.click(within(group).getByRole('radio', { name: 'SND' }))
  expect(onLayer).toHaveBeenCalledWith('department:d2')
  fireEvent.click(within(group).getByRole('radio', { name: 'Personal' }))
  expect(onLayer).toHaveBeenCalledWith('personal:u1')
  fireEvent.click(within(group).getByRole('radio', { name: 'All layers' }))
  expect(onLayer).toHaveBeenCalledWith('')
})

test('Changes by: People and agents, People, Agents', () => {
  const { onKind } = setup()
  const group = screen.getByRole('radiogroup', { name: 'Changes by' })
  expect(
    within(group)
      .getAllByRole('radio')
      .map((r) => r.textContent),
  ).toEqual(['People and agents', 'People', 'Agents'])
  fireEvent.click(within(group).getByRole('radio', { name: 'People' }))
  expect(onKind).toHaveBeenCalledWith('human')
  fireEvent.click(within(group).getByRole('radio', { name: 'Agents' }))
  expect(onKind).toHaveBeenCalledWith('agent')
})

test('without a signed-in user there is no Personal layer', () => {
  setup({ userId: undefined })
  expect(screen.queryByRole('radio', { name: 'Personal' })).toBeNull()
})
