import type * as core from '@binder/core'
import type { LayerRef, PrintOptions } from '@binder/shared'
import { PDFDocument } from 'pdf-lib'
import { beforeEach, expect, test, vi } from 'vitest'
import { activateLocalUser, guardLocalDatabase } from '../auth/localWork'
import { clearNotices } from '../components/noticeStore'
import type { EditContext } from '../markup/mutations'
import type { PendingExport } from './outbox'
import { type ExportDb, exportFilename, type PrintInput, runPrintExport } from './runPrintExport'

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
  localStorage.setItem('binder.localDbOwner', 'user-me')
  localStorage.setItem('binder.localDbDevice', 'export-test-ticket')
  activateLocalUser('user-me')
  stamp.calls = []
})

const ME = 'user-me'
const OTHER = 'user-other'
const ctx: EditContext = {
  showId: 'show-1',
  userId: ME,
  scope: { role: 'editor', departments: [] },
}

const anchor = (pageIndex: number, versionId = 'v1', text?: object) =>
  JSON.stringify({
    documentId: 'doc-1',
    documentVersionId: versionId,
    pageIndex,
    x: 100,
    y: 200,
    ...(text ? { text } : {}),
    status: 'ok',
  })

/** Page 0's words: the first LX cue goes on the second one. */
const pageWords = {
  words: [
    { t: 'one', x: 100, y: 195, w: 30, h: 10 },
    { t: 'two', x: 134, y: 195, w: 30, h: 10 },
  ],
  lines: [[0, 1]],
}

const departments = [
  { id: 'd-lx', code: 'LX', colour: '#F5A623', number_format: 'decimal', sort_order: 0, hidden: 0 },
  {
    id: 'd-snd',
    code: 'SND',
    colour: '#2E90FA',
    number_format: 'decimal',
    sort_order: 10,
    hidden: 0,
  },
  {
    id: 'd-old',
    code: 'OLD',
    colour: '#667085',
    number_format: 'point',
    sort_order: 20,
    hidden: 1,
  },
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
    anchor: anchor(0, 'v1', { quote: 'two', wordStart: 1, wordEnd: 1 }),
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

function fakeDb(cueRows: unknown[] = cues): ExportDb {
  return guardLocalDatabase(
    {
      async getAll<T>(sql: string): Promise<T[]> {
        const rows = (() => {
          if (sql.includes('FROM shows'))
            return [{ title: 'Pirates: A/B', settings: '{"markerSides":{"d-snd":"right"}}' }]
          if (sql.includes('FROM documents')) return [{ title: 'Libretto' }]
          if (sql.includes('FROM document_versions'))
            return [
              {
                version_number: 2,
                searchable_key: 'shows/show-1/v1/searchable.pdf',
                page_count: 2,
              },
            ]
          if (sql.includes('FROM departments')) return departments
          if (sql.includes('FROM cues')) return cueRows
          if (sql.includes('FROM annotations')) return annotations
          if (sql.includes('FROM pages'))
            return [
              { index: 0, words_key: 'w0' },
              { index: 1, words_key: 'w1' },
            ]
          throw new Error(`unexpected query ${sql}`)
        })()
        return rows as T[]
      },
    },
    'user-me',
  )
}

async function sourcePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  doc.addPage([612, 792])
  return doc.save()
}

async function run(
  layers: LayerRef[],
  extra: { options?: Partial<PrintOptions>; filename?: string; cueRows?: unknown[] } = {},
) {
  const source = await sourcePdf()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(source as BlobPart, { status: 200 })),
  )
  const downloads: Array<{ filename: string; bytes: Uint8Array }> = []
  const queued: PendingExport[] = []
  const wordKeys: string[] = []
  const input: PrintInput = { documentId: 'doc-1', versionId: 'v1', layers }
  if (extra.options) input.options = { ...DEFAULTS, ...extra.options }
  if (extra.filename !== undefined) input.filename = extra.filename
  const result = await runPrintExport(fakeDb(extra.cueRows), ctx, input, {
    download: (filename, bytes) => downloads.push({ filename, bytes }),
    enqueue: async (p) => void queued.push(p),
    now: () => new Date(2026, 9, 15, 14, 2),
    loadWords: async (key) => {
      wordKeys.push(key)
      return key === 'w0' ? pageWords : null
    },
  })
  const items = (stamp.calls.at(-1)?.[1] ?? []) as core.StampItem[]
  const footer = stamp.calls.at(-1)?.[2] as core.FooterInfo
  const stampOptions = stamp.calls.at(-1)?.[3] as core.StampOptions | undefined
  return { result, downloads, queued, items, footer, source, wordKeys, stampOptions }
}

const DEFAULTS: PrintOptions = {
  pages: 'all',
  includeStandbyWarn: true,
  includeAnnotations: true,
  includeCueNotes: true,
}

