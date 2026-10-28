import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CUE_SIZE_SCALE,
  type CueFields,
  type CueMark,
  type CueSize,
  type WordLayer,
} from '@binder/shared'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, test } from 'vitest'
import { pdfContent } from '../../test/pdfTexts'
import { TAG_EDGE, TAG_HEIGHT, TEXT_CLEARANCE } from '../markup/cueTags'
import { helveticaBoldWidth, helveticaWidth } from '../markup/helvetica'
import { buildStampItems } from './stampItems'
import { stampScript } from './stampScript'

/**
 * A synthetic script page (A4, Helvetica 11 pt, a 100 pt margin each side) stamped with the same
 * cues at Normal, Large and mixed sizes: crowded lines at the top and the bottom, both margins,
 * long numbers, every mark and a bubble moved into the bottom right corner. Set BINDER_VISUAL_OUT
 * to a folder to keep the PDFs for a visual check (pdftoppm renders them).
 */
const W = 595
const H = 842
const FONT = 11
const LEFT = 100
const FOOTER_TOP = 19
const LINES = [
  'Poor wand ring one if I have strayed',
  'from the true path of duty and of right',
  'I come to bring the sergeant and his men',
  'When the foeman bares his steel tarantara',
  'We uncomfortable feel tarantara',
  'And we find the wisest thing tarantara',
  'Is to slap our chests and sing tarantara',
  'For when threatened with emeutes tarantara',
  'And your heart is in your boots tarantara',
]

/** Lines of script down the page, each a run of Helvetica words, with their word boxes. */
function script(): { words: WordLayer; lineYs: number[] } {
  const words: WordLayer['words'] = []
  const lines: number[][] = []
  const lineYs: number[] = []
  // Nine lines at the top, nine at the bottom (so tags crowd both ends) and a few between.
  const ys = [
    ...LINES.map((_, i) => 800 - i * 14),
    ...[500, 470, 440],
    ...LINES.map((_, i) => 34 + (LINES.length - 1 - i) * 14),
  ]
  ys.forEach((y, n) => {
    const text = LINES[n % LINES.length] as string
    const line: number[] = []
    let x = LEFT
    for (const t of text.split(' ')) {
      const w = helveticaWidth(t, FONT)
      line.push(words.length)
      words.push({ t, x, y: y - 2, w, h: FONT })
      x += w + helveticaWidth(' ', FONT)
    }
    lines.push(line)
    lineYs.push(y)
  })
  return { words: { words, lines }, lineYs }
}

async function scriptPdf(layer: WordLayer): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([W, H])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const line of layer.lines) {
    for (const i of line) {
      const w = layer.words[i] as WordLayer['words'][number]
      page.drawText(w.t, { x: w.x, y: w.y + 2, size: FONT, font })
    }
  }
  return doc.save()
}

const DEPTS = [
  { id: 'd-lx', code: 'LX', colour: '#C9811F', numberFormat: 'decimal' as const, sortOrder: 0 },
  { id: 'd-snd', code: 'SND', colour: '#2F6BD6', numberFormat: 'point' as const, sortOrder: 10 },
]

function cues(layer: WordLayer, lineYs: number[]): Array<CueFields & { id: string }> {
  const out: Array<CueFields & { id: string }> = []
  const marks: CueMark[] = ['underline', 'highlight', 'line', 'pointer']
  const at = (line: number, dept: string, n: number, extra: Partial<CueFields> = {}) => {
    const idx = layer.lines[line] as number[]
    const first = idx[1] as number
    const w = layer.words[first] as WordLayer['words'][number]
    const mark = marks[n % marks.length] as CueMark
    out.push({
      id: `c${out.length}`,
      departmentId: dept,
      major: n % 3 === 0 ? 1234 : 10 + n,
      minor: n % 3 === 0 ? 56 : 50,
      label: `Cue ${n}`,
      type: n % 5 === 1 ? 'standby' : n % 5 === 2 ? 'warn' : 'go',
      notes: n % 4 === 0 ? 'Slow 8 count fade' : '',
      colour: null,
      anchor: {
        documentId: 'doc',
        documentVersionId: 'v1',
        pageIndex: 0,
        x: w.x,
        y: lineYs[line] as number,
        text: {
          quote: w.t,
          wordStart: first,
          wordEnd: first,
          ...(mark === 'line' || mark === 'pointer' ? { offset: 1 } : {}),
        },
        mark,
        status: 'ok',
      },
      ...extra,
    })
  }
  let n = 0
  // Crowded top: two departments on each of the first four lines, both sides.
  for (const line of [0, 0, 1, 1, 2, 3]) at(line, n % 2 ? 'd-snd' : 'd-lx', n++)
  // Crowded bottom: the last four lines.
  const last = layer.lines.length - 1
  for (const line of [last, last, last - 1, last - 1, last - 2, last - 3]) {
    at(line, n % 2 ? 'd-snd' : 'd-lx', n++)
  }
  return out
}

