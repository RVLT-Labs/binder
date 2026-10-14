import { expect, test } from 'vitest'
import { canEditLayer, canSeeLayer } from './layers'
import { layerKey, parseLayerKey } from './markup'

const LX = { kind: 'department', id: 'lx' } as const
const SND = { kind: 'department', id: 'snd' } as const
const mine = { kind: 'personal', id: 'u1' } as const
const theirs = { kind: 'personal', id: 'u2' } as const

test.each([
  ['owner', ['*'], LX, true],
  ['owner', ['*'], mine, true],
  ['owner', ['*'], theirs, false],
  ['editor', ['*'], SND, true],
  ['editor', ['lx'], LX, true],
  ['editor', ['lx'], SND, false],
  ['editor', ['lx'], mine, true],
  ['editor', ['lx'], theirs, false],
  ['viewer', ['*'], LX, false],
  ['viewer', ['*'], mine, true],
  ['viewer', ['*'], theirs, false],
] as const)('%s scoped %j editing %j is %s', (role, departments, layer, ok) =>
  expect(canEditLayer({ role, departments: [...departments] }, 'u1', layer)).toBe(ok),
)

test('department layers are visible to everyone, personal layers only to their owner', () => {
  expect(canSeeLayer('u2', LX)).toBe(true)
  expect(canSeeLayer('u1', mine)).toBe(true)
  expect(canSeeLayer('u1', theirs)).toBe(false)
})

test('layer keys round-trip and reject unknown kinds', () => {
  expect(layerKey(LX)).toBe('department:lx')
  expect(parseLayerKey('personal:u1')).toEqual(mine)
  expect(parseLayerKey('team:x')).toBeNull()
  expect(parseLayerKey('department:')).toBeNull()
  expect(parseLayerKey('nonsense')).toBeNull()
})
