import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { caretX, type FooterInfo, type StampItem, stampScript } from '@binder/core'
import { documentVersions, shows } from '@binder/db'
import { FIXTURES } from '@binder/fixtures'
import { eq } from 'drizzle-orm'
import { degrees, PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { searchableBlobKey } from '../src/blob/keys'
import { AppError } from '../src/errors'
import { createCue, exportMarkedScript, listExportRecords } from '../src/services'
import { librettoBytes } from './documentHelpers'
import { putWordLayer, setupMarkupShow } from './markupHelpers'
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
  lead: string,
  number: string,
  over: Partial<Extract<StampItem, { kind: 'cue' }>> = {},
): StampItem => ({
  kind: 'cue',
  id: `c-${pageIndex}-${y}-${lead}-${number}`,
  pageIndex,
  x,
  y,
  type: 'go',
  lead,
  typeWord: /^(SB|W) /.test(lead) ? (lead.split(' ')[0] as string) : '',
  number,
  numberInk: '#1A1715',
  colour: AMBER,
  side: 'left',
  sortKey: { department: 0, major: Number.parseInt(number, 10) || 0, minor: 0 },
  triggerBoxes: [],
  mark: 'underline',
  caret: null,
  tag: null,
  textExtent: null,
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

/** The RGB of the pixel at displayed (x, y from the top, in points) when the page is drawn at `dpi`. */
async function pixelAt(pdf: Uint8Array, pageIndex: number, x: number, y: number, dpi = 72) {
  const path = await tmpPdf(pdf)
  const p = String(pageIndex + 1)
  const { stdout } = (await run('pdftoppm', ['-r', String(dpi), '-f', p, '-l', p, path], {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  })) as { stdout: Buffer }
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(stdout.subarray(0, 40).toString('latin1'))
  if (!header) throw new Error('pdftoppm gave no PPM')
  const width = Number(header[1])
  const k = dpi / 72
  const at = header[0].length + (Math.round(y * k) * width + Math.round(x * k)) * 3
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
    const out = await stampScript(src, [cueAt(1, 72, height - 72, 'LX', '10')], footer)
    const words = await bboxWords(out, 1)
    const lx = words.find((w) => w.t === 'LX')
    const ten = words.find((w) => w.t === '10')
    if (!lx || !ten) throw new Error('the tag text is not in the text layer')
    expect(lx.xMin).toBeLessThan(0.25 * width)
    expect(lx.yMin).toBeLessThan(0.25 * height)
    // Upright and left to right: "10" follows "LX" on the same line.
    expect(ten.xMin).toBeGreaterThan(lx.xMax)
    expect(Math.abs(ten.yMin - lx.yMin)).toBeLessThan(2)
    // The tag is in the left margin (6 pt of padding in from x = 4) and level with y = 72.
    expect(lx.xMin).toBeCloseTo(10, 0)
    expect((lx.yMin + lx.yMax) / 2).toBeCloseTo(72, -0.5)
  })

  test('a page whose crop box starts at (50, 50) stamps its tag at the visible left edge', async () => {
    const src = await read(FIXTURES.offsetPdf)
    const { width, height } = (await pageSizes(src))[0] as PageInfo
    const out = await stampScript(src, [cueAt(0, 72, height - 72, 'LX', '10')], footer)
    const word = (await bboxWords(out, 0)).find((w) => w.t === 'LX')
    if (!word) throw new Error('the tag text is not in the text layer')
    expect(word.xMin).toBeLessThan(0.25 * width)
    expect(word.xMin).toBeCloseTo(10, 0)
    // The pill's outline is where the displayed coordinates say, in the rendered page too: its top
    // edge, 7 points above the cue's y, in the department colour (drawn at 288 dpi).
    expect(near(await pixelAt(out, 0, 24, 72 - 7, 288), AMBER, 20)).toBe(true)
  })

  test.each([0, 90, 180, 270])(
    'at /Rotate %i the tag is upright in the left margin, the underline and pill where they belong',
    async (rot) => {
      const src = await blankPage(rot)
      const { width, height } = (await pageSizes(src))[0] as PageInfo
      const out = await stampScript(
        src,
        [
          cueAt(0, 200, height - 72, 'LX', '10', {
            triggerBoxes: [{ x: 200, y: height - 77, w: 60, h: 10 }],
          }),
        ],
        footer,
      )
      const words = await bboxWords(out, 0)
      const lx = words.find((w) => w.t === 'LX')
      const ten = words.find((w) => w.t === '10')
      if (!lx || !ten) throw new Error('the tag is not in the text layer')
      expect(lx.xMin).toBeCloseTo(10, 0)
      expect((lx.yMin + lx.yMax) / 2).toBeCloseTo(72, -0.5)
      expect(ten.xMin).toBeGreaterThan(lx.xMax)
      expect(Math.abs(ten.yMin - lx.yMin)).toBeLessThan(2)
      expect(near(await pixelAt(out, 0, 24, 72 - 7, 288), AMBER, 20)).toBe(true)
      // The trigger words (a box 67 to 77 down) are underlined 1 pt below it, 1.5 pt thick...
      expect(near(await pixelAt(out, 0, 230, 78, 288), AMBER, 20)).toBe(true)
      // ...and never filled: the words' own area and the page beyond them stay white.
      expect(near(await pixelAt(out, 0, 230, 72, 288), '#FFFFFF', 2)).toBe(true)
      expect(near(await pixelAt(out, 0, 300, 78, 288), '#FFFFFF', 2)).toBe(true)
      // The connector runs at the underline's y from the pill to the underline, never through the
      // words' own area (y 72 is white there).
      expect(near(await pixelAt(out, 0, 120, 78, 288), AMBER, 20)).toBe(true)
      expect(near(await pixelAt(out, 0, 120, 72, 288), '#FFFFFF', 2)).toBe(true)
      // The footer sits 24 pt in and 12 pt above the displayed bottom edge.
      const first = words.find((w) => w.t === 'Pirates')
      expect(first?.xMin).toBeCloseTo(24, 0)
      expect(first?.yMax).toBeGreaterThan(height - 14)
      expect(first?.yMax).toBeLessThan(height - 8)
      expect(width).toBeGreaterThan(0)
    },
  )

  describe('a cue anchored to words in the middle of a line', () => {
    /** The libretto's first line with at least six words, and a trigger word in its middle. */
    async function midLine() {
      const src = await read(FIXTURES.librettoShortPdf)
      const info = (await pageSizes(src))[0] as PageInfo
      const words = await bboxWords(src, 0)
      const lines = new Map<number, BBoxWord[]>()
      for (const w of words) {
        const key = Math.round(w.yMin)
        lines.set(key, [...(lines.get(key) ?? []), w])
      }
      const line = [...lines.values()]
        .map((l) => l.sort((a, b) => a.xMin - b.xMin))
        .find((l) => l.length >= 6)
      if (!line) throw new Error('the fixture has no long line')
      const trigger = line[3] as BBoxWord
      const box = {
        x: trigger.xMin,
        y: info.height - trigger.yMax,
        w: trigger.xMax - trigger.xMin,
        h: trigger.yMax - trigger.yMin,
      }
      return { src, info, words, line, trigger, box, y: box.y + box.h / 2 }
    }

    test('stamps its tag in the left margin, clear of the script, and the script text is unchanged', async () => {
      const { src, words, line, trigger, box, y } = await midLine()
      // Sanity: the source has no LX word of its own.
      expect(words.some((w) => w.t === 'LX')).toBe(false)
      const out = await stampScript(
        src,
        [cueAt(0, box.x, y, 'LX', '10', { triggerBoxes: [box] })],
        footer,
      )
      const after = await bboxWords(out, 0)
      const lx = after.find((w) => w.t === 'LX')
      if (!lx) throw new Error('the tag text is not in the text layer')
      // The tag is left of the trigger word, and left of the whole line it is on.
      expect(lx.xMax).toBeLessThan(trigger.xMin)
      expect(lx.xMax).toBeLessThan((line[0] as BBoxWord).xMin)
      // Every word of the script is still extracted, and the trigger word is where it was.
      const before = new Set(words.map((w) => w.t))
      const names = new Set(after.map((w) => w.t))
      for (const t of before) expect(names.has(t), t).toBe(true)
      const same = after.find(
        (w) =>
          w.t === trigger.t &&
          Math.abs(w.xMin - trigger.xMin) < 0.5 &&
          Math.abs(w.yMin - trigger.yMin) < 0.5,
      )
      expect(same).toBeDefined()
      // No stamped word lands on a script word.
      const stamped = after.filter((w) => !before.has(w.t) || w.t === 'LX')
      for (const s of stamped.filter((w) => w.t === 'LX' || w.t === '10')) {
        for (const w of words) {
          const overlaps = s.xMin < w.xMax && s.xMax > w.xMin && s.yMin < w.yMax && s.yMax > w.yMin
          expect(overlaps, `${s.t} over ${w.t}`).toBe(false)
        }
      }
    })

    test('wide and crowded tags stay out of the text block: they shrink and stack in the margin', async () => {
      const { src, info, words, line, box, y } = await midLine()
      const extent = {
        minX: Math.min(...words.map((w) => w.xMin)),
        maxX: Math.max(...words.map((w) => w.xMax)),
      }
      const at = (over: Partial<Extract<StampItem, { kind: 'cue' }>>, lead: string, n: string) =>
        cueAt(0, box.x, y, lead, n, { triggerBoxes: [box], textExtent: extent, ...over })
      const out = await stampScript(
        src,
        [
          at({ type: 'standby' }, 'SB LX', '11'),
          at(
            { colour: '#9B51E0', type: 'warn', sortKey: { department: 20, major: 12, minor: 50 } },
            'W TM',
            '12.50',
          ),
          at({ side: 'right', colour: '#4A90E2' }, 'SND', '20'),
        ],
        footer,
      )
      const after = await bboxWords(out, 0)
      const before = new Set(words.map((w) => `${w.t}@${Math.round(w.xMin)},${Math.round(w.yMin)}`))
      const stamped = after.filter(
        (w) =>
          !before.has(`${w.t}@${Math.round(w.xMin)},${Math.round(w.yMin)}`) &&
          !/·/.test(w.t) &&
          w.yMin < info.height - 20,
      )
      const tagWords = stamped.filter((w) =>
        ['SB', 'W', 'LX', 'TM', 'SND', '11', '12.50', '20'].includes(w.t),
      )
      expect(tagWords.length).toBeGreaterThanOrEqual(4)
      for (const t of tagWords) {
        const left = t.xMax <= extent.minX
        const right = t.xMin >= extent.maxX
        expect(left || right, `${t.t} at ${t.xMin}-${t.xMax} is in the margin`).toBe(true)
      }
      // The script itself is untouched.
      expect(line.length).toBeGreaterThan(0)
      for (const w of words) expect(after.some((a) => a.t === w.t)).toBe(true)
    })

    test('five cues on a bottom line all stack above the footer, none off the page', async () => {
      const src = await read(FIXTURES.librettoShortPdf)
      const info = (await pageSizes(src))[0] as PageInfo
      const leads = ['AA', 'BB', 'CC', 'DD', 'EE']
      const out = await stampScript(
        src,
        leads.map((lead, i) =>
          cueAt(0, 300, 60, lead, String(i + 1), {
            sortKey: { department: i, major: i + 1, minor: 0 },
          }),
        ),
        footer,
      )
      const words = await bboxWords(out, 0)
      const footerTop = Math.min(...words.filter((w) => w.t === 'Pirates').map((w) => w.yMin))
      const tags = leads.map((l) => words.find((w) => w.t === l))
      for (const t of tags) {
        if (!t) throw new Error('a tag is missing from the page')
        expect(t.yMax).toBeLessThan(footerTop)
        expect(t.yMin).toBeGreaterThan(0)
      }
      // In page order, top to bottom.
      const tops = tags.map((t) => t?.yMin ?? 0)
      expect(tops).toEqual([...tops].sort((a, b) => a - b))
      expect(info.height).toBeGreaterThan(0)
    })

    test('a right-side department stamps its tag in the right margin', async () => {
      const { src, info, trigger, box, y } = await midLine()
      const out = await stampScript(
        src,
        [cueAt(0, box.x, y, 'SND', '4', { side: 'right', triggerBoxes: [box] })],
        footer,
      )
      const after = await bboxWords(out, 0)
      // (The footer names SND too, at the bottom left.)
      const snd = after.find((w) => w.t === 'SND' && w.xMin > info.width / 2)
      const four = after.find((w) => w.t === '4' && w.xMin > trigger.xMax)
      if (!snd || !four) throw new Error('the tag text is not in the text layer')
      expect(snd.xMin).toBeGreaterThan(trigger.xMax)
      // The pill ends 4 pt inside the right edge, its number 6 pt of padding short of that.
      expect(four.xMax).toBeLessThan(info.width - 4 - 4)
      expect(four.xMax).toBeGreaterThan(info.width - 40)
    })

    test('on a page turned a quarter, a mid-line cue still reads upright at the left', async () => {
      const src = await read(FIXTURES.mixedPdf)
      const info = (await pageSizes(src))[1] as PageInfo
      const out = await stampScript(
        src,
        [
          cueAt(1, 200, 300, 'LX', '12', {
            triggerBoxes: [{ x: 200, y: 295, w: 50, h: 10 }],
          }),
        ],
        footer,
      )
      const words = await bboxWords(out, 1)
      const lx = words.find((w) => w.t === 'LX')
      const twelve = words.find((w) => w.t === '12')
      if (!lx || !twelve) throw new Error('the tag text is not in the text layer')
      expect(lx.xMax).toBeLessThan(200)
      expect(lx.xMin).toBeCloseTo(10, 0)
      expect((lx.yMin + lx.yMax) / 2).toBeCloseTo(info.height - 300, -0.5)
      expect(twelve.xMin).toBeGreaterThan(lx.xMax)
      expect(Math.abs(twelve.yMin - lx.yMin)).toBeLessThan(2)
    })
  })

  test('stamping keeps page count, sizes, boxes, and the text layer', async () => {
    const src = await read(FIXTURES.scanPdf)
    const out = await stampScript(src, [cueAt(0, 72, 700, 'LX', '10')], footer)
    expect(await pageSizes(out)).toEqual(await pageSizes(src))
    expect((await pdftotext(out, 0)).replace(/\s+/g, ' ')).toContain('LX 10')

    const text = await read(FIXTURES.librettoShortPdf)
    const stamped = await stampScript(text, [cueAt(0, 72, 700, 'LX', '10')], footer)
    expect(await pageSizes(stamped)).toEqual(await pageSizes(text))
    const before = new Set((await bboxWords(text, 0)).map((w) => w.t))
    const after = new Set((await bboxWords(stamped, 0)).map((w) => w.t))
    expect(before.size).toBeGreaterThan(50)
    for (const word of before) expect(after.has(word), word).toBe(true)
  })

  test('the mixed PDF keeps its rotation, Letter page, and boxes', async () => {
    const src = await read(FIXTURES.mixedPdf)
    const out = await stampScript(src, [cueAt(1, 72, 500, 'LX', '10')], footer)
    const sizes = await pageSizes(out)
    expect(sizes).toEqual(await pageSizes(src))
    expect(sizes.map((s) => s.rotation)).toEqual([0, 90, 0, 0])
  })

  test('a lead outside WinAnsi stamps with question marks instead of throwing', async () => {
    const src = await read(FIXTURES.librettoPdf)
    const out = await stampScript(
      src,
      [cueAt(0, 72, 700, 'Ça ✓ 東京', '10', { textExtent: { minX: 300, maxX: 500 } })],
      footer,
    )
    expect(await pdftotext(out, 0)).toContain('Ça ? ??')
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
        cueAt(1, 100, 350, 'SB LX', '10', {
          type: 'standby',
          textExtent: { minX: 300, maxX: 600 },
        }),
        cueAt(1, 100, 380, 'W LX', '11', { type: 'warn', textExtent: { minX: 300, maxX: 600 } }),
      ],
      footer,
    )
    const words = await bboxWords(out, 1)
    const note = words.find((w) => w.t === 'Cover')
    const gap = words.find((w) => w.t === 'gap')
    if (!note || !gap) throw new Error('the note text is not in the text layer')
    expect(gap.xMin).toBeGreaterThan(note.xMin)
    expect(Math.abs(gap.yMin - note.yMin)).toBeLessThan(2)
    const text = (await pdftotext(out, 1)).replace(/\s+/g, ' ')
    for (const s of ['second paragraph', 'an unbound', 'SB LX 10', 'W LX 11']) {
      expect(text).toContain(s)
    }
    // The stamp is turned 3 degrees and letter-spaced (R23), so poppler may break its word: compare without spaces.
    expect(text.replace(/ /g, '')).toContain('Blackout')
    // A highlight's colour lands where its word box says (120 from the left, 400 up on a 595 tall
    // page), at 35% over white.
    const { height } = (await pageSizes(src))[1] as PageInfo
    expect(near(await pixelAt(out, 1, 140, height - 405), '#C0D8F5', 10)).toBe(true)
  })
})

