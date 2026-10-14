import { expect, test } from 'vitest'
import { isLayerVisibleTo, redactPersonalLayer } from './history'

const moved = { layerKind: 'personal', layerId: 'u1' }

test('the owner of the personal layer sees its id', () =>
  expect(redactPersonalLayer(moved, 'u1')).toEqual(moved))

test('anyone else sees personal kept and the id nulled', () =>
  expect(redactPersonalLayer(moved, 'u2')).toEqual({ layerKind: 'personal', layerId: null }))

test('department layer ids and other columns are not touched', () => {
  const dept = { layerKind: 'department', layerId: 'lx' }
  expect(redactPersonalLayer(dept, 'u2')).toBe(dept)
  const other = { layerId: 'snd' }
  expect(redactPersonalLayer(other, 'u2')).toBe(other)
  expect(redactPersonalLayer(null, 'u2')).toBeNull()
})

test.each([
  [null, 'u1', true],
  ['department:lx', 'u1', true],
  ['personal:u1', 'u1', true],
  ['personal:u2', 'u1', false],
  // a malformed personal layer is private to everyone, never visible by accident
  ['personal:', 'u1', false],
  ['personal:', '', false],
  ['personal', 'u1', true],
] as const)('layer %j is visible to %j: %s', (layer, userId, ok) =>
  expect(isLayerVisibleTo(layer, userId)).toBe(ok),
)
