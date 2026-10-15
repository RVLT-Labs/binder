import type * as core from '@binder/core'
import type { LayerRef } from '@binder/shared'
import { PDFDocument } from 'pdf-lib'
import { beforeEach, expect, test, vi } from 'vitest'
import { clearNotices } from '../components/noticeStore'
import type { EditContext } from '../markup/mutations'
import type { PendingExport } from './outbox'
import { type ExportDb, exportFilename, runPrintExport } from './runPrintExport'

const stamp = vi.hoisted(() => ({ calls: [] as unknown[][] }))
vi.mock('@binder/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@binder/core')>()
  return {
    ...real,
    stampScript: (...args: Parameters<typeof real.stampScript>) => {
      stamp.calls.push(args)
      return real.stampScript(...args)
    },
  }
})

beforeEach(() => {
  clearNotices()
  stamp.calls = []
})

const ME = 'user-me'
const OTHER = 'user-other'
const ctx: EditContext = {
  showId: 'show-1',
  userId: ME,
  scope: { role: 'editor', departments: [] },
}

const anchor = (pageIndex: number, versionId = 'v1') =>
  JSON.stringify({
    documentId: 'doc-1',
    documentVersionId: versionId,
    pageIndex,
    x: 100,
    y: 200,
    status: 'ok',
  })

const departments = [
  { id: 'd-lx', code: 'LX', colour: '#F5A623', number_format: 'decimal', hidden: 0 },
  { id: 'd-snd', code: 'SND', colour: '#2E90FA', number_format: 'decimal', hidden: 0 },
  { id: 'd-old', code: 'OLD', colour: '#667085', number_format: 'point', hidden: 1 },
]
const cues = [
  {
    id: 'c1',
    department_id: 'd-lx',
    major: 10,
    minor: 0,
    label: 'Sunrise',
    type: 'go',
    notes: '',
    colour: null,
    anchor: anchor(0),
  },
  {
    id: 'c2',
    department_id: 'd-snd',
    major: 20,
    minor: 0,
    label: 'Thunder',
    type: 'go',
    notes: '',
    colour: null,
    anchor: anchor(1),
  },
  {
    id: 'c3',
    department_id: 'd-lx',
    major: 30,
    minor: 0,
    label: 'Old version',
    type: 'go',
    notes: '',
    colour: null,
    anchor: anchor(0, 'v0'),
  },
]
const note = (id: string, kind: string, layerId: string, text: string) => ({
  id,
  layer_kind: kind,
  layer_id: layerId,
  anchor: anchor(0),
  type: 'note',
  geometry: '{"w":100,"h":40}',
  text,
  style: '{}',
})
const annotations = [
  note('a1', 'personal', ME, 'mine'),
  note('a2', 'personal', OTHER, 'theirs'),
  note('a3', 'department', 'd-lx', 'lx note'),
]

function fakeDb(): ExportDb {
  return {
    async getAll<T>(sql: string): Promise<T[]> {
      const rows = (() => {
        if (sql.includes('FROM shows')) return [{ title: 'Pirates: A/B' }]
        if (sql.includes('FROM documents')) return [{ title: 'Libretto' }]
        if (sql.includes('FROM document_versions'))
          return [{ version_number: 2, searchable_key: 'shows/show-1/v1/searchable.pdf' }]
        if (sql.includes('FROM departments')) return departments
        if (sql.includes('FROM cues')) return cues
        if (sql.includes('FROM annotations')) return annotations
        if (sql.includes('FROM pages')) return [{ index: 0, words_key: null }]
        throw new Error(`unexpected query ${sql}`)
      })()
      return rows as T[]
    },
  }
}

async function sourcePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  doc.addPage([612, 792])
  return doc.save()
}