/** One LX cue in the middle of the page whose bubble was dragged past the bottom right corner. */
function movedCue(layer: WordLayer, lineYs: number[]): Array<CueFields & { id: string }> {
  const idx = layer.lines[10] as number[]
  const w = layer.words[idx[1] as number] as WordLayer['words'][number]
  return [
    {
      id: 'moved',
      departmentId: 'd-lx',
      major: 22,
      minor: 50,
      label: 'Moved',
      type: 'go',
      notes: '',
      colour: null,
      anchor: {
        documentId: 'doc',
        documentVersionId: 'v1',
        pageIndex: 0,
        x: w.x,
        y: lineYs[10] as number,
        text: { quote: w.t, wordStart: idx[1] as number, wordEnd: idx[1] as number },
        tag: { dx: 900, dy: -900 },
        status: 'ok',
      },
    },
  ]
}

/** Every string a page draws, with its baseline position and size. */
function drawnText(content: string): Array<{ text: string; x: number; y: number; size: number }> {
  const out: Array<{ text: string; x: number; y: number; size: number }> = []
  let size = 0
  for (const m of content.matchAll(
    /\/\S+ ([\d.]+) Tf|[-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ ([-\d.]+) ([-\d.]+) Tm|<([0-9A-Fa-f\s]*)>\s*Tj/g,
  )) {
    if (m[1]) size = Number(m[1])
    else if (m[2]) out.push({ text: '', x: Number(m[2]), y: Number(m[3]), size })
    else if (m[4] !== undefined) {
      const last = out.at(-1)
      if (last) last.text = Buffer.from(m[4].replace(/\s+/g, ''), 'hex').toString('latin1')
    }
  }
  return out
}

async function stamp(sizes: Record<string, CueSize>, which: 'stacks' | 'moved' = 'stacks') {
  const { words, lineYs } = script()
  const items = buildStampItems({
    versionId: 'v1',
    layers: DEPTS.map((d) => ({ kind: 'department' as const, id: d.id })),
    cues: which === 'stacks' ? cues(words, lineYs) : movedCue(words, lineYs),
    annotations: [],
    departments: DEPTS,
    settings: { cueSizes: sizes, markerSides: { 'd-snd': 'right' } },
    wordLayers: new Map([[0, words]]),
  })
  const bytes = await stampScript(await scriptPdf(words), items, {
    showTitle: 'Synthetic',
    documentLabel: 'Public-domain test page',
    layerLabel: 'LX, SND',
    binderVersion: 1,
    exportId: 'visual',
    date: new Date(2026, 9, 28, 12, 0),
  })
  const content = ((await pdfContent(bytes))[0] as string).replace(/\r/g, '')
  return { bytes, content, words }
}

const out = process.env.BINDER_VISUAL_OUT
const keep = (name: string, bytes: Uint8Array) => {
  if (!out) return
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, name), bytes)
}

