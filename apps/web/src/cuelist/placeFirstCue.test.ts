import { expect, test } from 'vitest'
import { firstCueDocument } from './placeFirstCue'

const docs = [
  { id: 'd1', current_version_id: null },
  { id: 'd2', current_version_id: 'v2' },
  { id: 'd3', current_version_id: 'v3' },
]

test('goes to the first document that has a ready version, not one still processing', () => {
  expect(firstCueDocument(docs, null)).toBe('d2')
})

test('offers nothing when no document is ready, or there are none', () => {
  expect(firstCueDocument([docs[0] as (typeof docs)[number]], null)).toBeNull()
  expect(firstCueDocument([], null)).toBeNull()
})

test('offers nothing to someone who cannot place cues here (a viewer, another department, an archived show, a locked layer)', () => {
  for (const reason of [
    "You can't edit LX cues.",
    'The LX layer is locked.',
    'This show is archived.',
  ]) {
    expect(firstCueDocument(docs, reason)).toBeNull()
  }
})
