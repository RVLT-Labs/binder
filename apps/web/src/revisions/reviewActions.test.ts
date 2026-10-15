import { expect, test } from 'vitest'
import { reviewItemActions } from './reviewActions'

const by = (list: ReturnType<typeof reviewItemActions>) =>
  Object.fromEntries(list.map((a) => [a.kind, a.disabled]))

test('a pending item offers Accept, Move and Revert, not Re-anchor', () => {
  const actions = reviewItemActions({ section: 'pending', hasPrevious: true, whyCantEdit: null })
  expect(actions.map((a) => a.kind)).toEqual(['accept', 'move', 'revert'])
  expect(actions.map((a) => a.label)).toEqual(['Accept', 'Move', 'Revert to old version'])
  expect(by(actions)).toEqual({ accept: null, move: null, revert: null })
})

test('an item on an older version offers Re-anchor and Move only; Accept is never offered', () => {
  const actions = reviewItemActions({ section: 'older', hasPrevious: true, whyCantEdit: null })
  expect(actions.map((a) => a.kind)).toEqual(['reanchor', 'move'])
})

test('Revert is disabled with a reason when no run ever moved the item', () => {
  const actions = reviewItemActions({ section: 'pending', hasPrevious: false, whyCantEdit: null })
  expect(by(actions).revert).toMatch(/no earlier position/i)
  expect(by(actions).accept).toBeNull()
})

test('every action is disabled with the session’s reason when the user cannot edit the layer', () => {
  for (const section of ['pending', 'older'] as const) {
    const actions = reviewItemActions({
      section,
      hasPrevious: true,
      whyCantEdit: "You can't edit LX cues.",
    })
    expect(actions.every((a) => a.disabled === "You can't edit LX cues.")).toBe(true)
  }
})