describe.skipIf(skip)('page subset, paper fit and cue notes with poppler', () => {
  const norm = (s: string) => s.replace(/\s+/g, ' ')

  test('a page subset keeps only those pages, with the footer, and pdftotext still finds the script text', async () => {
    const src = await read(FIXTURES.librettoShortPdf)
    const sizes = await pageSizes(src)
    expect(sizes.length).toBeGreaterThanOrEqual(3)
    const out = await stampScript(
      src,
      [cueAt(0, 72, 700, 'LX', '10'), cueAt(2, 72, 700, 'LX', '12')],
      footer,
      { pages: [2, 1] },
    )
    expect(await pageSizes(out)).toEqual([sizes[1], sizes[2]])
    // Page 2 of the source is page 1 of the output, with the same words (and the footer).
    const original = new Set((await bboxWords(src, 1)).map((w) => w.t))
    const kept = new Set((await bboxWords(out, 0)).map((w) => w.t))
    expect(original.size).toBeGreaterThan(20)
    for (const w of original) expect(kept.has(w), w).toBe(true)
    for (const p of [0, 1]) expect(norm(await pdftotext(out, p))).toContain(FOOTER_TEXT)
    // The tag of the kept third page is on the second output page; the dropped page's is gone.
    expect(norm(await pdftotext(out, 1))).toContain('LX 12')
    expect(norm(await pdftotext(out, 0))).not.toContain('LX 10')
    expect(out.byteLength).toBeLessThan(src.byteLength)
  })

  test('a Letter fit keeps the text layer searchable and puts the words where the scaling says', async () => {
    const src = await read(FIXTURES.librettoShortPdf)
    const info = (await pageSizes(src))[0] as PageInfo
    // Fit to the paper the page is not already (within 3%) so the fit does something.
    const paper = Math.abs(info.width / 612 - 1) <= 0.03 ? 'A4' : 'Letter'
    const [tw, th] = paper === 'Letter' ? [612, 792] : [595.28, 841.89]
    const out = await stampScript(src, [], footer, { pages: [0], paper })
    const [fitted] = await pageSizes(out)
    expect(fitted?.width).toBeCloseTo(tw, 1)
    expect(fitted?.height).toBeCloseTo(th, 1)
    expect(fitted?.rotation).toBe(0)
    const scale = Math.min(tw / info.width, th / info.height)
    const dx = (tw - info.width * scale) / 2
    const dy = (th - info.height * scale) / 2
    const before = await bboxWords(src, 0)
    const after = await bboxWords(out, 0)
    expect(before.length).toBeGreaterThan(50)
    for (const w of before) {
      const moved = after.find(
        (a) =>
          a.t === w.t &&
          Math.abs(a.xMin - (dx + w.xMin * scale)) < 1 &&
          Math.abs(a.yMin - (dy + w.yMin * scale)) < 1,
      )
      expect(moved, `${w.t} at ${w.xMin},${w.yMin}`).toBeDefined()
    }
    // The footer is drawn before the fit, so it is on the sheet and scaled with the page.
    expect(norm(await pdftotext(out, 0))).toContain(FOOTER_TEXT)
    const first = after.find((w) => w.t === 'Pirates')
    expect(first?.xMin).toBeCloseTo(dx + 24 * scale, 0)
  })

  test('a rotated page is fitted upright, and a stamp on it keeps its place under the scaling', async () => {
    const src = await read(FIXTURES.mixedPdf)
    const info = (await pageSizes(src))[1] as PageInfo
    expect(info.rotation).toBe(90)
    const out = await stampScript(
      src,
      [cueAt(1, 200, 300, 'LX', '12', { triggerBoxes: [{ x: 200, y: 295, w: 50, h: 10 }] })],
      footer,
      { pages: [1], paper: 'Letter' },
    )
    const [fitted] = await pageSizes(out)
    expect([fitted?.width, fitted?.height, fitted?.rotation]).toEqual([792, 612, 0])
    const scale = Math.min(792 / info.width, 612 / info.height)
    const dx = (792 - info.width * scale) / 2
    const dy = (612 - info.height * scale) / 2
    const words = await bboxWords(out, 0)
    const lx = words.find((w) => w.t === 'LX')
    const twelve = words.find((w) => w.t === '12')
    if (!lx || !twelve) throw new Error('the tag text is not in the text layer')
    expect(lx.xMin).toBeCloseTo(dx + 10 * scale, 0)
    expect((lx.yMin + lx.yMax) / 2).toBeCloseTo(dy + (info.height - 300) * scale, -0.5)
    expect(twelve.xMin).toBeGreaterThan(lx.xMax)
    expect(Math.abs(twelve.yMin - lx.yMin)).toBeLessThan(2)
    // The tag's pill is drawn, in the department colour, where the scaling puts its top edge.
    expect(
      near(
        await pixelAt(out, 0, dx + 24 * scale, dy + (info.height - 300 - 7) * scale, 288),
        AMBER,
        40,
      ),
    ).toBe(true)
  })

  test('a cue note reads under its tag in the margin and never over the script', async () => {
    const src = await read(FIXTURES.librettoShortPdf)
    const info = (await pageSizes(src))[0] as PageInfo
    const words = await bboxWords(src, 0)
    const minX = Math.min(...words.map((w) => w.xMin))
    const note = { kind: 'cue-note', cueId: '', pageIndex: 0, text: 'Pad', colour: AMBER } as const
    const cue = cueAt(0, 300, 500, 'LX', '10', {
      textExtent: { minX, maxX: info.width - minX },
    })
    const out = await stampScript(
      src,
      [cue, { ...note, cueId: (cue as { id: string }).id }],
      footer,
    )
    const after = await bboxWords(out, 0)
    const lx = after.find((w) => w.t === 'LX')
    const pad = after.find((w) => w.t === 'Pad')
    if (!lx || !pad) throw new Error('the tag or its note is not in the text layer')
    // Under the tag (9 pt down), flush with its left edge, 7 pt type.
    expect(pad.yMin).toBeGreaterThan(lx.yMax)
    expect(pad.yMin - lx.yMin).toBeLessThan(14)
    expect(pad.xMin).toBeCloseTo(4, 0)
    expect(pad.yMax - pad.yMin).toBeLessThan(9)
    expect(pad.xMax).toBeLessThan(minX)
    for (const w of words) {
      const overlaps =
        pad.xMin < w.xMax && pad.xMax > w.xMin && pad.yMin < w.yMax && pad.yMax > w.yMin
      expect(overlaps, `note over ${w.t}`).toBe(false)
    }
  })
})

