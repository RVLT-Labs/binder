import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { type FooterInfo, type StampItem, stampScript } from '@binder/core'
import { FIXTURES } from '@binder/fixtures'
import { degrees, PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { findMissingTools, skipWithoutTools } from './tools'

const run = promisify(execFile)
const skip = skipWithoutTools(
  'print export tests',
  findMissingTools([
    ['pdfinfo', ['-v']],
    ['pdftotext', ['-v']],
    ['pdftoppm', ['-v']],
  ]),
)

const footer: FooterInfo = {
  showTitle: 'Pirates',
  documentLabel: 'Libretto v2',
  layerLabel: 'LX, SND',
  binderVersion: 3,
  exportId: '0190f3a2-0000-7000-8000-00000000abcd',
  date: new Date(2026, 9, 15, 14, 2),
}
const FOOTER_TEXT = 'Pirates · Libretto v2 · LX, SND · Binder v3 · 2026-10-15 14:02'
const AMBER = '#F5A623'

let work: string
let n = 0
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'binder-print-test-'))
})
afterAll(async () => {
  await rm(work, { recursive: true, force: true })
})

const read = (path: string) => readFile(path).then((b) => new Uint8Array(b))

async function tmpPdf(bytes: Uint8Array): Promise<string> {
  const path = join(work, `t${n++}.pdf`)
  await writeFile(path, bytes)
  return path
}

const cueAt = (
  pageIndex: number,
  x: number,
  y: number,
  boxText: string,
  labelText = '',
  over: Partial<Extract<StampItem, { kind: 'cue' }>> = {},
): StampItem => ({
  kind: 'cue',
  pageIndex,
  x,
  y,
  type: 'go',
  boxText,
  labelText,
  colour: AMBER,
  ...over,
})

const annotationAt = (
  type: Extract<StampItem, { kind: 'annotation' }>['type'],
  over: Partial<Extract<StampItem, { kind: 'annotation' }>> = {},
): StampItem => ({
  kind: 'annotation',
  pageIndex: 0,
  x: 100,
  y: 500,
  type,
  geometry: {},
  text: '',
  colour: '#4A90E2',
  strokeWidth: 1.5,
  fontSize: 10,
  wordBoxes: [],
  ...over,
})

interface PageInfo {
  /** Displayed size: unrotated size swapped for a quarter turn. */
  width: number
  height: number
  rotation: number
  mediaBox: string
  cropBox: string
}

/** Sizes, rotation, and boxes of every page, from poppler. */
async function pageInfos(pdf: Uint8Array): Promise<PageInfo[]> {
  const path = await tmpPdf(pdf)
  const { stdout } = await run('pdfinfo', ['-box', '-f', '1', '-l', '9999', path])
  const pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1])
  const infos: PageInfo[] = []
  for (let p = 1; p <= pages; p++) {
    const { stdout: out } = await run('pdfinfo', ['-box', '-f', String(p), '-l', String(p), path])
    const size = new RegExp(`Page\\s+${p} size:\\s+([\\d.]+) x ([\\d.]+) pts`).exec(out)
    const rot = new RegExp(`Page\\s+${p} rot:\\s+(\\d+)`).exec(out)
    const media = new RegExp(`Page\\s+${p} MediaBox:\\s+(.+)`).exec(out)
    const crop = new RegExp(`Page\\s+${p} CropBox:\\s+(.+)`).exec(out)
    if (!size || !rot || !media || !crop) throw new Error(`cannot parse pdfinfo:\n${out}`)
    const quarter = Number(rot[1]) % 180 === 90
    infos.push({
      width: Number(size[quarter ? 2 : 1]),
      height: Number(size[quarter ? 1 : 2]),
      rotation: Number(rot[1]),
      mediaBox: (media[1] as string).trim(),
      cropBox: (crop[1] as string).trim(),
    })
  }
  return infos
}

const pageSizes = pageInfos

/** pdftotext of one 0-based page, in reading order. */
async function pdftotext(pdf: Uint8Array, pageIndex: number): Promise<string> {
  const path = await tmpPdf(pdf)
  const p = String(pageIndex + 1)
  return (await run('pdftotext', ['-f', p, '-l', p, path, '-'])).stdout
}

interface BBoxWord {
  t: string
  xMin: number
  yMin: number
  xMax: number
  yMax: number
}

/** Words of one 0-based page in displayed space with a top-left origin, as poppler reports them. */
async function bboxWords(pdf: Uint8Array, pageIndex: number): Promise<BBoxWord[]> {
  const path = await tmpPdf(pdf)
  const p = String(pageIndex + 1)
  const { stdout } = await run('pdftotext', ['-f', p, '-l', p, '-bbox-layout', path, '-'])
  return [
    ...stdout.matchAll(
      /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g,
    ),
  ].map((m) => ({
    t: (m[5] as string).replaceAll('&amp;', '&'),
    xMin: Number(m[1]),
    yMin: Number(m[2]),
    xMax: Number(m[3]),
    yMax: Number(m[4]),
  }))
}

