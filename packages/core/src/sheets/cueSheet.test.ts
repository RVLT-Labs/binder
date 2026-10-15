import type { Anchor, CueFields } from '@binder/shared'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, test } from 'vitest'
import { pdfTexts } from '../../test/pdfTexts'
import { cueListRows } from '../cues/cueList'
import type { FooterInfo } from '../print/footer'
import {
  CUE_SHEET_COLUMNS,
  type CueSheetRow,
  cueSheetCsv,
  cueSheetPdf,
  toCueSheetRows,
} from './cueSheet'

const row = (over: Partial<CueSheetRow> = {}): CueSheetRow => ({
  cue: '10',
  type: 'go',
  label: 'Lights up',
  page: 1,
  document: '',
  trigger: '',
  notes: '',
  status: '',
  ...over,
})

describe('toCueSheetRows', () => {
  const docs = [
    { id: 'd1', title: 'Libretto', currentVersionId: 'v2' },
    { id: 'd2', title: 'Score', currentVersionId: 'w1' },
  ]
  const anchor = (over: Partial<Anchor> = {}): Anchor => ({
    documentId: 'd1',
    documentVersionId: 'v2',
    pageIndex: 0,
    x: 10,
    y: 700,
    status: 'ok',
    ...over,
  })
  const cue = (
    id: string,
    major: number,
    over: Partial<CueFields> = {},
  ): CueFields & { id: string } => ({
    id,
    departmentId: 'lx',
    major,
    minor: 0,
    label: `L${id}`,
    type: 'go',
    notes: '',
    colour: null,
    anchor: anchor(),
    ...over,
  })
  const rowsOf = (cues: Array<CueFields & { id: string }>) =>
    toCueSheetRows(cueListRows(cues, [{ id: 'lx', code: 'LX', numberFormat: 'point' }], docs))

  test('the page is one-based from the anchor, and null when the cue is unplaced', () => {
    const rows = rowsOf([
      cue('a', 10, { anchor: anchor({ pageIndex: 6 }) }),
      cue('b', 20, { anchor: null }),
    ])
    expect(rows.map((r) => r.page)).toEqual([7, null])
  })

  test('carries the number as the department shows it, the type, label, trigger and notes', () => {
    const [r] = rowsOf([
      cue('a', 14, {
        minor: 5,
        type: 'standby',
        label: 'Spot on',
        notes: 'cover',
        anchor: anchor({ text: { quote: 'a big entrance', wordStart: 3, wordEnd: 5 } }),
      }),
    ])
    expect(r).toEqual({
      cue: '14.05',
      type: 'standby',
      label: 'Spot on',
      page: 1,
      document: '',
      trigger: 'a big entrance',
      notes: 'cover',
      status: '',
    })
  })

  test('the document title appears only when the department has cues in more than one document', () => {
    const one = rowsOf([cue('a', 10), cue('b', 20)])
    expect(one.map((r) => r.document)).toEqual(['', ''])
    const two = rowsOf([
      cue('a', 10),
      cue('b', 20, { anchor: anchor({ documentId: 'd2', documentVersionId: 'w1' }) }),
    ])
    expect(two.map((r) => r.document)).toEqual(['Libretto', 'Score'])
  })

  test('flags become words, joined with a comma', () => {
    const rows = rowsOf([
      cue('a', 10),
      cue('b', 10, { anchor: anchor({ status: 'approximate', documentVersionId: 'v1' }) }),
      cue('c', 20, { anchor: anchor({ status: 'unresolved' }) }),
    ])
    expect(rows.map((r) => r.status)).toEqual([
      'duplicate',
      'duplicate, approximate, on older version',
      'unresolved',
    ])
  })
})

