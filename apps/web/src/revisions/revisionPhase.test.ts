import { expect, test } from 'vitest'
import { revisionPhase } from './revisionPhase'

const base = { newVersionId: 'v2', currentVersionId: 'v1' }

test('before the new version has synced, the phase is processing', () => {
  expect(revisionPhase({ ...base, version: null })).toEqual({ phase: 'processing' })
})

test('queued and processing versions are processing', () => {
  expect(revisionPhase({ ...base, version: { status: 'queued', error: null } }).phase).toBe(
    'processing',
  )
  expect(revisionPhase({ ...base, version: { status: 'processing', error: null } }).phase).toBe(
    'processing',
  )
})

test('a ready version that is not yet current is being re-anchored', () => {
  expect(revisionPhase({ ...base, version: { status: 'ready', error: null } })).toEqual({
    phase: 'reanchoring',
  })
})

test('re-anchoring ends when the document’s current version changes to the new one', () => {
  expect(
    revisionPhase({ ...base, currentVersionId: 'v2', version: { status: 'ready', error: null } }),
  ).toEqual({ phase: 'done' })
})

test('a failed version shows its failure instead of waiting', () => {
  expect(revisionPhase({ ...base, version: { status: 'failed', error: 'bad pdf' } })).toEqual({
    phase: 'failed',
    error: 'bad pdf',
  })
  expect(revisionPhase({ ...base, version: { status: 'failed', error: null } })).toEqual({
    phase: 'failed',
    error: 'processing failed',
  })
})
