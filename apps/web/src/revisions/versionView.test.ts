import type { Anchor } from '@binder/shared'
import { expect, test } from 'vitest'
import { LOCAL_ANCHORS_ONLY, pickForVersion, versionReadOnlyReason } from './versionView'

const at = (versionId: string, y: number): Anchor => ({
  documentId: 'd',
  documentVersionId: versionId,
  pageIndex: 0,
  x: 10,
  y,
  status: 'ok',
})
const row = (id: string, anchor: Anchor | null) => ({
  id,
  anchor: anchor ? JSON.stringify(anchor) : null,
})

test('the read-only reason names the version', () => {
  expect(versionReadOnlyReason(1)).toBe('Viewing v1 — read-only')
  expect(LOCAL_ANCHORS_ONLY).toBe('Showing local anchors only')
})

test('with no server answer, only rows whose own anchor is on the version are shown', () => {
  const rows = [row('a', at('v1', 5)), row('b', at('v2', 6)), row('c', null)]
  expect(pickForVersion('cues', rows, 'v1', null).map((r) => r.id)).toEqual(['a'])
})

test('with the server answer, rows it lists are shown at the anchor it gives, and the rest are not', () => {
  const rows = [row('a', at('v2', 50)), row('b', at('v2', 60)), row('c', at('v1', 7))]
  const remote = new Map([
    ['cues:a', at('v1', 5)],
    ['cues:c', at('v1', 7)],
    ['annotations:b', at('v1', 9)],
  ])
  const out = pickForVersion('cues', rows, 'v1', remote)
  expect(out.map((r) => r.id)).toEqual(['a', 'c'])
  expect(JSON.parse(out[0]?.anchor ?? '{}').y).toBe(5)
})

test('the current version’s rows are not filtered by a server answer: the argument is absent', () => {
  const rows = [row('a', at('v2', 1)), row('b', at('v1', 2))]
  expect(pickForVersion('annotations', rows, 'v2', null).map((r) => r.id)).toEqual(['a'])
})