describe('synthetic PDF visual fixtures for cue size', () => {
  test.each([
    ['normal', {}],
    ['large', { 'd-lx': 'large', 'd-snd': 'large' }],
    ['mixed', { 'd-snd': 'large' }],
  ] as const)(
    '%s: tags print at their size, inside the page, off the footer, clear of the script and of each other',
    async (name, sizes) => {
      const { bytes, content, words } = await stamp(sizes as Record<string, CueSize>)
      keep(`cue-size-${name}.pdf`, bytes)
      const minX = Math.min(...words.words.map((w) => w.x))
      const maxX = Math.max(...words.words.map((w) => w.x + w.w))
      const scaleOf = (dept: string) =>
        (sizes as Record<string, CueSize>)[dept] === 'large' ? CUE_SIZE_SCALE.large : 1
      // The tag numbers: page ink, bold, a known number string.
      const numbers = drawnText(content).filter((t) => /^\d+\.\d+$/.test(t.text))
      expect(numbers.length).toBe(12)
      const sizesSeen = new Set(numbers.map((t) => t.size))
      for (const [dept, side] of [
        ['d-lx', 'left'],
        ['d-snd', 'right'],
      ] as const) {
        const font = 9 * scaleOf(dept)
        expect(
          sizesSeen.has(Number(font.toFixed(4))) || sizesSeen.has(font),
          `${dept} ${font}`,
        ).toBe(true)
        const mine = numbers
          .filter((t) => Math.abs(t.size - font) < 1e-6)
          .filter((t) => (side === 'left' ? t.x < W / 2 : t.x > W / 2))
        const height = TAG_HEIGHT * scaleOf(dept)
        for (const t of mine) {
          const right = t.x + helveticaBoldWidth(t.text, t.size)
          // Inside the page with its padding, never clipped.
          expect(t.x).toBeGreaterThanOrEqual(TAG_EDGE)
          expect(right).toBeLessThanOrEqual(W - TAG_EDGE)
          expect(t.y).toBeGreaterThanOrEqual(FOOTER_TOP)
          expect(t.y + t.size).toBeLessThanOrEqual(H)
          // A margin tag never reaches into the script.
          if (side === 'left' && t.x < LEFT)
            expect(right).toBeLessThanOrEqual(minX - TEXT_CLEARANCE)
          if (side === 'right' && t.x > maxX)
            expect(t.x).toBeGreaterThanOrEqual(maxX + TEXT_CLEARANCE)
        }
        // Every tag of one size on one side is at least a pill apart: none overlaps another.
        const ys = mine.map((t) => t.y).sort((a, b) => b - a)
        for (let i = 1; i < ys.length; i++) {
          expect((ys[i - 1] as number) - (ys[i] as number)).toBeGreaterThanOrEqual(height - 1e-6)
        }
      }
    },
  )

  test.each([
    ['normal', 1],
    ['large', CUE_SIZE_SCALE.large],
  ] as const)(
    'a %s bubble dragged past the bottom right corner is held on the page by its own size',
    async (name, scale) => {
      const sizes: Record<string, CueSize> = name === 'large' ? { 'd-lx': 'large' } : {}
      const { bytes, content } = await stamp(sizes, 'moved')
      keep(`cue-size-moved-${name}.pdf`, bytes)
      const [t] = drawnText(content).filter((d) => d.text === '22.5')
      if (!t) throw new Error('the moved bubble did not print')
      expect(t.size).toBeCloseTo(9 * scale)
      // Its pill (padding included) ends at the page's right edge and sits on the footer's top.
      const pad = 6 * scale
      expect(t.x + helveticaBoldWidth('22.5', t.size) + pad).toBeCloseTo(W, 6)
      expect(t.y).toBeGreaterThanOrEqual(FOOTER_TOP)
      expect(t.y + t.size).toBeLessThanOrEqual(FOOTER_TOP + TAG_HEIGHT * scale)
    },
  )

  test('large is a real size increase on paper: every tag number is 1.3 times the normal type', async () => {
    const normal = drawnText((await stamp({})).content).filter((t) => /^\d+\.\d+$/.test(t.text))
    const large = drawnText((await stamp({ 'd-lx': 'large', 'd-snd': 'large' })).content).filter(
      (t) => /^\d+\.\d+$/.test(t.text),
    )
    expect(new Set(normal.map((t) => t.size))).toEqual(new Set([9]))
    expect([...new Set(large.map((t) => t.size))].map((s) => s / 9)).toEqual([
      expect.closeTo(CUE_SIZE_SCALE.large, 6),
    ])
  })
})
