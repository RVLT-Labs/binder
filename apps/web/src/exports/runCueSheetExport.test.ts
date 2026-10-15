import { strFromU8, unzipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import { beforeEach, expect, test } from 'vitest'
import { clearNotices, getNotices } from '../components/noticeStore'
import type { EditContext } from '../markup/mutations'
import type { PendingExport } from './outbox'
import { runCueSheetExport } from './runCueSheetExport'
import type { ExportDb } from './runPrintExport'

beforeEach(() => clearNotices())

const ctx: EditContext = {
  showId: 'show-1',
  userId: 'user-me',
  scope: { role: 'viewer', departments: [] },
}

const anchor = (pageIndex: number, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    documentId: 'doc-1',
    documentVersionId: 'v2',
    pageIndex,
    x: 100,
    y: 200,
    status: 'ok',
    ...over,
  })

const cueRow = (id: string, dept: string, major: number, minor: number, over = {}) => ({
  id,
  department_id: dept,
  major,
  minor,
  label: `Cue ${id}`,
  type: 'go',
  notes: '',
  colour: null,
  anchor: anchor(0),
  ...over,
})

const departments = [
  { id: 'd-lx', code: 'LX', number_format: 'point' },
  { id: 'd-snd', code: 'SND', number_format: 'decimal' },
]
let settings: string | null = null
let cues = [
  cueRow('a', 'd-lx', 10, 50, {
    label: 'Sunrise, slowly',
    notes: 'say "go"',
    anchor: anchor(2, { text: { quote: 'and so it begins', wordStart: 2, wordEnd: 5 } }),
  }),
  cueRow('b', 'd-lx', 20, 0, { label: '=BAD()', anchor: null }),
  cueRow('c', 'd-snd', 30, 0),
  cueRow('d', 'd-lx', 5, 0, { type: 'bogus' }),
]
const documents = [{ id: 'doc-1', title: 'Libretto', current_version_id: 'v2' }]

function fakeDb(): ExportDb {
  return {
    async getAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const rows = (() => {
        if (sql.includes('FROM shows')) return [{ title: 'Pirates: A/B', settings }]
        if (sql.includes('FROM departments')) return departments.filter((d) => d.id === params[0])
        if (sql.includes('FROM cues')) return cues.filter((c) => c.department_id === params[1])
        if (sql.includes('FROM documents')) return documents
        throw new Error(`unexpected query ${sql}`)
      })()
      return rows as T[]
    },
  }
}

async function run(format: 'pdf' | 'xlsx' | 'csv', departmentId = 'd-lx') {
  const downloads: Array<{ filename: string; bytes: Uint8Array; contentType: string }> = []
  const queued: PendingExport[] = []
  const result = await runCueSheetExport(
    fakeDb(),
    ctx,
    { departmentId, format },
    {
      download: (filename, bytes, contentType) => downloads.push({ filename, bytes, contentType }),
      enqueue: async (p) => void queued.push(p),
      now: () => new Date(2026, 9, 15, 14, 2),
    },
  )
  return { result, downloads, queued }
}

const utf8 = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)

