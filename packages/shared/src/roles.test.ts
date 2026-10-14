import { expect, test } from 'vitest'
import { ROLE_RANK, roleAtLeast } from './roles'

test('owner satisfies editor', () => expect(roleAtLeast('owner', 'editor')).toBe(true))
test('viewer does not satisfy editor', () => expect(roleAtLeast('viewer', 'editor')).toBe(false))
test('ranks are ordered', () =>
  expect(ROLE_RANK.viewer < ROLE_RANK.editor && ROLE_RANK.editor < ROLE_RANK.owner).toBe(true))