async function run(layers: LayerRef[]) {
  const source = await sourcePdf()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(source as BlobPart, { status: 200 })),
  )
  const downloads: Array<{ filename: string; bytes: Uint8Array }> = []
  const queued: PendingExport[] = []
  const result = await runPrintExport(
    fakeDb(),
    ctx,
    { documentId: 'doc-1', versionId: 'v1', layers },
    {
      download: (filename, bytes) => downloads.push({ filename, bytes }),
      enqueue: async (p) => void queued.push(p),
      now: () => new Date(2026, 9, 15, 14, 2),
    },
  )
  const items = (stamp.calls[0]?.[1] ?? []) as core.StampItem[]
  const footer = stamp.calls[0]?.[2] as core.FooterInfo
  return { result, downloads, queued, items, footer, source }
}

const dept = (id: string): LayerRef => ({ kind: 'department', id })
const personal: LayerRef = { kind: 'personal', id: ME }

test('stamps the chosen layers for this version, downloads the file, and queues it for upload', async () => {
  const { result, downloads, queued, items, footer } = await run([dept('d-lx'), personal])
  const kinds = items.map((i) => (i.kind === 'cue' ? `cue:${i.labelText}` : `note:${i.text}`))
  // Only LX and the user's own personal layer, only on this version; never the other's note.
  expect(kinds.sort()).toEqual(['cue:Sunrise', 'note:lx note', 'note:mine'])
  expect(footer).toMatchObject({
    showTitle: 'Pirates: A/B',
    documentLabel: 'Libretto v2',
    layerLabel: 'LX + personal',
    binderVersion: null,
    exportId: result.id,
  })

  const out = await PDFDocument.load(result.bytes)
  expect(out.getPageCount()).toBe(2)
  expect(result.filename).toBe('Pirates- A-B - Libretto v2 - LX + personal.pdf')
  expect(downloads).toEqual([{ filename: result.filename, bytes: result.bytes }])
  expect(queued).toHaveLength(1)
  expect(queued[0]).toMatchObject({
    id: result.id,
    showId: 'show-1',
    userId: ME,
    contentType: 'application/pdf',
    meta: {
      id: result.id,
      kind: 'pdf-script',
      filename: result.filename,
      layerSelection: [dept('d-lx'), personal],
      createdAt: new Date(2026, 9, 15, 14, 2).toISOString(),
    },
  })
  expect(queued[0].bytes).toBe(result.bytes)
})

test('a clean copy stamps nothing but the footer', async () => {
  const { items, footer, queued, result } = await run([])
  expect(items).toEqual([])
  expect(footer.layerLabel).toBe('Clean copy')
  expect(queued[0].meta.layerSelection).toEqual([])
  expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(2)
})

test("refuses another person's personal layer and departments that are not in the show", async () => {
  const bad = [
    [{ kind: 'personal', id: OTHER }],
    [{ kind: 'department', id: 'd-elsewhere' }],
  ] as LayerRef[][]
  for (const layers of bad) {
    const download = vi.fn()
    await expect(
      runPrintExport(fakeDb(), ctx, { documentId: 'doc-1', versionId: 'v1', layers }, { download }),
    ).rejects.toThrow()
    expect(download).not.toHaveBeenCalled()
  }
})

test('says so when the script PDF is neither cached nor reachable', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }),
  )
  const download = vi.fn()
  await expect(
    runPrintExport(
      fakeDb(),
      ctx,
      { documentId: 'doc-1', versionId: 'v1', layers: [] },
      { download },
    ),
  ).rejects.toThrow(/not on this device/)
  expect(download).not.toHaveBeenCalled()
})

test('a failed queue write does not lose the download, and tells the user', async () => {
  const { getNotices } = await import('../components/noticeStore')
  const source = await sourcePdf()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(source as BlobPart, { status: 200 })),
  )
  const download = vi.fn()
  await runPrintExport(
    fakeDb(),
    ctx,
    { documentId: 'doc-1', versionId: 'v1', layers: [] },
    {
      download,
      enqueue: async () => {
        throw new Error('storage is full')
      },
    },
  )
  expect(download).toHaveBeenCalledOnce()
  expect(getNotices()[0]?.message).toContain('storage is full')
})

test('file names drop characters no platform allows and stay short', () => {
  expect(exportFilename(['A/B', 'C:D', 'E*F?'])).toBe('A-B - C-D - E-F-.pdf')
  expect(exportFilename(['x'.repeat(400)]).length).toBe(200)
})
