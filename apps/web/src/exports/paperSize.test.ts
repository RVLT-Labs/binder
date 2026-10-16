import { expect, test } from 'vitest'
import { nearestPaper, readPaperSize, withPaperSize } from './paperSize'

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

test('nearestPaper picks the sheet a page already is, within 3% on each side, either way up', () => {
  expect(nearestPaper(595, 842)).toBe('A4')
  expect(nearestPaper(612, 792)).toBe('Letter')
  expect(nearestPaper(842, 595)).toBe('A4')
  expect(nearestPaper(792, 612)).toBe('Letter')
  // 3% off still counts; 4% does not.
  expect(nearestPaper(612 * 1.029, 792 * 0.971)).toBe('Letter')
  expect(nearestPaper(612 * 1.04, 792)).toBeNull()
  expect(nearestPaper(500, 700)).toBeNull()
  expect(nearestPaper(0, 0)).toBeNull()
  expect(nearestPaper(null, 792)).toBeNull()
})
