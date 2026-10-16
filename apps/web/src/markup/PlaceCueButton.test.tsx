import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { setTool } from './tools'

const h = vi.hoisted(() => ({ session: {} as Record<string, unknown> }))
vi.mock('./MarkupSession', () => ({ useMarkupSession: () => h.session }))

import { PlaceCueButton } from './PlaceCueButton'

const placeCue = vi.fn(async () => {})
function session(over: Record<string, unknown> = {}) {
  placeCue.mockClear()
  h.session = {
    cueTarget: { departmentId: 'lx' },
    placeCue,
    viewer: {
      current: { visiblePoint: () => ({ pageIndex: 2, point: { x: 306, y: 400 } }) },
    },
    ...over,
  }
}

beforeEach(() => {
  setTool('select', 'standby')
  session()
})

test('it is a red button at least 56 px high that says Place cue', () => {
  render(<PlaceCueButton />)
  const button = screen.getByRole('button', { name: 'Place cue' })
  expect(button.className).toContain('h-14')
  expect(button.className).toContain('bg-red')
})

test('it places a cue at the middle of the visible page, of the chosen type, through placeCue', () => {
  render(<PlaceCueButton />)
  fireEvent.click(screen.getByRole('button', { name: 'Place cue' }))
  expect(placeCue).toHaveBeenCalledWith(2, { x: 306, y: 400 }, 'standby')
})

test('it is off, with the reason, when cues cannot be placed', () => {
  session({ cueTarget: { disabled: 'This show is archived, so its markup is read-only.' } })
  render(<PlaceCueButton />)
  const button = screen.getByRole('button', { name: 'Place cue' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(button.title).toBe('This show is archived, so its markup is read-only.')
  fireEvent.click(button)
  expect(placeCue).not.toHaveBeenCalled()
})

test('it is gone while something is selected', () => {
  render(<PlaceCueButton hidden />)
  expect(screen.queryByRole('button', { name: 'Place cue' })).toBeNull()
})

test('with no page drawn yet it does nothing', () => {
  session({ viewer: { current: { visiblePoint: () => null } } })
  render(<PlaceCueButton />)
  fireEvent.click(screen.getByRole('button', { name: 'Place cue' }))
  expect(placeCue).not.toHaveBeenCalled()
})
