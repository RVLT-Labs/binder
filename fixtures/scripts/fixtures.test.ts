import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'
import { hasText, pageCount } from './lib.ts'
import { ensureFixtures } from './make-fixtures.ts'
import { cutLines, insertLines } from './revisions.ts'

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

test('offset.pdf: one A4 page whose boxes start at (50, 50), OFFSET at the visible top-left', async () => {
  const f = await ensureFixtures()
  expect(await pageCount(f.offsetPdf)).toBe(1)
  const { stdout: info } = await run('pdfinfo', ['-box', f.offsetPdf])
  expect(info).toMatch(/MediaBox:\s+50\.00\s+50\.00\s+/)
  expect(info).toMatch(/CropBox:\s+50\.00\s+50\.00\s+/)
  const { stdout } = await run('pdftotext', ['-bbox-layout', f.offsetPdf, '-'])
  const w = stdout.match(
    /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">OFFSET<\/word>/,
  )
  if (!w) throw new Error('OFFSET not found')
  const [xMin, yMin] = w.slice(1).map(Number) as [number, number]
  // Displayed coordinates are relative to the visible box: 72 from the left, ~100 from the top.
  expect(xMin).toBeCloseTo(72, 0)
  expect(yMin).toBeLessThan(100)
  expect(yMin).toBeGreaterThan(60)
}, 120_000)

async function textOf(pdf: string): Promise<string> {
  const { stdout } = await run('pdftotext', [pdf, '-'], { maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

test('revisedCutPdf is the libretto without lines 201 to 240, one page shorter', async () => {
  const f = await ensureFixtures()
  expect(await pageCount(f.librettoPdf)).toBe(147)
  expect(await pageCount(f.revisedCutPdf)).toBe(146)
  const text = await readFile(f.librettoText, 'utf8')
  const cut = (await readFile(f.librettoText, 'utf8')).split('\n').slice(200, 240)
  // A line that exists only in the cut range is in the libretto and not in the revision.
  const only = cut.map((l) => l.trim()).find((l) => l.length > 30 && text.split(l).length === 2)
  if (!only) throw new Error('no unique line in the cut range')
  const needle = only.split(/\s+/).slice(0, 4).join(' ')
  expect(await textOf(f.librettoPdf)).toContain(needle)
  expect(await textOf(f.revisedCutPdf)).not.toContain(needle)
  // The first line of the text and a late line survive.
  expect(await textOf(f.revisedCutPdf)).toContain('PIRATES OF PENZANCE')
}, 120_000)

test('revisedInsertPdf adds 48 INSERTED LINE lines after line 240, one page longer', async () => {
  const f = await ensureFixtures()
  expect(await pageCount(f.revisedInsertPdf)).toBe(148)
  const out = await textOf(f.revisedInsertPdf)
  const inserted = out.match(/INSERTED LINE \d+/g) ?? []
  expect(inserted).toHaveLength(48)
  expect(inserted[0]).toBe('INSERTED LINE 1')
  expect(inserted[47]).toBe('INSERTED LINE 48')
  expect(await textOf(f.librettoPdf)).not.toContain('INSERTED LINE')
}, 120_000)

test('the cut and insert helpers edit the 1-based lines', () => {
  const text = ['a', 'b', 'c', 'd', 'e'].join('\n')
  expect(cutLines(text, 2, 3)).toBe('a\nd\ne')
  expect(insertLines(text, 2, 2)).toBe('a\nb\nINSERTED LINE 1\nINSERTED LINE 2\nc\nd\ne')
})
