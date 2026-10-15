import { expect, test } from 'vitest'
import { readPaperSize, withPaperSize } from './paperSize'

test('A4 unless the settings say Letter, whatever the text is', () => {
  expect(readPaperSize(null)).toBe('A4')
  expect(readPaperSize('')).toBe('A4')
  expect(readPaperSize('not json')).toBe('A4')
  expect(readPaperSize('[1]')).toBe('A4')
  expect(readPaperSize('{"paperSize":"Letter"}')).toBe('Letter')
  expect(readPaperSize('{"paperSize":"A5"}')).toBe('A4')
})

test('writing the paper size keeps every other setting', () => {
  expect(
    JSON.parse(withPaperSize('{"stampSet":["Go"],"timezone":"Europe/London"}', 'Letter')),
  ).toEqual({
    stampSet: ['Go'],
    timezone: 'Europe/London',
    paperSize: 'Letter',
  })
  expect(JSON.parse(withPaperSize(null, 'A4'))).toEqual({ paperSize: 'A4' })
  expect(JSON.parse(withPaperSize('garbage', 'Letter'))).toEqual({ paperSize: 'Letter' })
})
