import { expect, test } from 'vitest'
import { readCueSize, withCueSize } from './cueSizeSettings'

test('a show with no cue sizes reads as normal, whatever the settings text is', () => {
  for (const text of [null, undefined, '', 'not json', '[1]', '{"cueSizes":"large"}']) {
    expect(readCueSize(text, 'd1')).toBe('normal')
  }
  expect(readCueSize('{"cueSizes":{"d1":"huge"}}', 'd1')).toBe('normal')
})

test('reads one department size from the settings text', () => {
  const text = JSON.stringify({ cueSizes: { d1: 'large', d2: 'normal' } })
  expect(readCueSize(text, 'd1')).toBe('large')
  expect(readCueSize(text, 'd2')).toBe('normal')
  expect(readCueSize(text, 'd3')).toBe('normal')
})

test("withCueSize keeps every other setting and other departments' sizes; reading it back gives the size", () => {
  const before = JSON.stringify({
    stampSet: ['Hold', 'Go'],
    paperSize: 'Letter',
    markerSides: { d1: 'right' },
    connectorStyles: { d2: { width: 'medium', pattern: 'dotted' } },
    cueSizes: { d2: 'large' },
    timezone: 'Europe/London',
  })
  const after = withCueSize(before, 'd1', 'large')
  expect(JSON.parse(after)).toEqual({
    stampSet: ['Hold', 'Go'],
    paperSize: 'Letter',
    markerSides: { d1: 'right' },
    connectorStyles: { d2: { width: 'medium', pattern: 'dotted' } },
    cueSizes: { d2: 'large', d1: 'large' },
    timezone: 'Europe/London',
  })
  expect(readCueSize(after, 'd1')).toBe('large')
  expect(readCueSize(withCueSize(after, 'd1', 'normal'), 'd1')).toBe('normal')
  // A malformed map is replaced rather than spread.
  expect(JSON.parse(withCueSize('{"cueSizes":"x"}', 'd1', 'large'))).toEqual({
    cueSizes: { d1: 'large' },
  })
})