describe('cueSheetCsv', () => {
  test('CSV has a BOM, CRLF, quoting, and a formula guard', () => {
    const csv = cueSheetCsv([
      row({ cue: '10', label: 'Lights, up', page: 1, notes: 'He said "go"' }),
      row({ cue: '10.5', label: '=SUM(A1)', page: 1, notes: 'two\nlines' }),
    ])
    expect(csv.startsWith('\uFEFFCue,Type,Label,Page,Document,Trigger,Notes,Status\r\n')).toBe(true)
    expect(csv).toContain('10,go,"Lights, up",1,,,"He said ""go""",\r\n')
    expect(csv).toContain(`10.5,go,'=SUM(A1),1,,,"two\nlines",\r\n`)
  })

  test('the header is the column list, every row ends in CRLF, and an empty sheet is the header alone', () => {
    expect(CUE_SHEET_COLUMNS).toEqual([
      'Cue',
      'Type',
      'Label',
      'Page',
      'Document',
      'Trigger',
      'Notes',
      'Status',
    ])
    expect(cueSheetCsv([])).toBe(`\uFEFF${CUE_SHEET_COLUMNS.join(',')}\r\n`)
    const csv = cueSheetCsv([row(), row({ cue: '20' })])
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.split('\r\n')).toHaveLength(4)
  })

  test('a null page is an empty cell', () => {
    expect(cueSheetCsv([row({ page: null })])).toContain('10,go,Lights up,,,,,\r\n')
  })

  test.each(['=', '+', '-', '@', '\t', '\r'])(
    'a cell starting with %j is prefixed with an apostrophe in every text column',
    (c) => {
      const text = `${c}x`
      const csv = cueSheetCsv([
        row({ cue: text, label: text, document: text, trigger: text, notes: text, status: text }),
      ])
      const body = csv.slice(csv.indexOf('\r\n') + 2)
      const quoted = (s: string) => (/[",\r\n]/.test(s) ? `"${s}"` : s)
      const guarded = quoted(`'${text}`)
      expect(body).toBe(
        `${guarded},go,${guarded},1,${guarded},${guarded},${guarded},${guarded}\r\n`,
      )
    },
  )

  test('a cell that merely contains those characters is left alone, and so is a plain minus inside text', () => {
    expect(cueSheetCsv([row({ label: 'a=b', notes: 'x-y @z' })])).toContain(
      '10,go,a=b,1,,,x-y @z,\r\n',
    )
  })

  test('Unicode passes through', () => {
    expect(cueSheetCsv([row({ label: 'Café – “go” 🎭' })])).toContain('Café – “go” 🎭')
  })
})

describe('cueSheetPdf', () => {
  const footer: FooterInfo = {
    showTitle: 'Pirates',
    documentLabel: 'LX cue sheet',
    layerLabel: 'LX',
    binderVersion: null,
    exportId: '0190f3a2-0000-7000-8000-00000000abcd',
    date: new Date(2026, 9, 15, 14, 2),
  }
  const FOOTER = 'Pirates · LX cue sheet · LX · export 0000abcd · 2026-10-15 14:02'
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      row({
        cue: String(10 + i),
        label: `Cue number ${i + 1}`,
        page: (i % 40) + 1,
        trigger: 'the quick brown fox',
        notes: 'a note',
      }),
    )

  test('a 120-row PDF on A4 has more than one page, repeats the header row, and footers every page', async () => {
    const bytes = await cueSheetPdf(many(120), { title: 'LX cue sheet', paper: 'A4', footer })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThan(1)
    const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()]
    expect(w).toBeCloseTo(595.28, 1)
    expect(h).toBeCloseTo(841.89, 1)
    const texts = await pdfTexts(bytes)
    expect(texts).toHaveLength(doc.getPageCount())
    for (const page of texts) {
      // The header row sits at the top of every page, in column order.
      const header = page.filter((t) => (CUE_SHEET_COLUMNS as readonly string[]).includes(t))
      expect(header.slice(0, 8)).toEqual([...CUE_SHEET_COLUMNS])
      expect(page).toContain(FOOTER)
    }
    // Every cue is drawn once, across the pages.
    const all = texts.flat()
    expect(all.filter((t) => /^Cue number \d+$/.test(t))).toHaveLength(120)
    expect(all).toContain('Cue number 120')
    expect(texts[0]).toContain('LX cue sheet')
  })

  test('Letter pages are 612 x 792', async () => {
    const bytes = await cueSheetPdf(many(120), { title: 'LX cue sheet', paper: 'Letter', footer })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThan(1)
    for (const page of doc.getPages()) {
      expect(page.getWidth()).toBe(612)
      expect(page.getHeight()).toBe(792)
    }
  })

  test('no rows still gives one page with the header and the footer', async () => {
    const bytes = await cueSheetPdf([], { title: 'LX cue sheet', paper: 'A4', footer })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    const [texts] = await pdfTexts(bytes)
    expect(texts).toContain('Cue')
    expect(texts).toContain(FOOTER)
  })

  test('long cells wrap onto more lines and a row never splits across pages', async () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
    const bytes = await cueSheetPdf([row({ cue: '10', label: long, notes: long }), ...many(3)], {
      title: 'LX',
      paper: 'A4',
      footer,
    })
    const [page] = await pdfTexts(bytes)
    // Wrapped into several short drawn lines, none of them the whole sentence.
    const label = (page as string[]).filter((t) => /^word\d/.test(t))
    expect(label.length).toBeGreaterThan(10)
    expect(label.every((t) => t.length < long.length / 4)).toBe(true)
    // The words survive in order across the label column's lines.
    expect(label.join(' ').replace(/\s+/g, ' ')).toContain('word0 word1 word2')
  })

  test('a word wider than its column is broken rather than overflowing', async () => {
    const bytes = await cueSheetPdf([row({ label: 'W'.repeat(200) })], {
      title: 'LX',
      paper: 'A4',
      footer,
    })
    const [page] = await pdfTexts(bytes)
    const parts = (page as string[]).filter((t) => /^W+$/.test(t))
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join('')).toBe('W'.repeat(200))
  })

  test('text outside WinAnsi is made safe instead of throwing', async () => {
    const bytes = await cueSheetPdf(
      [row({ label: 'Emoji 🎭 日本語 café', notes: 'tab\there', trigger: '“quoted” – dash' })],
      { title: 'Show 🎭 sheet', paper: 'Letter', footer: { ...footer, showTitle: 'Shöw 🎭' } },
    )
    const [page] = await pdfTexts(bytes)
    const all = (page as string[]).join('|')
    expect(all).toContain('Emoji ? ??? café')
    expect(all).toContain('Show ? sheet')
    expect(all).toContain('Shöw ?')
  })
})