test('csv: downloads at once, then queues the same bytes for upload as a department export', async () => {
  const { result, downloads, queued } = await run('csv')
  expect(result.filename).toBe('Pirates- A-B - LX cue sheet.csv')
  expect(downloads).toEqual([
    { filename: result.filename, bytes: result.bytes, contentType: 'text/csv' },
  ])
  expect(queued).toHaveLength(1)
  expect(queued[0]).toMatchObject({
    id: result.id,
    showId: 'show-1',
    userId: 'user-me',
    contentType: 'text/csv',
    meta: {
      id: result.id,
      kind: 'csv',
      filename: result.filename,
      layerSelection: [{ kind: 'department', id: 'd-lx' }],
      createdAt: new Date(2026, 9, 15, 14, 2).toISOString(),
    },
  })
  expect(queued[0]?.bytes).toBe(result.bytes)

  expect([...result.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const lines = utf8(result.bytes).split('\r\n')
  expect(lines[0]).toContain('Cue,Type,Label,Page,Document,Trigger,Notes,Status')
  // Point numbering, the quote as trigger, one-based page, quoting; then the unplaced cue, guarded.
  expect(lines[1]).toBe('10.50,go,"Sunrise, slowly",3,,and so it begins,"say ""go""",')
  expect(lines[2]).toBe("20,go,'=BAD(),,,,,")
  // Other departments' cues and cues with an unknown type are left out.
  expect(lines).toHaveLength(4 + 0)
  expect(lines[3]).toBe('')
})

test('xlsx: an inline-string workbook whose Page is a number', async () => {
  const { result, downloads, queued } = await run('xlsx')
  expect(result.filename).toBe('Pirates- A-B - LX cue sheet.xlsx')
  const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  expect(downloads[0]?.contentType).toBe(type)
  expect(queued[0]).toMatchObject({ contentType: type, meta: { kind: 'xlsx' } })
  const files = unzipSync(result.bytes)
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml'] as Uint8Array)
  expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t>10.50</t></is></c>')
  expect(sheet).toContain('<c r="D2" t="n"><v>3</v></c>')
  expect(sheet).not.toContain('r="D3"')
  expect(strFromU8(files['xl/workbook.xml'] as Uint8Array)).toContain('name="LX"')
})

test('pdf: A4 by default, Letter when the show says so, as a pdf-sheet', async () => {
  const a4 = await run('pdf')
  expect(a4.result.filename).toBe('Pirates- A-B - LX cue sheet.pdf')
  expect(a4.queued[0]).toMatchObject({
    contentType: 'application/pdf',
    meta: { kind: 'pdf-sheet' },
  })
  const doc = await PDFDocument.load(a4.result.bytes)
  expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 1)

  settings = '{"paperSize":"Letter"}'
  try {
    const letter = await PDFDocument.load((await run('pdf')).result.bytes)
    expect([letter.getPage(0).getWidth(), letter.getPage(0).getHeight()]).toEqual([612, 792])
  } finally {
    settings = null
  }
})

test('the document title shows when the department has cues in more than one document', async () => {
  const saved = cues
  cues = [
    cueRow('a', 'd-lx', 10, 0),
    cueRow('b', 'd-lx', 20, 0, {
      anchor: anchor(0, { documentId: 'doc-2', documentVersionId: 'w1' }),
    }),
  ]
  documents.push({ id: 'doc-2', title: 'Score', current_version_id: 'w1' })
  try {
    const lines = utf8((await run('csv')).result.bytes).split('\r\n')
    expect(lines[1]).toBe('10,go,Cue a,1,Libretto,,,')
    expect(lines[2]).toBe('20,go,Cue b,1,Score,,,')
  } finally {
    cues = saved
    documents.pop()
  }
})

test('a department that is not on this device is a clear error and nothing is downloaded', async () => {
  const downloads: unknown[] = []
  await expect(
    runCueSheetExport(
      fakeDb(),
      ctx,
      { departmentId: 'd-missing', format: 'csv' },
      { download: () => void downloads.push(1), enqueue: async () => {} },
    ),
  ).rejects.toThrow(/not on this device/)
  expect(downloads).toEqual([])
})

test('if the outbox cannot keep the file it is still downloaded, and a notice says so', async () => {
  const downloads: unknown[] = []
  const result = await runCueSheetExport(
    fakeDb(),
    ctx,
    { departmentId: 'd-lx', format: 'csv' },
    {
      download: () => void downloads.push(1),
      enqueue: async () => {
        throw new Error('quota')
      },
    },
  )
  expect(downloads).toHaveLength(1)
  expect(result.filename).toContain('LX cue sheet')
  expect(
    getNotices()
      .map((n) => n.message)
      .join(),
  ).toMatch(/was downloaded, but Binder could not keep a copy.*quota/)
})
