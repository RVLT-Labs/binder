import { expect, test } from 'vitest'
import { showIdFromKey, validateBlobKey } from '../src/blob/keys'

test.each([
  '../x',
  '/shows/a',
  'shows/a/../b',
  'shows/a/%2e%2e/b',
  'shows/a/b c',
  'shows/a/./b',
  'shows//a',
  'other/a',
  'shows',
  '',
])('rejects %s', (k) => expect(() => validateBlobKey(k)).toThrow())

test('accepts a well-formed key and extracts show id', () => {
  const k = 'shows/01HZZ/documents/01HZY/versions/01HZX/original.pdf'
  expect(validateBlobKey(k)).toBe(k)
  expect(showIdFromKey(k)).toBe('01HZZ')
})

test('showIdFromKey is null for keys without a show', () => {
  expect(showIdFromKey('shows')).toBeNull()
  expect(showIdFromKey('other/a')).toBeNull()
})