describe.skipIf(skip)('exportMarkedScript print options with poppler', () => {
  async function ready(title?: string) {
    const f = await setupMarkupShow()
    const key = searchableBlobKey(f.show.id, f.docId, f.versionId)
    await f.deps.blobs.put(key, new Uint8Array(librettoBytes()), 'application/pdf')
    await f.deps.db
      .update(documentVersions)
      .set({ searchableKey: key })
      .where(eq(documentVersions.id, f.versionId))
    if (title) await f.deps.db.update(shows).set({ title }).where(eq(shows.id, f.show.id))
    return f
  }

  async function bytesOf(f: Awaited<ReturnType<typeof ready>>, fileKey: string) {
    const blob = await f.deps.blobs.get(fileKey)
    if (!blob) throw new Error('export blob missing')
    const chunks: Buffer[] = []
    for await (const c of blob.stream) chunks.push(c as Buffer)
    return new Uint8Array(Buffer.concat(chunks))
  }

  const code = (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (e) => (e instanceof AppError ? e.code : `other: ${e}`),
    )

  const norm = (s: string) => s.replace(/\s+/g, ' ')

  test('a page range keeps only those pages and pdftotext still finds the script text', async () => {
    const f = await ready()
    const whole = new Uint8Array(librettoBytes())
    const { record } = await exportMarkedScript(f.deps.db, f.deps.blobs, f.actors.owner, {
      documentId: f.docId,
      layers: 'none',
      options: { pages: '2-3, 5' },
    })
    const out = await bytesOf(f, record.fileKey)
    expect((await pageSizes(out)).length).toBe(3)
    expect((await pageSizes(whole)).length).toBeGreaterThan(5)
    // Output page 1 reads the same as page 2 of the source (plus the footer).
    const want = norm(await pdftotext(whole, 1)).slice(0, 200)
    expect(want.length).toBeGreaterThan(40)
    expect(norm(await pdftotext(out, 0))).toContain(want)
    expect(norm(await pdftotext(out, 2))).toContain(norm(await pdftotext(whole, 4)).slice(0, 200))
    expect(out.byteLength).toBeLessThan(whole.byteLength)
  }, 30_000)

  test('a Letter fit keeps the text layer searchable', async () => {
    const f = await ready()
    const whole = new Uint8Array(librettoBytes())
    const { record } = await exportMarkedScript(f.deps.db, f.deps.blobs, f.actors.owner, {
      documentId: f.docId,
      layers: 'none',
      options: { pages: '1-2', paper: 'Letter' },
    })
    const out = await bytesOf(f, record.fileKey)
    const sizes = await pageSizes(out)
    expect(sizes.map((s) => [s.width, s.height])).toEqual([
      [612, 792],
      [612, 792],
    ])
    expect(norm(await pdftotext(out, 0))).toContain(norm(await pdftotext(whole, 0)).slice(0, 200))
  })

  test('options are stored on the export record, defaults filled in, and read back by list', async () => {
    const f = await ready()
    const { record } = await exportMarkedScript(f.deps.db, f.deps.blobs, f.actors.owner, {
      documentId: f.docId,
      layers: 'none',
      options: { pages: '3, 1-2', paper: 'A4', includeStandbyWarn: false },
    })
    const want = {
      pages: '1-3',
      paper: 'A4',
      includeStandbyWarn: false,
      includeAnnotations: true,
      includeCueNotes: true,
    }
    expect(record.options).toEqual(want)
    const listed = await listExportRecords(f.deps.db, f.actors.owner, { showId: f.show.id })
    expect(listed.find((r) => r.id === record.id)?.options).toEqual(want)
    // No options given: the record says what was done, with no paper refit.
    const plain = await exportMarkedScript(f.deps.db, f.deps.blobs, f.actors.owner, {
      documentId: f.docId,
      layers: 'none',
    })
    expect(plain.record.options).toEqual({
      pages: 'all',
      includeStandbyWarn: true,
      includeAnnotations: true,
      includeCueNotes: true,
    })
  })

  test('a range beyond the page count, or not a range, is invalid and stores nothing', async () => {
    const f = await ready()
    const count = (await pageSizes(new Uint8Array(librettoBytes()))).length
    for (const pages of [`1-${count + 1}`, `${count + 1}`, 'a-b', '0', '']) {
      const res = await code(
        exportMarkedScript(f.deps.db, f.deps.blobs, f.actors.owner, {
          documentId: f.docId,
          layers: 'none',
          options: { pages },
        }),
      )
      expect([pages, res]).toEqual([pages, 'invalid'])
    }
    expect(await listExportRecords(f.deps.db, f.actors.owner, { showId: f.show.id })).toHaveLength(
      0,
    )
  }, 30_000)

  test('a custom file name is used (with .pdf added) and an unsafe one is invalid', async () => {
    const f = await ready()
    const named = await exportMarkedScript(f.deps.db, f.deps.blobs, f.actors.owner, {
      documentId: f.docId,
      layers: 'none',
      filename: 'Act one pages',
    })
    expect(named.record.filename).toBe('Act one pages.pdf')
    for (const filename of ['a/b', 'CON', '.hidden', 'x'.repeat(201), '  ']) {
      const res = await code(
        exportMarkedScript(f.deps.db, f.deps.blobs, f.actors.owner, {
          documentId: f.docId,
          layers: 'none',
          filename,
        }),
      )
      expect([filename, res]).toEqual([filename, 'invalid'])
    }
  })

  test('exportMarkedScript of a highlight cue draws the department colour fill; of a line cue, the bar', async () => {
    const f = await ready()
    // A blank A4 page, so the pixels under the marks are paper.
    const blank = await blankPage(0)
    const key = searchableBlobKey(f.show.id, f.docId, f.versionId)
    await f.deps.blobs.put(key, blank, 'application/pdf')
    const height = 841.89
    const box = (t: string, x: number, y: number) => ({ t, x, y: y - 5, w: 60, h: 10 })
    // Line 0: "alpha bravo" at y 500 (highlighted); line 1: "charlie delta" at y 400 (a bar in "charlie").
    const words = [
      box('alpha', 200, 500),
      box('bravo', 270, 500),
      box('charlie', 200, 400),
      box('delta', 270, 400),
    ]
    await putWordLayer(f.deps.db, f.deps.blobs, f.versionId, 0, {
      words,
      lines: [
        [0, 1],
        [2, 3],
      ],
    })
    const anchor = (y: number, x: number, quote: string, wordStart: number, extra = {}) => ({
      documentId: f.docId,
      documentVersionId: f.versionId,
      pageIndex: 0,
      x,
      y,
      status: 'ok' as const,
      text: { quote, wordStart, wordEnd: wordStart + 1 },
      ...extra,
    })
    await createCue(f.deps.db, f.actors.owner, {
      showId: f.show.id,
      departmentId: f.depts.LX.id,
      number: { major: 1, minor: 0 },
      anchor: anchor(500, 200, 'alpha bravo', 0, { mark: 'highlight' }),
    })
    const offset = 3
    const bar = caretX(words[2] as { t: string; x: number; w: number }, offset)
    await createCue(f.deps.db, f.actors.owner, {
      showId: f.show.id,
      departmentId: f.depts.LX.id,
      number: { major: 2, minor: 0 },
      anchor: {
        ...anchor(400, bar, 'charlie delta', 2, { mark: 'line' }),
        text: { quote: 'charlie delta', wordStart: 2, wordEnd: 3, offset },
      },
    })
    const { record } = await exportMarkedScript(f.deps.db, f.deps.blobs, f.actors.owner, {
      documentId: f.docId,
      layers: [{ kind: 'department', id: f.depts.LX.id }],
    })
    const out = await bytesOf(f, record.fileKey)

    // The highlight: the department colour at 28% over paper, across the whole range.
    const tint = (hex: string) =>
      `#${[1, 3, 5]
        .map((i) => Math.round(255 * 0.72 + Number.parseInt(hex.slice(i, i + 2), 16) * 0.28))
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')}`
    const lx = f.depts.LX.colour
    for (const x of [215, 255, 300])
      expect(near(await pixelAt(out, 0, x, height - 500), tint(lx))).toBe(true)
    // Not outside the range, and not on the line cue's words.
    expect(near(await pixelAt(out, 0, 190, height - 500), '#FFFFFF')).toBe(true)
    expect(near(await pixelAt(out, 0, 215, height - 400), '#FFFFFF')).toBe(true)

    // The line: a solid bar of the department colour at the caret, none beside it.
    expect(near(await pixelAt(out, 0, bar, height - 400, 288), lx)).toBe(true)
    expect(near(await pixelAt(out, 0, bar + 6, height - 400, 288), '#FFFFFF')).toBe(true)
    expect(near(await pixelAt(out, 0, bar - 6, height - 400, 288), '#FFFFFF')).toBe(true)
  }, 60_000)

  test('the default file name is the slug form', async () => {
    const f = await ready('Songs for a New World')
    const all = await exportMarkedScript(f.deps.db, f.deps.blobs, f.actors.owner, {
      documentId: f.docId,
      layers: 'all',
    })
    expect(all.record.filename).toBe('songs-for-a-new-world-libretto-v1-all-layers.pdf')
    const lx = await exportMarkedScript(f.deps.db, f.deps.blobs, f.actors.owner, {
      documentId: f.docId,
      layers: [{ kind: 'department', id: f.depts.LX.id }],
    })
    expect(lx.record.filename).toBe('songs-for-a-new-world-libretto-v1-LX.pdf')
  })
})
