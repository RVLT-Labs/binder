import { expect, test } from 'vitest'
import type { DocumentVersionRow } from '../powersync/schema'
import { compareTarget } from './VersionSwitcher'

const v = (id: string, n: number) => ({ id, version_number: n }) as DocumentVersionRow
const versions = [v('a', 1), v('b', 2), v('c', 3)]

test('comparing from an older version compares it with the current one', () => {
  expect(compareTarget(versions, 'c', 'a')).toEqual({ from: 'a', to: 'c' })
})

test('comparing from the current version compares it with the one before', () => {
  expect(compareTarget(versions, 'c', 'c')).toEqual({ from: 'b', to: 'c' })
})

test('a document with one version has nothing to compare', () => {
  expect(compareTarget([v('a', 1)], 'a', 'a')).toBeNull()
})
