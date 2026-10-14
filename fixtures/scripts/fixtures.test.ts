import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'
import { hasText, pageCount } from './lib.ts'
import { ensureFixtures } from './make-fixtures.ts'

const run = promisify(execFile)

test('fixtures generate with the expected page counts and kinds', async () => {
  const f = await ensureFixtures()
  expect(await pageCount(f.librettoPdf)).toBeGreaterThan(30)
  expect(await pageCount(f.scanPdf)).toBe(8)
  expect(await pageCount(f.mixedPdf)).toBe(4)
  expect(await pageCount(f.librettoShortPdf)).toBe(3)
  expect(await hasText(f.librettoShortPdf, 3)).toBe(true)
  expect(await hasText(f.scanPdf, 1)).toBe(false)
  expect(await hasText(f.librettoPdf, 1)).toBe(true)
}, 120_000)

async function pdfinfoPage(pdf: string, page: number) {
  const { stdout } = await run('pdfinfo', ['-f', String(page), '-l', String(page), pdf])
  const m = stdout.match(new RegExp(`Page\\s+${page} size:\\s+([\\d.]+) x ([\\d.]+) pts`))
  const r = stdout.match(new RegExp(`Page\\s+${page} rot:\\s+(\\d+)`))
  if (!m?.[1] || !m[2] || !r?.[1]) throw new Error(`cannot parse pdfinfo output:\n${stdout}`)
  return { width: Number(m[1]), height: Number(m[2]), rotation: Number(r[1]) }
}

test('mixed.pdf: rotated page displays landscape with ROTATED top-left; page 3 is Letter', async () => {
  const f = await ensureFixtures()
  expect(await pageCount(f.mixedPdf)).toBe(4)

  const p2 = await pdfinfoPage(f.mixedPdf, 2)
  expect(p2.rotation).toBe(90)
  // pdfinfo and poppler's <page> report unrotated dimensions: swap for the displayed size.
  const displayed = { width: p2.height, height: p2.width }
  expect(displayed.width).toBeGreaterThan(displayed.height)

  const { stdout } = await run('pdftotext', ['-f', '2', '-l', '2', '-bbox-layout', f.mixedPdf, '-'])
  const w = stdout.match(
    /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">ROTATED<\/word>/,
  )
  if (!w) throw new Error('ROTATED not found on page 2')
  const [xMin, yMin, xMax, yMax] = w.slice(1).map(Number) as [number, number, number, number]
  // Word coordinates are in displayed space with a top-left origin.
  expect(xMax).toBeLessThan(displayed.width / 2)
  expect(yMax).toBeLessThan(displayed.height / 2)
  expect(xMin).toBeGreaterThanOrEqual(0)
  expect(yMin).toBeGreaterThanOrEqual(0)

  const p3 = await pdfinfoPage(f.mixedPdf, 3)
  expect(p3.width).toBeCloseTo(612, 0)
  expect(p3.height).toBeCloseTo(792, 0)
})