const dept = (id: string): LayerRef => ({ kind: 'department', id })
const personal: LayerRef = { kind: 'personal', id: ME }

test('stamps the chosen layers for this version, downloads the file, and queues it for upload', async () => {
  const { result, downloads, queued, items, footer } = await run([dept('d-lx'), personal])
  const kinds = items.map((i) =>
    i.kind === 'cue' ? `cue:${i.lead} ${i.number}` : `note:${i.text}`,
  )
  // Only LX and the user's own personal layer, only on this version; never the other's note.
  expect(kinds.sort()).toEqual(['cue:LX 10', 'note:lx note', 'note:mine'])
  expect(footer).toMatchObject({
    showTitle: 'Pirates: A/B',
    documentLabel: 'Libretto v2',
    layerLabel: 'LX + personal',
    binderVersion: null,
    exportId: result.id,
  })

  const out = await PDFDocument.load(result.bytes)
  expect(out.getPageCount()).toBe(2)
  expect(result.filename).toBe('pirates-a-b-libretto-v2-LX-personal.pdf')
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

test("a cue carries its department's side from the show's settings and its sort order", async () => {
  const { items } = await run([dept('d-lx'), dept('d-snd')])
  const cueItems = items.flatMap((i) => (i.kind === 'cue' ? [i] : []))
  expect(cueItems.map((c) => [c.lead, c.side, c.sortKey.department])).toEqual([
    ['LX', 'left', 0],
    ['SND', 'right', 10],
  ])
})

test('a bound cue carries the boxes of its trigger words, read from its page', async () => {
  const { items } = await run([dept('d-lx'), dept('d-snd')])
  const cueItems = items.flatMap((i) => (i.kind === 'cue' ? [i] : []))
  expect(cueItems[0]?.triggerBoxes).toEqual([{ x: 134, y: 195, w: 30, h: 10 }])
  // The SND cue is unbound: a tick, not a highlight.
  expect(cueItems[1]?.triggerBoxes).toEqual([])
})

test('a clean copy stamps nothing but the footer', async () => {
  const { items, footer, queued, result } = await run([])
  expect(items).toEqual([])
  expect(footer.layerLabel).toBe('Clean copy')
  expect(queued[0].meta.layerSelection).toEqual([])
  expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(2)
})

test("refuses another person's personal layer, unknown departments, and hidden ones", async () => {
  // A good PDF is available, so only the layer check can stop each of these.
  const source = await sourcePdf()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(source as BlobPart, { status: 200 })),
  )
  const bad: Array<[LayerRef[], RegExp]> = [
    [[{ kind: 'personal', id: OTHER }], /own personal layer/],
    [[{ kind: 'department', id: 'd-elsewhere' }], /not part of this show/],
    // A hidden department is never printed, even if a caller names it.
    [[dept('d-lx'), dept('d-old')], /OLD layer is hidden/],
  ]
  for (const [layers, message] of bad) {
    const download = vi.fn()
    await expect(
      runPrintExport(fakeDb(), ctx, { documentId: 'doc-1', versionId: 'v1', layers }, { download }),
    ).rejects.toThrow(message)
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

const cueOf = (over: object) => ({
  id: 'cn',
  department_id: 'd-lx',
  major: 40,
  minor: 0,
  label: 'Extra',
  type: 'go',
  notes: '',
  colour: null,
  anchor: anchor(0),
  ...over,
})

test('omitted pages load no word layers', async () => {
  const all = await run([dept('d-lx'), dept('d-snd')])
  expect(all.wordKeys.sort()).toEqual(['w0', 'w1'])
  // Page 2 only: page 1's cue is not in the output, so its words are never read.
  const second = await run([dept('d-lx'), dept('d-snd')], { options: { pages: '2' } })
  expect(second.wordKeys).toEqual(['w1'])
  expect(second.stampOptions?.pages).toEqual([1])
  expect((await PDFDocument.load(second.result.bytes)).getPageCount()).toBe(1)
})

test('highlights load their words only when annotations are included', async () => {
  const highlight = {
    id: 'h1',
    layer_kind: 'department',
    layer_id: 'd-lx',
    anchor: anchor(1, 'v1', { quote: 'two', wordStart: 0, wordEnd: 0 }),
    type: 'highlight',
    geometry: '{}',
    text: '',
    style: '{}',
  }
  const withIt = async (options: Partial<PrintOptions>) => {
    annotations.push(highlight)
    try {
      return await run([dept('d-lx')], { options })
    } finally {
      annotations.pop()
    }
  }
  expect((await withIt({})).wordKeys).toContain('w1')
  expect((await withIt({ includeAnnotations: false })).wordKeys).not.toContain('w1')
})

test('the include flags reach buildStampItems: no standby tags, no annotations, no cue notes', async () => {
  const rows = [
    cueOf({ id: 'g', type: 'go', notes: 'hold for applause' }),
    cueOf({ id: 's', type: 'standby', major: 41 }),
  ]
  const full = await run([dept('d-lx'), personal], { cueRows: rows })
  expect(full.items.map((i) => i.kind).sort()).toEqual([
    'annotation',
    'annotation',
    'cue',
    'cue',
    'cue-note',
  ])
  const trimmed = await run([dept('d-lx'), personal], {
    cueRows: rows,
    options: { includeStandbyWarn: false, includeAnnotations: false, includeCueNotes: false },
  })
  expect(trimmed.items.map((i) => (i.kind === 'cue' ? `${i.type}` : i.kind))).toEqual(['go'])
})

test('pages and paper reach stampScript, as zero-based indices and the chosen paper', async () => {
  const { stampOptions } = await run([], { options: { pages: '1-2', paper: 'A4' } })
  expect(stampOptions).toEqual({ pages: [0, 1], paper: 'A4' })
  const plain = await run([])
  expect(plain.stampOptions?.pages).toBeUndefined()
  expect(plain.stampOptions?.paper).toBeUndefined()
})

test('the outbox meta carries the options and the typed file name, and the download uses that name', async () => {
  const { downloads, queued, result } = await run([dept('d-lx')], {
    options: { pages: '2', paper: 'Letter', includeStandbyWarn: false },
    filename: 'My cue copy',
  })
  expect(result.filename).toBe('My cue copy.pdf')
  expect(downloads[0]?.filename).toBe('My cue copy.pdf')
  expect(queued[0]?.meta.filename).toBe('My cue copy.pdf')
  expect(queued[0]?.meta.options).toEqual({
    pages: '2',
    paper: 'Letter',
    includeStandbyWarn: false,
    includeAnnotations: true,
    includeCueNotes: true,
  })
})

test('the range is stored normalised, and without options the meta says all pages', async () => {
  const typed = await run([], { options: { pages: ' 2 – 2 , 1 ' } })
  expect(typed.queued[0]?.meta.options?.pages).toBe('1-2')
  const plain = await run([])
  expect(plain.queued[0]?.meta.options).toEqual(DEFAULTS)
})

test('an unusable range or file name stops the export before anything is downloaded', async () => {
  const source = await sourcePdf()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(source as BlobPart, { status: 200 })),
  )
  const bad: Array<[Partial<PrintInput>, RegExp]> = [
    [{ options: { ...DEFAULTS, pages: '1-9' } }, /This script has 2 pages/],
    [{ options: { ...DEFAULTS, pages: 'a-b' } }, /Pages look like/],
    [{ filename: 'a/b' }, /can't contain/],
  ]
  for (const [extra, message] of bad) {
    const download = vi.fn()
    await expect(
      runPrintExport(
        fakeDb(),
        ctx,
        { documentId: 'doc-1', versionId: 'v1', layers: [], ...extra },
        { download },
      ),
    ).rejects.toThrow(message)
    expect(download).not.toHaveBeenCalled()
  }
})

test('file names drop characters no platform allows and stay short', () => {
  expect(exportFilename(['A/B', 'C:D', 'E*F?'])).toBe('A-B - C-D - E-F-.pdf')
  expect(exportFilename(['x'.repeat(400)]).length).toBe(200)
})

test('B13 sign-out waits for an export already generating before counting and warning', async () => {
  const { signOutAndClear } = await import('../auth/signOut')
  const source = await sourcePdf()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(source as BlobPart)),
  )
  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => {
      resolve = done
    })
    return { promise, resolve }
  }
  const wait = deferred<null>()
  const started = deferred<void>()
  const queued: PendingExport[] = []
  const generating = runPrintExport(
    fakeDb(),
    ctx,
    { documentId: 'doc-1', versionId: 'v1', layers: [{ kind: 'department', id: 'd-lx' }] },
    {
      download: vi.fn(),
      enqueue: async (p) => {
        queued.push(p)
      },
      loadWords: async () => {
        started.resolve()
        return wait.promise
      },
    },
  )
  await started.promise
  const signOut = vi.fn(async () => ({ error: null }))
  const clear = vi.fn(async () => {
    queued.length = 0
  })
  const confirm = vi.fn(() => false)
  const signingOut = signOutAndClear({
    signOut,
    pendingUploads: async () => 0,
    pendingExports: async () => queued.length,
    confirm,
    clearOutbox: clear,
    clearLocalData: clear,
    clearOfflinePrefs: clear,
    stopOfflineRunner: clear,
    stopExportRunner: clear,
    clearCache: vi.fn(),
    toLogin: clear,
  })
  await new Promise((r) => setTimeout(r, 20))
  const requestedWhileGenerating = signOut.mock.calls.length
  wait.resolve(null)
  await generating
  await signingOut
  expect(requestedWhileGenerating).toBe(0)
  expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/1 pending export/))
  expect(queued).toHaveLength(1)
  expect(clear).not.toHaveBeenCalled()
})
