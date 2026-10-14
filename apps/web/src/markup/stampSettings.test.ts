import { DEFAULT_STAMPS } from '@binder/shared'
import { expect, test } from 'vitest'
import { checkStampName, readStamps, withStamps } from './stampSettings'

test('a show with no stamp set offers the defaults', () => {
  expect(readStamps('{}')).toEqual([...DEFAULT_STAMPS])
  expect(readStamps(null)).toEqual([...DEFAULT_STAMPS])
  expect(readStamps('not json')).toEqual([...DEFAULT_STAMPS])
  expect(readStamps('{"stampSet":[]}')).toEqual([...DEFAULT_STAMPS])
})

test("the owner's own list replaces the defaults", () =>
  expect(readStamps('{"stampSet":["Hold","Go"]}')).toEqual(['Hold', 'Go']))

test('writing a stamp set keeps the show’s other settings and reads back', () => {
  const text = withStamps('{"timezone":"Europe/London","stampSet":["Old"]}', ['Hold', 'Go'])
  expect(JSON.parse(text)).toEqual({ timezone: 'Europe/London', stampSet: ['Hold', 'Go'] })
  expect(readStamps(text)).toEqual(['Hold', 'Go'])
  expect(JSON.parse(withStamps(null, ['A']))).toEqual({ stampSet: ['A'] })
})

test('a stamp name is 1 to 40 characters and not already in the set', () => {
  expect(checkStampName('Hold', ['Go'])).toBeNull()
  expect(checkStampName('   ', ['Go'])).toBe('Give the stamp a name.')
  expect(checkStampName('x'.repeat(41), [])).toBe('A stamp name is at most 40 characters.')
  expect(checkStampName('Go', ['Go'])).toBe('That stamp is already in the set.')
  expect(checkStampName('a\u0000b', [])).toBe('That name has a character that can’t be stored.')
})
