import { expect, test } from 'vitest'
import { anchorChangeKind } from './anchorChange'

const base = { documentId: 'd', documentVersionId: 'v', pageIndex: 0, x: 10, y: 20, status: 'ok' }
const text = { quote: 'or', wordStart: 2, wordEnd: 2 }

test('a mark-only change is a restyle', () => {
  expect(anchorChangeKind({ ...base, text }, { ...base, text, mark: 'highlight' })).toBe('restyled')
})

test('an offset-only change is a restyle', () => {
  expect(
    anchorChangeKind(
      { ...base, mark: 'line', text: { ...text, offset: 0 } },
      { ...base, mark: 'line', text: { ...text, offset: 1 } },
    ),
  ).toBe('restyled')
})

test('x is ignored when either side is a line or pointer, and only then', () => {
  const line = { ...base, x: 14, mark: 'line', text: { ...text, offset: 1 } }
  expect(anchorChangeKind({ ...base, text }, line)).toBe('restyled')
  expect(anchorChangeKind(line, { ...base, text })).toBe('restyled')
  expect(anchorChangeKind({ ...base, text }, { ...base, x: 14, text, mark: 'highlight' })).toBe(
    'moved',
  )
})

test('a different place, page or quote is a move', () => {
  expect(anchorChangeKind({ ...base, text }, { ...base, y: 30, text })).toBe('moved')
  expect(anchorChangeKind({ ...base, text }, { ...base, pageIndex: 1, text })).toBe('moved')
  expect(anchorChangeKind({ ...base, text }, { ...base, text: { ...text, quote: 'be' } })).toBe(
    'moved',
  )
})

test('a missing or unreadable anchor is a move; JSON text is read', () => {
  expect(anchorChangeKind(null, base)).toBe('moved')
  expect(anchorChangeKind(base, undefined)).toBe('moved')
  expect(anchorChangeKind('not json', base)).toBe('moved')
  expect(
    anchorChangeKind(JSON.stringify(base), JSON.stringify({ ...base, mark: 'highlight' })),
  ).toBe('restyled')
})
