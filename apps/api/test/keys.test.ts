import { expect, test } from 'vitest'
import {
  pageImageBlobKey,
  pageThumbBlobKey,
  pageWordsBlobKey,
  searchableBlobKey,
  showIdFromKey,
  validateBlobKey,
} from '../src/blob/keys'

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

test('derived blob keys sit beside the original under the version', () => {
  const v = 'shows/s1/documents/d1/versions/v1'
  expect(searchableBlobKey('s1', 'd1', 'v1')).toBe(`${v}/searchable.pdf`)
  expect(pageThumbBlobKey('s1', 'd1', 'v1', 0)).toBe(`${v}/pages/0/thumb.png`)
  expect(pageWordsBlobKey('s1', 'd1', 'v1', 12)).toBe(`${v}/pages/12/words.json`)
  expect(pageImageBlobKey('s1', 'd1', 'v1', 3, 1600)).toBe(`${v}/pages/3/image-1600.jpg`)
})
