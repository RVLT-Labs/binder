import { canEditLayer } from '@binder/shared'
import { expect, test } from 'vitest'
import { parseMembership } from './useMembership'

test('departments parse from JSON text and feed the layer matrix', () => {
  const m = parseMembership({ role: 'editor', departments: '["lx","snd"]' })
  expect(m).toEqual({ role: 'editor', departments: ['lx', 'snd'] })
  expect(canEditLayer(m as NonNullable<typeof m>, 'u1', { kind: 'department', id: 'lx' })).toBe(
    true,
  )
  expect(canEditLayer(m as NonNullable<typeof m>, 'u1', { kind: 'department', id: 'fly' })).toBe(
    false,
  )
})

test('the all-departments scope is ["*"]', () => {
  expect(parseMembership({ role: 'owner', departments: '["*"]' })).toEqual({
    role: 'owner',
    departments: ['*'],
  })
})

test('unreadable scope means no departments, never all of them', () => {
  for (const departments of ['not json', '{"a":1}', '[1,2]', null]) {
    expect(parseMembership({ role: 'editor', departments })?.departments).toEqual([])
  }
  expect(parseMembership({ role: 'nonsense', departments: '["*"]' })).toBeNull()
  expect(parseMembership({ role: null, departments: null })).toBeNull()
})
