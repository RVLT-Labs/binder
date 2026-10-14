import { expect, test } from 'vitest'
import { hasText, pageCount } from './lib.ts'
import { ensureFixtures } from './make-fixtures.ts'

test('fixtures generate with the expected page counts and kinds', async () => {
  const f = await ensureFixtures()
  expect(await pageCount(f.librettoPdf)).toBeGreaterThan(30)
  expect(await pageCount(f.scanPdf)).toBe(8)
  expect(await pageCount(f.mixedPdf)).toBe(4)
  expect(await hasText(f.scanPdf, 1)).toBe(false)
  expect(await hasText(f.librettoPdf, 1)).toBe(true)
}, 120_000)