/** The RGB of the pixel at displayed (x, y from the top) when the page is drawn at 72 dpi. */
async function pixelAt(pdf: Uint8Array, pageIndex: number, x: number, y: number) {
  const path = await tmpPdf(pdf)
  const p = String(pageIndex + 1)
  const { stdout } = (await run('pdftoppm', ['-r', '72', '-f', p, '-l', p, path], {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  })) as { stdout: Buffer }
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(stdout.subarray(0, 40).toString('latin1'))
  if (!header) throw new Error('pdftoppm gave no PPM')
  const width = Number(header[1])
  const at = header[0].length + (Math.round(y) * width + Math.round(x)) * 3
  return [stdout[at], stdout[at + 1], stdout[at + 2]] as number[]
}

const near = (rgb: number[], hex: string, tolerance = 12) => {
  const want = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
  return rgb.every((v, i) => Math.abs(v - (want[i] as number)) <= tolerance)
}

/** A blank A4 PDF with the given /Rotate and a line of text so poppler has content. */
async function blankPage(rotation: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595.28, 841.89])
  page.setRotation(degrees(rotation))
  return doc.save()
}

describe.skipIf(skip)('print stamping with poppler', () => {
  test('a cue stamped at the displayed top-left of the rotated page reads top-left in pdftotext', async () => {
    const src = await read(FIXTURES.mixedPdf)
    const { width, height } = (await pageSizes(src))[1] as PageInfo
    expect(width).toBeGreaterThan(height) // the rotated page displays landscape
    const out = await stampScript(src, [cueAt(1, 72, height - 72, 'LX 10')], footer)
    const words = await bboxWords(out, 1)
    const lx = words.find((w) => w.t === 'LX')
    const ten = words.find((w) => w.t === '10')
    if (!lx || !ten) throw new Error('the marker text is not in the text layer')
    expect(lx.xMin).toBeLessThan(0.25 * width)
    expect(lx.yMin).toBeLessThan(0.25 * height)
    // Upright and left to right: "10" follows "LX" on the same line.
    expect(ten.xMin).toBeGreaterThan(lx.xMax)
    expect(Math.abs(ten.yMin - lx.yMin)).toBeLessThan(2)
    // The marker box is 4 points in from x = 72 and 5 points above its centre.
    expect(lx.xMin).toBeCloseTo(76, 0)
    expect(lx.yMin).toBeCloseTo(72 - 5, -0.5)
  })

  test('a page whose crop box starts at (50, 50) stamps at the visible top-left', async () => {
    const src = await read(FIXTURES.offsetPdf)
    const { width, height } = (await pageSizes(src))[0] as PageInfo
    const out = await stampScript(src, [cueAt(0, 72, height - 72, 'LX 10')], footer)
    const word = (await bboxWords(out, 0)).find((w) => w.t === 'LX')
    if (!word) throw new Error('the marker text is not in the text layer')
    expect(word.xMin).toBeLessThan(0.25 * width)
    expect(word.yMin).toBeLessThan(0.25 * height)
    expect(word.xMin).toBeCloseTo(76, 0)
    // The solid marker box is where the displayed coordinates say, in the rendered page too.
    expect(near(await pixelAt(out, 0, 73, 72), AMBER)).toBe(true)
  })

  test.each([0, 90, 180, 270])(
    'at /Rotate %i the marker is upright at the displayed top-left',
    async (rot) => {
      const src = await blankPage(rot)
      const { height } = (await pageSizes(src))[0] as PageInfo
      const out = await stampScript(src, [cueAt(0, 72, height - 72, 'LX 10', 'Sunrise')], footer)
      const words = await bboxWords(out, 0)
      const lx = words.find((w) => w.t === 'LX')
      const label = words.find((w) => w.t === 'Sunrise')
      if (!lx || !label) throw new Error('the marker is not in the text layer')
      expect(lx.xMin).toBeCloseTo(76, 0)
      expect(lx.yMin).toBeCloseTo(67, -0.5)
      expect(label.xMin).toBeGreaterThan(lx.xMax)
      expect(Math.abs(label.yMin - lx.yMin)).toBeLessThan(2)
      expect(near(await pixelAt(out, 0, 73, 72), AMBER)).toBe(true)
      // The footer sits 24 pt in and 12 pt above the displayed bottom edge.
      const first = words.find((w) => w.t === 'Pirates')
      expect(first?.xMin).toBeCloseTo(24, 0)
      expect(first?.yMax).toBeGreaterThan(height - 14)
      expect(first?.yMax).toBeLessThan(height - 8)
    },
  )

  test('stamping keeps page count, sizes, boxes, and the text layer', async () => {
    const src = await read(FIXTURES.scanPdf)
    const out = await stampScript(src, [cueAt(0, 72, 700, 'LX 10')], footer)
    expect(await pageSizes(out)).toEqual(await pageSizes(src))
    expect(await pdftotext(out, 0)).toContain('LX 10')

    const text = await read(FIXTURES.librettoShortPdf)
    const stamped = await stampScript(text, [cueAt(0, 72, 700, 'LX 10')], footer)
    expect(await pageSizes(stamped)).toEqual(await pageSizes(text))
    const before = new Set((await bboxWords(text, 0)).map((w) => w.t))
    const after = new Set((await bboxWords(stamped, 0)).map((w) => w.t))
    expect(before.size).toBeGreaterThan(50)
    for (const word of before) expect(after.has(word), word).toBe(true)
  })

  test('the mixed PDF keeps its rotation, Letter page, and boxes', async () => {
    const src = await read(FIXTURES.mixedPdf)
    const out = await stampScript(src, [cueAt(1, 72, 500, 'LX 10')], footer)
    const sizes = await pageSizes(out)
    expect(sizes).toEqual(await pageSizes(src))
    expect(sizes.map((s) => s.rotation)).toEqual([0, 90, 0, 0])
  })

  test('a label outside WinAnsi stamps with question marks instead of throwing', async () => {
    const src = await read(FIXTURES.librettoPdf)
    const out = await stampScript(src, [cueAt(0, 72, 700, 'LX 10', 'Ça va ✓ 東京')], footer)
    expect(await pdftotext(out, 0)).toContain('Ça va ? ??')
  })

  test('every page carries the footer', async () => {
    const src = await read(FIXTURES.mixedPdf)
    const out = await stampScript(src, [], footer)
    const pages = (await pageSizes(out)).length
    expect(pages).toBe(4)
    for (let p = 0; p < pages; p++) {
      expect((await pdftotext(out, p)).replace(/\s+/g, ' ')).toContain(FOOTER_TEXT)
    }
    // And the long libretto: first and last page.
    const libretto = await read(FIXTURES.librettoShortPdf)
    const stamped = await stampScript(libretto, [], footer)
    for (let p = 0; p < 3; p++) {
      expect((await pdftotext(stamped, p)).replace(/\s+/g, ' ')).toContain(FOOTER_TEXT)
    }
  })

  test('annotations of every type stamp, and their text reads upright on a rotated page', async () => {
    const src = await read(FIXTURES.mixedPdf)
    const at = { pageIndex: 1, x: 120, y: 300 }
    const out = await stampScript(
      src,
      [
        annotationAt('note', { ...at, text: 'Cover the gap\nsecond paragraph' }),
        annotationAt('stamp', { ...at, y: 200, text: 'Blackout', fontSize: 12 }),
        annotationAt('rect', { ...at, x: 300, geometry: { w: 60, h: 30 } }),
        annotationAt('ellipse', { ...at, x: 400, geometry: { w: 60, h: 30 } }),
        annotationAt('line', { ...at, x: 300, y: 150, geometry: { dx: 80, dy: 20 } }),
        annotationAt('arrow', { ...at, x: 300, y: 100, geometry: { dx: 80, dy: -20 } }),
        annotationAt('highlight', {
          ...at,
          y: 400,
          text: 'quote words',
          wordBoxes: [{ x: 100, y: 400, w: 80, h: 10 }],
        }),
        annotationAt('highlight', { ...at, y: 450, x: 100, text: 'an unbound highlight quote' }),
        cueAt(1, 100, 350, 'SB LX 10', 'Standby', { type: 'standby' }),
        cueAt(1, 100, 380, 'W LX 11', 'Warn', { type: 'warn' }),
      ],
      footer,
    )
    const words = await bboxWords(out, 1)
    const note = words.find((w) => w.t === 'Cover')
    const gap = words.find((w) => w.t === 'gap')
    if (!note || !gap) throw new Error('the note text is not in the text layer')
    expect(gap.xMin).toBeGreaterThan(note.xMin)
    expect(Math.abs(gap.yMin - note.yMin)).toBeLessThan(2)
    const text = await pdftotext(out, 1)
    for (const s of ['second paragraph', 'Blackout', 'an unbound', 'SB LX 10', 'W LX 11']) {
      expect(text).toContain(s)
    }
    // A highlight's colour lands where its word box says (120 from the left, 400 up on a 595 tall
    // page), at 35% over white.
    const { height } = (await pageSizes(src))[1] as PageInfo
    expect(near(await pixelAt(out, 1, 140, height - 405), '#C0D8F5', 10)).toBe(true)
  })
})
