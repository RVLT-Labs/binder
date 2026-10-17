import { execFile } from 'node:child_process'
import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { changeLog, documents, documentVersions, pages, syncAppliedChunks } from '@binder/db'
import { getTestDb } from '@binder/db/testing'
import { FIXTURES } from '@binder/fixtures'
import { type DocumentKind, newId, type OcrMode, type WordLayer } from '@binder/shared'
import { asc, eq, sql } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import { PgBoss } from 'pg-boss'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { searchableBlobKey } from '../src/blob/keys'
import { watchForCancel } from '../src/processing/cancel'
import { processDocumentVersion } from '../src/processing/documentJob'
import { KILL_GRACE_MS, runTool, ToolError } from '../src/processing/exec'
import { describeOcrFailure, OCRMYPDF_TIMEOUT_MS, runOcrmypdf } from '../src/processing/ocrmypdf'
import { processPage } from '../src/processing/pageJob'
import {
  contentSyntaxErrors,
  countTextChars,
  imageStats,
  POPPLER_TIMEOUT_MS,
  pdfInfo,
  popplerTimeout,
  renderPageImage,
  renderThumbnail,
} from '../src/processing/poppler'
import {
  classifyJobFailure,
  createJobQueue,
  DOCUMENT_DEAD_QUEUE,
  DOCUMENT_JOB_EXPIRE_SECONDS,
  DOCUMENT_QUEUE,
  ensureQueues,
  handleDocumentDeadLetter,
  handlePageDeadLetter,
  handleSyncChunkGc,
  PAGE_DEAD_QUEUE,
  PAGE_QUEUE,
  REANCHOR_DEAD_QUEUE,
  REANCHOR_QUEUE,
  SYNC_CHUNK_GC_CRON,
  SYNC_CHUNK_GC_QUEUE,
} from '../src/processing/queue'
import { reanchorVersion } from '../src/processing/reanchorJob'
import type { ProcessingDeps } from '../src/processing/types'
import { addDocumentVersion, createDocument } from '../src/services'
import { setupShow } from './documentHelpers'
import { RecordingJobs } from './helpers'
import { writeBlankScanPdf, writeTextPdf } from './scanHelpers'
import { findMissingTools, skipWithoutTools } from './tools'

const run = promisify(execFile)

// Lets a test give the document job's OCRmyPDF run a short timeout instead of its 30 minutes.
const ocrOverride = vi.hoisted(() => ({ timeoutMs: undefined as number | undefined }))
vi.mock('../src/processing/ocrmypdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/processing/ocrmypdf')>()
  return {
    ...actual,
    runOcrmypdf: (input: string, output: string, opts: Parameters<typeof actual.runOcrmypdf>[2]) =>
      actual.runOcrmypdf(input, output, { ...opts, timeoutMs: ocrOverride.timeoutMs }),
  }
})

const TOOLS: Array<[string, string[]]> = [
  ['ocrmypdf', ['--version']],
  ['pdfinfo', ['-v']],
  ['pdfimages', ['-v']],
  ['pdftoppm', ['-v']],
  ['pdftotext', ['-v']],
  ['qpdf', ['--version']],
]

const skip = skipWithoutTools('processing tests', findMissingTools(TOOLS))

type Setup = Awaited<ReturnType<typeof setupShow>>
let s: Setup
let work: string
const sharedTmp = process.env.TMPDIR

beforeAll(async () => {
  s = await setupShow()
  work = await mkdtemp(join(tmpdir(), 'binder-processing-test-'))
  // Jobs make their temp directories under os.tmpdir(); a private one keeps the leftover-directory
  // checks below from seeing other test files' processing running in parallel.
  process.env.TMPDIR = await mkdtemp(join(work, 'tmp-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  ocrOverride.timeoutMs = undefined
})
afterAll(async () => {
  if (sharedTmp === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = sharedTmp
  await rm(work, { recursive: true, force: true })
})

async function upload(
  pdf: string,
  ocrMode?: OcrMode,
  opts: { kind?: DocumentKind; snapToText?: boolean | null } = {},
) {
  return createDocument(s.deps.db, s.deps.blobs, s.jobs, s.ownerActor, {
    showId: s.show.id,
    kind: opts.kind ?? 'libretto',
    title: basename(pdf),
    ocrMode,
    snapToText: opts.snapToText,
    file: createReadStream(pdf),
  })
}

/** Marks a version cancelled the way the cancel service will: failed, code cancelled. */
async function cancelDirectly(versionId: string, deletePages = true) {
  await s.deps.db
    .update(documentVersions)
    .set({ status: 'failed', error: 'Cancelled', failureCode: 'cancelled' })
    .where(eq(documentVersions.id, versionId))
  if (deletePages) await s.deps.db.delete(pages).where(eq(pages.documentVersionId, versionId))
}

function processingDeps(): ProcessingDeps & { jobs: RecordingJobs } {
  return { db: s.deps.db, blobs: s.deps.blobs, jobs: new RecordingJobs() }
}

/** Runs `fn` over `items` with at most `limit` in flight, so page jobs overlap like real workers. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item)
    }),
  )
}

async function load(versionId: string) {
  const [version] = await s.deps.db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, versionId))
  const versionPages = await s.deps.db
    .select()
    .from(pages)
    .where(eq(pages.documentVersionId, versionId))
    .orderBy(asc(pages.index))
  if (!version) throw new Error(`version ${versionId} is gone`)
  return { version, pages: versionPages }
}

/** The document job, then every page job it queued, as the workers would. */
async function processAll(versionId: string) {
  const deps = processingDeps()
  await processDocumentVersion(deps, versionId)
  await mapLimit(deps.jobs.enqueuedPages, 8, (id) => processPage(deps, id))
  return { ...(await load(versionId)), enqueuedPages: deps.jobs.enqueuedPages }
}

async function blobBytes(key: string | null): Promise<Buffer> {
  if (!key) throw new Error('no blob key')
  const blob = await s.deps.blobs.get(key)
  if (!blob) throw new Error(`blob ${key} missing`)
  const chunks: Buffer[] = []
  for await (const chunk of blob.stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

async function wordLayer(page: { wordsKey: string | null }): Promise<WordLayer> {
  return JSON.parse((await blobBytes(page.wordsKey)).toString('utf8')) as WordLayer
}

const pngWidth = (png: Buffer) => png.readUInt32BE(16)
const pngHeight = (png: Buffer) => png.readUInt32BE(20)

/** Width and height from the first JPEG start-of-frame marker. */
function jpegSize(jpg: Buffer): { width: number; height: number } {
  let i = 2
  while (i < jpg.length) {
    const marker = jpg.readUInt16BE(i)
    if (marker >= 0xffc0 && marker <= 0xffc3) {
      return { height: jpg.readUInt16BE(i + 5), width: jpg.readUInt16BE(i + 7) }
    }
    i += 2 + jpg.readUInt16BE(i + 2)
  }
  throw new Error('no JPEG frame header')
}

const tokens = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  )

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter((t) => b.has(t)).length
  return inter / (a.size + b.size - inter)
}

/** Puts a stand-in `ocrmypdf` with this shell body first on PATH; returns its directory. */
async function standInOcrmypdf(body: string): Promise<string> {
  const bin = join(work, `stand-in-${Math.random().toString(36).slice(2)}`)
  await mkdir(bin, { recursive: true })
  await writeFile(join(bin, 'ocrmypdf'), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
  return bin
}

const SLEEPER = 'sleep 300 &\necho $! > "$PIDFILE"\nwait'

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function until(check: () => boolean, ms: number): Promise<boolean> {
  for (const start = Date.now(); Date.now() - start < ms; await sleep(25)) if (check()) return true
  return check()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The pid a stand-in wrote to `file`, once it has. */
async function pidFrom(file: string): Promise<number> {
  if (!(await until(() => existsSync(file) && (readFileSyncSafe(file) ?? '') !== '', 20_000)))
    throw new Error('the stand-in never started')
  return Number(readFileSyncSafe(file))
}
function readFileSyncSafe(file: string): string | null {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
}

/** Kills a process a test left behind, so a failing assertion cannot leak a sleeper. */
function reap(pid: number | undefined) {
  if (pid === undefined) return
  try {
    process.kill(pid, 'SIGKILL')
  } catch {}
}

const jobTempDirs = () =>
  readdirSync(tmpdir()).filter((d) => d.startsWith('binder-doc-') || d.startsWith('binder-page-'))

const showChangeCount = async () => {
  const [row] = await s.deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(changeLog)
    .where(eq(changeLog.showId, s.show.id))
  return row?.n ?? 0
}

/** A three-page, text-only PDF (mixed.pdf pages 1 to 3): no images, so no OCR and quick to process. */
async function textOnlyPdf(): Promise<string> {
  const out = join(work, `text-only-${Math.random().toString(36).slice(2)}.pdf`)
  await run('qpdf', [FIXTURES.mixedPdf, '--pages', FIXTURES.mixedPdf, '1-3', '--', out])
  return out
}

describe.skipIf(skip)('processing pipeline', () => {
  test('text libretto: version ready, pages match pdfinfo, no OCR, page 1 words include PIRATES', async () => {
    const { document, version } = await upload(FIXTURES.librettoPdf)
    const changesBefore = await showChangeCount()
    const tempBefore = jobTempDirs()

    const deps = processingDeps()
    await processDocumentVersion(deps, version.id)
    const queued = await load(version.id)
    expect(queued.version.status).toBe('processing')
    expect(queued.pages.every((p) => p.status === 'queued')).toBe(true)
    expect(deps.jobs.enqueuedPages).toEqual(queued.pages.map((p) => p.id))

    await mapLimit(deps.jobs.enqueuedPages, 8, (id) => processPage(deps, id))
    const done = await load(version.id)

    const { stdout } = await run('pdfinfo', [FIXTURES.librettoPdf])
    const expectedPages = Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1])
    expect(expectedPages).toBeGreaterThan(100)
    expect(done.version).toMatchObject({
      status: 'ready',
      pageCount: expectedPages,
      error: null,
      updatedBy: 'system',
      searchableKey: `shows/${s.show.id}/documents/${document.id}/versions/${version.id}/searchable.pdf`,
    })
    expect(done.pages).toHaveLength(expectedPages)
    done.pages.forEach((p, i) => {
      expect(p).toMatchObject({ index: i, status: 'ready', ocrApplied: false, rotation: 0 })
      expect(p.width).toBeCloseTo(595.28, 1)
      expect(p.height).toBeCloseTo(841.89, 1)
    })

    // No images in a born-digital PDF: the searchable PDF is a byte-for-byte copy (spec 5.1).
    expect(
      (await blobBytes(done.version.searchableKey)).equals(await readFile(FIXTURES.librettoPdf)),
    ).toBe(true)

    const [first] = done.pages
    if (!first) throw new Error('no pages')
    const prefix = `shows/${s.show.id}/documents/${document.id}/versions/${version.id}/pages/0`
    expect(first.thumbKey).toBe(`${prefix}/thumb.png`)
    expect(first.wordsKey).toBe(`${prefix}/words.json`)
    expect(pngWidth(await blobBytes(first.thumbKey))).toBe(160)

    const layer = await wordLayer(first)
    const pirates = layer.words.find((w) => w.t === 'PIRATES')
    expect(pirates).toBeDefined()
    // The title is the first line of the page: near the top in bottom-left-origin space.
    expect(pirates?.y).toBeGreaterThan(0.8 * (first.height ?? 0))
    expect(pirates?.x).toBeGreaterThan(0)
    expect(layer.lines[0]?.map((i) => layer.words[i]?.t)).toEqual([
      'THE',
      'PIRATES',
      'OF',
      'PENZANCE',
    ])

    const [doc] = await s.deps.db.select().from(documents).where(eq(documents.id, document.id))
    expect(doc?.currentVersionId).toBe(version.id)
    // Processing writes as the system and leaves no change-log rows (R43).
    expect(await showChangeCount()).toBe(changesBefore)
    expect(jobTempDirs()).toEqual(tempBefore)
  }, 120_000)

  test('synthetic scan: OCR applied, page 1 token overlap with the source text is at least 0.85', async () => {
    const { version } = await upload(FIXTURES.scanPdf)
    const done = await processAll(version.id)

    expect(done.version).toMatchObject({ status: 'ready', pageCount: 8, error: null })
    expect(done.pages.map((p) => [p.status, p.ocrApplied])).toEqual(
      Array.from({ length: 8 }, () => ['ready', true]),
    )
    const searchable = await blobBytes(done.version.searchableKey)
    expect(searchable.equals(await readFile(FIXTURES.scanPdf))).toBe(false)

    const [first] = done.pages
    if (!first) throw new Error('no pages')
    const layer = await wordLayer(first)
    const source = (await readFile(FIXTURES.librettoText, 'utf8'))
      .split('\n')
      .slice(0, 48)
      .join('\n')
    const overlap = jaccard(tokens(layer.words.map((w) => w.t).join(' ')), tokens(source))
    expect(overlap).toBeGreaterThanOrEqual(0.85)

    // OCR boxes land where the scan shows the words: the title sits at the top of the page.
    const pirates = layer.words.find((w) => w.t === 'PIRATES')
    expect(pirates?.y).toBeGreaterThan(0.8 * (first.height ?? 0))
  }, 300_000)

  test('mixed pdf: page 2 is landscape and ROTATED sits top-left in displayed space; page 4 is OCRd', async () => {
    const { version } = await upload(FIXTURES.mixedPdf)
    const done = await processAll(version.id)
    expect(done.version).toMatchObject({ status: 'ready', pageCount: 4 })
    // OCRmyPDF before 17 damages the rotated page, and the version says it fell back to --skip-text.
    expect(done.version.error ?? '').toMatch(/^$|--skip-text/)
    const [p1, p2, p3, p4] = done.pages
    if (!p1 || !p2 || !p3 || !p4) throw new Error('expected four pages')

    expect(p2.rotation).toBe(90)
    expect(p2.width).toBeCloseTo(841.89, 1)
    expect(p2.height).toBeCloseTo(595.28, 1)
    const rotated = (await wordLayer(p2)).words.find((w) => w.t === 'ROTATED')
    expect(rotated).toBeDefined()
    expect(rotated?.y).toBeGreaterThan(0.8 * (p2.height ?? 0))
    expect(rotated?.x).toBeLessThan(0.25 * (p2.width ?? 0))
    expect(pngWidth(await blobBytes(p2.thumbKey))).toBe(160)

    expect(p3.width).toBeCloseTo(612, 0)
    expect(p3.height).toBeCloseTo(792, 0)
    expect((await wordLayer(p3)).words.map((w) => w.t)).toEqual(['PAGE', 'THREE', 'LETTER'])

    // Only the page with an image was OCRd; the vector text pages keep their text untouched.
    expect(done.pages.map((p) => p.ocrApplied)).toEqual([false, false, false, true])
    expect((await wordLayer(p1)).words.map((w) => w.t)).toEqual(['PAGE', 'ONE', 'PORTRAIT'])
    expect((await wordLayer(p4)).words.map((w) => w.t)).toContain('PIRATES')
  }, 300_000)

  test('owner-restricted pdf: OCRmyPDF refusing it (exit 8) falls back to a copy and pages still process', async () => {
    // Opens without a password but carries owner restrictions. OCRmyPDF 17.13 actually OCRs these
    // (next test) and older releases refuse them with exit 8, so a stand-in ocrmypdf on PATH plays
    // one that keeps refusing, even the decrypted retry, to reach the plain-copy fallback.
    const ownerOnly = join(work, 'owner-only.pdf')
    await run('qpdf', ['--encrypt', '', 'owner', '256', '--', FIXTURES.mixedPdf, ownerOnly])
    const bin = join(work, 'refusing-ocrmypdf')
    await mkdir(bin, { recursive: true })
    await writeFile(
      join(bin, 'ocrmypdf'),
      '#!/bin/sh\necho "EncryptedPdfError: Input PDF is encrypted. The encryption must be removed to" >&2\nexit 8\n',
      { mode: 0o755 },
    )
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { version } = await upload(ownerOnly)
    const done = await processAll(version.id)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/OCR fell back to a copy/))
    expect(done.version.status).toBe('ready')
    expect(done.version.error).toMatch(/^ocrmypdf exit 8: EncryptedPdfError/)
    expect(done.pages.map((p) => [p.status, p.ocrApplied])).toEqual(
      Array.from({ length: 4 }, () => ['ready', false]),
    )
    // The copy is the unrestricted one; the upload itself is untouched.
    const searchable = join(work, 'owner-only-searchable.pdf')
    await writeFile(searchable, await blobBytes(done.version.searchableKey))
    await expect(run('qpdf', ['--is-encrypted', searchable])).rejects.toMatchObject({ code: 2 })
    expect(await countTextChars(searchable)).toBeGreaterThan(0)
    expect((await wordLayer(done.pages[0] as { wordsKey: string })).words.map((w) => w.t)).toEqual([
      'PAGE',
      'ONE',
      'PORTRAIT',
    ])
  }, 120_000)

  test('restricted vector-text pdf: the searchable copy is unrestricted, so pdf-lib (the export) can load it', async () => {
    // Real restrictions with an empty user password: it opens, but copying, editing and printing are
    // off. A script with no images never reaches OCRmyPDF (spec 5.1), so this is the plain-copy path.
    const restricted = join(work, 'restricted-script.pdf')
    await run('qpdf', [
      ...['--encrypt', '', 'owner', '256', '--extract=n', '--modify=none', '--print=none'],
      ...['--', FIXTURES.librettoShortPdf, restricted],
    ])
    await expect(PDFDocument.load(await readFile(restricted))).rejects.toThrow(/encrypted/)

    const { version } = await upload(restricted)
    const done = await processAll(version.id)
    expect(done.version).toMatchObject({ status: 'ready', pageCount: 3, error: null })
    expect(done.pages.map((p) => p.ocrApplied)).toEqual([false, false, false])
    const searchable = join(work, 'restricted-script-searchable.pdf')
    const bytes = await blobBytes(done.version.searchableKey)
    await writeFile(searchable, bytes)
    await expect(run('qpdf', ['--is-encrypted', searchable])).rejects.toMatchObject({ code: 2 })
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3)
    // The original upload is kept exactly as it was.
    expect(await blobBytes(version.originalKey)).toEqual(await readFile(restricted))
  }, 120_000)

  test('owner-restricted pdf with the installed OCRmyPDF: processed and OCRd like any other', async () => {
    const ownerOnly = join(work, 'owner-only-real.pdf')
    await run('qpdf', ['--encrypt', '', 'owner', '256', '--', FIXTURES.mixedPdf, ownerOnly])
    const { version } = await upload(ownerOnly)
    const done = await processAll(version.id)
    expect(done.version).toMatchObject({ status: 'ready', pageCount: 4 })
    expect(done.version.error ?? '').toMatch(/^$|--skip-text/) // see the mixed pdf test
    expect(done.pages.map((p) => [p.status, p.ocrApplied])).toEqual([
      ['ready', false],
      ['ready', false],
      ['ready', false],
      ['ready', true],
    ])
  }, 120_000)

  test('password-protected pdf: version failed with a password message and the technical detail', async () => {
    const encrypted = join(work, 'encrypted.pdf')
    await run('qpdf', ['--encrypt', 'user', 'owner', '256', '--', FIXTURES.librettoPdf, encrypted])
    const { document, version } = await upload(encrypted)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const done = await processAll(version.id)

    expect(done.version.status).toBe('failed')
    expect(done.version.error).toMatch(
      /^This PDF is password-protected\. Remove the password and upload it again\. \(.+\)$/,
    )
    expect(done.version.error).toMatch(/ocrmypdf exit 8: EncryptedPdfError/)
    expect(done.version.error).toMatch(/pdfinfo exit 1: .*Incorrect password/)
    expect(done.version).toMatchObject({ failureCode: 'password_protected', failureDpi: null })
    expect(done.pages).toHaveLength(0)
    expect(done.enqueuedPages).toHaveLength(0)
    // The failed upload stays where it was: the document keeps its version, nothing new is current.
    const [doc] = await s.deps.db.select().from(documents).where(eq(documents.id, document.id))
    expect(doc?.currentVersionId).toBe(version.id)
  }, 120_000)

  test('a file that is not a readable PDF: version failed with a plain message', async () => {
    const corrupt = join(work, 'corrupt.pdf')
    await writeFile(corrupt, '%PDF-1.7\nthis is not a pdf\n')
    const { version } = await upload(corrupt)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const done = await processAll(version.id)
    expect(done.version.status).toBe('failed')
    expect(done.version.error).toMatch(
      /^This file could not be read as a PDF\. \(.*pdfinfo exit 1: /,
    )
    expect(done.version.failureCode).toBe('unreadable')
    expect(done.pages).toHaveLength(0)
  }, 120_000)

  test.each([
    ['no page count', 'Encrypted:       no\n', /pdfinfo gave no page count/],
    ['no page size', 'Pages:           3\n', /pdfinfo gave no size for page 1/],
  ])(
    'pdfinfo output with %s: version failed at once as unreadable',
    async (_, output, detail) => {
      const bin = join(work, `odd-pdfinfo-${Math.random().toString(36).slice(2)}`)
      await mkdir(bin, { recursive: true })
      await writeFile(join(bin, 'pdfinfo'), `#!/bin/sh\nprintf '${output}'\nexit 0\n`, {
        mode: 0o755,
      })
      vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)

      const { version } = await upload(await textOnlyPdf())
      const done = await processAll(version.id)
      expect(done.version.status).toBe('failed')
      expect(done.version.error).toMatch(/^This file could not be read as a PDF\. \(/)
      expect(done.version.error).toMatch(detail)
      expect(done.pages).toHaveLength(0)
      expect(done.enqueuedPages).toHaveLength(0)
    },
    60_000,
  )

  test("ocr mode 'never' copies even a scan and leaves its word layers empty", async () => {
    const { version } = await upload(FIXTURES.scanPdf, 'never')
    const done = await processAll(version.id)
    expect(done.version).toMatchObject({ status: 'ready', pageCount: 8, error: null })
    expect(done.pages.every((p) => p.status === 'ready' && !p.ocrApplied)).toBe(true)
    expect(
      (await blobBytes(done.version.searchableKey)).equals(await readFile(FIXTURES.scanPdf)),
    ).toBe(true)
    const [first] = done.pages
    if (!first) throw new Error('no pages')
    expect(await wordLayer(first)).toEqual({ words: [], lines: [] })
  }, 120_000)

  test('a retried document job replaces its page rows and duplicate page jobs are harmless', async () => {
    const { version } = await upload(await textOnlyPdf())
    const deps = processingDeps()
    await processDocumentVersion(deps, version.id)
    const firstRun = [...deps.jobs.enqueuedPages]
    expect(firstRun).toHaveLength(3)
    await processPage(deps, firstRun[0] as string)

    // The retry: same version, still processing.
    await processDocumentVersion(deps, version.id)
    const retried = await load(version.id)
    expect(retried.version.status).toBe('processing')
    expect(retried.pages.map((p) => p.id)).toEqual(firstRun)
    expect(retried.pages.every((p) => p.status === 'queued')).toBe(true)

    // Both runs' page jobs, interleaved and concurrent.
    await mapLimit(deps.jobs.enqueuedPages, 4, (id) => processPage(deps, id))
    await processPage(deps, firstRun[1] as string)
    const done = await load(version.id)
    expect(done.version).toMatchObject({ status: 'ready', pageCount: 3 })
    expect(done.pages).toHaveLength(3)
    expect(done.pages.every((p) => p.status === 'ready')).toBe(true)
  }, 120_000)

  test('a failed page records its error and the version still becomes ready', async () => {
    const { version } = await upload(await textOnlyPdf())
    const deps = processingDeps()
    await processDocumentVersion(deps, version.id)
    const { version: processing } = await load(version.id)
    await s.deps.blobs.delete(processing.searchableKey as string)

    await mapLimit(deps.jobs.enqueuedPages, 3, (id) => processPage(deps, id))
    const done = await load(version.id)
    expect(done.version.status).toBe('ready')
    expect(done.pages.map((p) => p.status)).toEqual(['failed', 'failed', 'failed'])
    expect(done.pages[0]?.error).toMatch(/searchable\.pdf/)
  }, 120_000)

  test('a later version becomes ready but stays behind until it is re-anchored', async () => {
    const pdf = await textOnlyPdf()
    const { document, version: v1 } = await upload(pdf)
    await processAll(v1.id)
    const v2 = await addDocumentVersion(s.deps.db, s.deps.blobs, s.jobs, s.ownerActor, {
      documentId: document.id,
      label: 'second',
      file: createReadStream(pdf),
    })
    const current = async () =>
      (await s.deps.db.select().from(documents).where(eq(documents.id, document.id)))[0]
        ?.currentVersionId

    expect(await current()).toBe(v1.id)
    const deps = processingDeps()
    await processDocumentVersion(deps, v2.id)
    expect(await current()).toBe(v1.id)
    await mapLimit(deps.jobs.enqueuedPages, 3, (id) => processPage(deps, id))
    // ready, but the document keeps its current version until the re-anchoring job has run
    expect((await load(v2.id)).version.status).toBe('ready')
    expect(await current()).toBe(v1.id)
    expect(deps.jobs.enqueuedReanchors).toEqual([v2.id])
    expect(await reanchorVersion(deps, v2.id)).toMatchObject({ moved: 0 })
    expect(await current()).toBe(v2.id)
    expect((await load(v2.id)).version.updatedBy).toBe('system')
  }, 120_000)

  test('a first version becomes current without any re-anchoring', async () => {
    const { document, version } = await upload(await textOnlyPdf())
    const done = await processAll(version.id)
    expect(done.version.status).toBe('ready')
    const [doc] = await s.deps.db.select().from(documents).where(eq(documents.id, document.id))
    expect(doc?.currentVersionId).toBe(version.id)
  }, 120_000)

  test('an earlier version finishing late does not take over from a later ready one', async () => {
    const pdf = await textOnlyPdf()
    const { document, version: v1 } = await upload(pdf)
    const v1Deps = processingDeps()
    await processDocumentVersion(v1Deps, v1.id)
    const v2 = await addDocumentVersion(s.deps.db, s.deps.blobs, s.jobs, s.ownerActor, {
      documentId: document.id,
      label: 'quick replacement',
      file: createReadStream(pdf),
    })
    const v2Done = await processAll(v2.id)
    expect(v2Done.version.status).toBe('ready')
    // v2 is re-anchored while v1 is still finishing; v1 finishing afterwards must not take over
    await reanchorVersion(processingDeps(), v2.id)
    await mapLimit(v1Deps.jobs.enqueuedPages, 3, (id) => processPage(v1Deps, id))

    expect((await load(v1.id)).version.status).toBe('ready')
    const [doc] = await s.deps.db.select().from(documents).where(eq(documents.id, document.id))
    expect(doc?.currentVersionId).toBe(v2.id)
    expect(v1Deps.jobs.enqueuedReanchors).toEqual([])
  }, 120_000)
})

describe.skipIf(skip)('dead letters', () => {
  test('a dead-lettered page job fails the page and the version still becomes ready', async () => {
    const { version } = await upload(await textOnlyPdf())
    const deps = processingDeps()
    await processDocumentVersion(deps, version.id)
    const [p0, p1, p2] = deps.jobs.enqueuedPages as [string, string, string]
    await processPage(deps, p0)
    await processPage(deps, p1)

    await handlePageDeadLetter(deps, {
      data: { pageId: p2 },
      sourceOutput: { value: { message: 'job timed out' } },
    })
    const done = await load(version.id)
    expect(done.pages.map((p) => p.status)).toEqual(['ready', 'ready', 'failed'])
    expect(done.pages[2]?.error).toBe('Page processing timed out after retries.')
    expect(done.version).toMatchObject({ status: 'ready', pageCount: 3 })

    // A late dead letter for a page that finished is ignored.
    await handlePageDeadLetter(deps, { data: { pageId: p0 }, sourceOutput: { message: 'x' } })
    expect((await load(version.id)).pages[0]?.status).toBe('ready')
  }, 60_000)

  test('a dead-lettered document job fails the version with the last error', async () => {
    const { version } = await upload(await textOnlyPdf())
    const deps = processingDeps()
    await handleDocumentDeadLetter(deps, {
      data: { versionId: version.id },
      sourceOutput: { name: 'ToolError', message: 'ocrmypdf timed out after 1800s: killed' },
    })
    const failed = await load(version.id)
    expect(failed.version).toMatchObject({
      status: 'failed',
      error: 'Processing failed after retries: ocrmypdf timed out after 1800s: killed',
      failureCode: 'timeout',
      updatedBy: 'system',
    })

    const timedOut = await upload(await textOnlyPdf())
    await handleDocumentDeadLetter(deps, {
      data: { versionId: timedOut.version.id },
      sourceOutput: { value: { message: 'job timed out' } },
    })
    expect((await load(timedOut.version.id)).version).toMatchObject({
      error: 'Processing timed out after retries.',
      failureCode: 'timeout',
    })

    // Any other dead letter is `unknown`; the message stays as the technical detail.
    const other = await upload(await textOnlyPdf())
    await handleDocumentDeadLetter(deps, {
      data: { versionId: other.version.id },
      sourceOutput: { message: 'blob original.pdf is missing' },
    })
    expect((await load(other.version.id)).version).toMatchObject({
      error: 'Processing failed after retries: blob original.pdf is missing',
      failureCode: 'unknown',
    })

    // A version that reached ready is never failed by a late dead letter.
    const ready = await upload(await textOnlyPdf())
    await processAll(ready.version.id)
    await handleDocumentDeadLetter(deps, {
      data: { versionId: ready.version.id },
      sourceOutput: null,
    })
    expect((await load(ready.version.id)).version).toMatchObject({ status: 'ready', error: null })
  }, 60_000)
})

describe.skipIf(skip)('processing detection and guards', () => {
  test('imageStats reads the scan resolution and countTextChars the text layer', async () => {
    const stats = await imageStats(FIXTURES.scanPdf)
    expect(stats.pages.size).toBe(8)
    expect(stats.medianPpi).toBe(150)
    const blank = join(work, 'stats-72.pdf')
    writeBlankScanPdf(blank, 72)
    expect((await imageStats(blank)).medianPpi).toBe(72)
    expect(await imageStats(await textOnlyPdf())).toEqual({ pages: new Set(), medianPpi: null })

    expect(await countTextChars(FIXTURES.librettoPdf)).toBeGreaterThan(1000)
    expect(await countTextChars(blank)).toBe(0)
  }, 60_000)

  test('a text-anchored scan with no text and 72 dpi fails low_resolution with failure_dpi 72', async () => {
    const scan = join(work, 'blank-72.pdf')
    writeBlankScanPdf(scan, 72)
    const { version } = await upload(scan)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const done = await processAll(version.id)
    expect(done.version).toMatchObject({
      status: 'failed',
      failureCode: 'low_resolution',
      failureDpi: 72,
      searchableKey: null,
    })
    expect(done.version.error).toMatch(/^No text could be read/)
    expect(done.pages).toHaveLength(0)
    expect(done.enqueuedPages).toHaveLength(0)
  }, 120_000)

  test('no text at 300 dpi fails no_text', async () => {
    const scan = join(work, 'blank-300.pdf')
    writeBlankScanPdf(scan, 300)
    const { version } = await upload(scan)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const done = await processAll(version.id)
    expect(done.version).toMatchObject({
      status: 'failed',
      failureCode: 'no_text',
      failureDpi: null,
    })
  }, 120_000)

  test('a document with no images and no text fails no_text (an all-blank PDF)', async () => {
    const blank = join(work, 'blank-vector.pdf')
    // One page with no content; qpdf rebuilds the cross-reference table the hand-written file lacks.
    const raw = join(work, 'blank-vector-raw.pdf')
    await writeFile(
      raw,
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF\n',
    )
    // qpdf exits 3 for "succeeded with warnings".
    await run('qpdf', [raw, blank]).catch((err: { code?: number }) => {
      if (err.code !== 3) throw err
    })
    const { version } = await upload(blank)
    const done = await processAll(version.id)
    expect(done.version).toMatchObject({ status: 'failed', failureCode: 'no_text' })
  }, 60_000)

  test('a score with no text becomes ready', async () => {
    const scan = join(work, 'blank-score.pdf')
    writeBlankScanPdf(scan, 72)
    const { version } = await upload(scan, undefined, { kind: 'score' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const done = await processAll(version.id)
    expect(done.version).toMatchObject({ status: 'ready', failureCode: null })
    expect(done.pages).toHaveLength(1)
  }, 120_000)

  test('a score the user set to snap to text is checked like a script', async () => {
    const scan = join(work, 'blank-score-snap.pdf')
    writeBlankScanPdf(scan, 72)
    const { version } = await upload(scan, undefined, { kind: 'score', snapToText: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const done = await processAll(version.id)
    expect(done.version).toMatchObject({ status: 'failed', failureCode: 'low_resolution' })
  }, 120_000)

  test('a libretto the user set not to snap to text is not checked', async () => {
    const scan = join(work, 'blank-libretto-nosnap.pdf')
    writeBlankScanPdf(scan, 72)
    const { version } = await upload(scan, undefined, { snapToText: false })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await processAll(version.id)).version.status).toBe('ready')
  }, 120_000)

  test('ocrMode never is not checked', async () => {
    const scan = join(work, 'blank-never.pdf')
    writeBlankScanPdf(scan, 72)
    const { version } = await upload(scan, 'never')
    const done = await processAll(version.id)
    expect(done.version).toMatchObject({ status: 'ready', failureCode: null })
  }, 60_000)

  test('a cancelled version is not resurrected by the document job', async () => {
    const { version } = await upload(await textOnlyPdf())
    await cancelDirectly(version.id)
    const deps = processingDeps()
    await processDocumentVersion(deps, version.id)
    const after = await load(version.id)
    expect(after.version).toMatchObject({
      status: 'failed',
      failureCode: 'cancelled',
      error: 'Cancelled',
      searchableKey: null,
    })
    expect(after.pages).toHaveLength(0)
    expect(deps.jobs.enqueuedPages).toHaveLength(0)
  }, 60_000)

  test('a cancel that lands while the job works discards its work and its searchable blob', async () => {
    const { version } = await upload(await textOnlyPdf())
    const put = s.deps.blobs.put.bind(s.deps.blobs)
    // The cancel commits right after the job wrote the searchable PDF, before its final transaction.
    vi.spyOn(s.deps.blobs, 'put').mockImplementation(async (key, body, type) => {
      const result = await put(key, body, type)
      if (key === searchableBlobKey(version.showId, version.documentId, version.id))
        await cancelDirectly(version.id, false)
      return result
    })
    const deps = processingDeps()
    await processDocumentVersion(deps, version.id)
    vi.restoreAllMocks()
    const after = await load(version.id)
    expect(after.version).toMatchObject({
      status: 'failed',
      failureCode: 'cancelled',
      searchableKey: null,
    })
    expect(after.pages).toHaveLength(0)
    expect(deps.jobs.enqueuedPages).toHaveLength(0)
    const key = searchableBlobKey(version.showId, version.documentId, version.id)
    expect(await s.deps.blobs.exists(key)).toBe(false)
  }, 60_000)

  test('a cancelled version is not made ready by late page jobs', async () => {
    const { version } = await upload(await textOnlyPdf())
    const deps = processingDeps()
    await processDocumentVersion(deps, version.id)
    expect(deps.jobs.enqueuedPages.length).toBeGreaterThan(0)
    // Cancelled with its page rows still in place, the worst case for the page jobs.
    await cancelDirectly(version.id, false)

    await mapLimit(deps.jobs.enqueuedPages, 4, (id) => processPage(deps, id))
    const after = await load(version.id)
    expect(after.version).toMatchObject({ status: 'failed', failureCode: 'cancelled' })
    expect(after.pages.every((p) => p.status === 'queued' && p.thumbKey === null)).toBe(true)
  }, 60_000)
})

describe.skipIf(skip)('processing controls', () => {
  test('watchForCancel aborts when the status leaves processing, or the row is gone', async () => {
    const { version } = await upload(await textOnlyPdf())
    await s.deps.db
      .update(documentVersions)
      .set({ status: 'processing' })
      .where(eq(documentVersions.id, version.id))

    const watching = new AbortController()
    const stop = watchForCancel(s.deps.db, version.id, watching, 25)
    await sleep(120)
    expect(watching.signal.aborted).toBe(false)
    await cancelDirectly(version.id)
    expect(await until(() => watching.signal.aborted, 3000)).toBe(true)
    stop()

    const missing = new AbortController()
    const stopMissing = watchForCancel(s.deps.db, newId(), missing, 25)
    expect(await until(() => missing.signal.aborted, 3000)).toBe(true)
    stopMissing()

    // A stopped watch never aborts.
    const stopped = new AbortController()
    watchForCancel(s.deps.db, version.id, stopped, 25)()
    await sleep(120)
    expect(stopped.signal.aborted).toBe(false)
  }, 60_000)

  test('cancel during OCR kills ocrmypdf within about 3 s and writes nothing', async () => {
    const pidFile = join(work, `ocr-${Math.random().toString(36).slice(2)}.pid`)
    vi.stubEnv('PIDFILE', pidFile)
    await standInOcrmypdf(SLEEPER)
    const { version } = await upload(FIXTURES.scanPdf)
    const deps = processingDeps()
    const before = jobTempDirs().length
    let sleeper: number | undefined
    try {
      const job = processDocumentVersion(deps, version.id)
      sleeper = await pidFrom(pidFile)
      expect(isAlive(sleeper)).toBe(true)

      const cancelledAt = Date.now()
      await cancelDirectly(version.id)
      await job
      expect(Date.now() - cancelledAt).toBeLessThan(4000)
      expect(await until(() => !isAlive(sleeper as number), 2000)).toBe(true)
    } finally {
      reap(sleeper)
    }
    const after = await load(version.id)
    expect(after.version).toMatchObject({
      status: 'failed',
      failureCode: 'cancelled',
      searchableKey: null,
    })
    expect(after.pages).toHaveLength(0)
    expect(deps.jobs.enqueuedPages).toHaveLength(0)
    expect(
      await s.deps.blobs.exists(searchableBlobKey(version.showId, version.documentId, version.id)),
    ).toBe(false)
    expect(jobTempDirs()).toHaveLength(before)
  }, 60_000)

  test('OCR that did not run on a text-anchored scan with no text fails unknown, not no_text', async () => {
    await standInOcrmypdf('echo "boom" >&2\nexit 15')
    const scan = join(work, 'ocr-broken-blank.pdf')
    writeBlankScanPdf(scan, 72)
    const { version } = await upload(scan)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const done = await processAll(version.id)
    expect(done.version).toMatchObject({
      status: 'failed',
      failureCode: 'unknown',
      failureDpi: null,
      searchableKey: null,
    })
    expect(done.version.error).toMatch(/^OCR did not run, so no text could be read/)
    expect(done.version.error).toMatch(/ocrmypdf exit 15: boom/)
    expect(done.pages).toHaveLength(0)
  }, 120_000)

  test('OCR that timed out on a text-anchored scan with no text fails timeout', async () => {
    const pidFile = join(work, `ocr-timeout-${Math.random().toString(36).slice(2)}.pid`)
    vi.stubEnv('PIDFILE', pidFile)
    await standInOcrmypdf(SLEEPER)
    ocrOverride.timeoutMs = 600
    const scan = join(work, 'ocr-timeout-blank.pdf')
    writeBlankScanPdf(scan, 300)
    const { version } = await upload(scan)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const done = await processAll(version.id)
      expect(done.version).toMatchObject({ status: 'failed', failureCode: 'timeout' })
      expect(done.version.error).toMatch(/^OCR did not run/)
      expect(done.version.error).toMatch(/timed out after 0\.6s/)
    } finally {
      reap(readFileSyncSafe(pidFile) ? Number(readFileSyncSafe(pidFile)) : undefined)
    }
  }, 120_000)

  test.each(['queued', 'ready'] as const)(
    'the searchable blob survives when the final transaction finds the version %s',
    async (status) => {
      const { version } = await upload(await textOnlyPdf())
      const key = searchableBlobKey(version.showId, version.documentId, version.id)
      const put = s.deps.blobs.put.bind(s.deps.blobs)
      // A retry requeued the version (or finished it) right after this run wrote the searchable PDF.
      vi.spyOn(s.deps.blobs, 'put').mockImplementation(async (k, body, type) => {
        const result = await put(k, body, type)
        if (k === key)
          await s.deps.db
            .update(documentVersions)
            .set({ status })
            .where(eq(documentVersions.id, version.id))
        return result
      })
      const deps = processingDeps()
      await processDocumentVersion(deps, version.id)
      vi.restoreAllMocks()

      // The blob belongs to whoever owns the version now, so it stays; this run wrote nothing else.
      expect(await s.deps.blobs.exists(key)).toBe(true)
      const after = await load(version.id)
      expect(after.version.status).toBe(status)
      expect(after.version.searchableKey).toBeNull()
      expect(after.pages).toHaveLength(0)
      expect(deps.jobs.enqueuedPages).toHaveLength(0)
    },
    60_000,
  )
})

describe.skipIf(skip)('enqueue failure', () => {
  test('an enqueue failure gives enqueue_failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = {
      enqueueDocumentProcess: async () => {
        throw new Error('queue is down')
      },
      enqueuePageProcess: async () => {},
      enqueueReanchor: async () => {},
    }
    const { version } = await createDocument(s.deps.db, s.deps.blobs, failing, s.ownerActor, {
      showId: s.show.id,
      kind: 'libretto',
      title: 'queue down',
      file: createReadStream(FIXTURES.librettoPdf),
    })
    expect(version).toMatchObject({
      status: 'failed',
      error: 'Could not queue processing',
      failureCode: 'enqueue_failed',
    })
    expect((await load(version.id)).version.failureCode).toBe('enqueue_failed')
  })
})

describe('classifyJobFailure', () => {
  const SAMPLES: Array<[string, string]> = [
    [
      'This PDF is password-protected. Remove the password and upload it again. (pdfinfo exit 1)',
      'password_protected',
    ],
    ['This file could not be read as a PDF. (pdfinfo exit 1: Syntax Error)', 'unreadable'],
    ['This file could not be read as a PDF. (pdfinfo timed out after 120s)', 'unreadable'],
    ['Processing timed out after retries.', 'timeout'],
    ['Processing failed after retries: ocrmypdf timed out after 1800s: killed', 'timeout'],
    ['Page processing timed out after retries.', 'timeout'],
    ['Could not queue processing', 'enqueue_failed'],
    ['Could not queue processing again', 'unknown'],
    ['Processing failed after retries: blob original.pdf is missing', 'unknown'],
    ['Processing failed after retries.', 'unknown'],
    ['', 'unknown'],
  ]

  test.each(SAMPLES)('%s gives %s', (error, code) => {
    expect(classifyJobFailure(error)).toBe(code)
  })

  test('agrees with the 0016 migration backfill on the same strings', async () => {
    const { readFileSync } = await import('node:fs')
    const migration = readFileSync(
      join(__dirname, '../../../packages/db/drizzle/0016_version_processing_controls.sql'),
      'utf8',
    )
    const backfill = migration.slice(migration.indexOf('UPDATE "document_versions"'))
    const docs = await setupShow()
    const { document } = await createDocument(
      docs.deps.db,
      docs.deps.blobs,
      docs.jobs,
      docs.ownerActor,
      {
        showId: docs.show.id,
        kind: 'libretto',
        title: 'backfill',
        file: createReadStream(FIXTURES.librettoPdf),
      },
    )
    const [template] = await docs.deps.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, document.id))
    if (!template) throw new Error('no template version')
    const ids = SAMPLES.map(() => newId())
    await docs.deps.db.insert(documentVersions).values(
      SAMPLES.map(([error], i) => ({
        ...template,
        id: ids[i] as string,
        versionNumber: 100 + i,
        status: 'failed' as const,
        error,
        failureCode: null,
      })),
    )
    await docs.deps.db.execute(sql.raw(backfill))
    const rows = await docs.deps.db
      .select({ id: documentVersions.id, code: documentVersions.failureCode })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, document.id))
    for (const [i, [error]] of SAMPLES.entries()) {
      const code = rows.find((r) => r.id === ids[i])?.code
      expect(code, `backfill for ${JSON.stringify(error)}`).toBe(classifyJobFailure(error))
    }
  })
})

describe.skipIf(skip)('tool wrappers', () => {
  test('runOcrmypdf falls back to a copy on invalid input and reports the exit code', async () => {
    const input = join(work, 'not-really.pdf')
    const output = join(work, 'not-really-out.pdf')
    await writeFile(input, '%PDF-1.7\nthis is not a pdf\n')
    const result = await runOcrmypdf(input, output, { mode: 'auto' })
    expect(result).toMatchObject({ ocrApplied: false, exitCode: 2 })
    expect(await readFile(output, 'utf8')).toBe('%PDF-1.7\nthis is not a pdf\n')
    expect(describeOcrFailure(result)).toMatch(/^ocrmypdf exit 2: \S/)
  }, 60_000)

  // Stand-in ocrmypdf scripts take the real argument order: flags, then input, then output last.
  const ARGS = 'in=; out=; for a in "$@"; do in=$out; out=$a; done'

  /** A fresh empty directory, so a test can assert exactly what runOcrmypdf left in it. */
  async function emptyDir(name: string): Promise<string> {
    const dir = join(work, `${name}-${Math.random().toString(36).slice(2)}`)
    await mkdir(dir, { recursive: true })
    return dir
  }

  /** `from` with owner restrictions and an empty user password: it opens, but forbids everything. */
  async function restrict(name: string, from: string): Promise<string> {
    const out = join(work, name)
    await run('qpdf', [
      ...['--encrypt', '', 'owner', '256', '--extract=n', '--modify=none', '--print=none'],
      ...['--', from, out],
    ])
    return out
  }

  const isEncrypted = (pdf: string) =>
    run('qpdf', ['--is-encrypted', pdf]).then(
      () => true,
      () => false,
    )

  /** A one-page PDF saying `text`; `damaged` adds the exponent number OCRmyPDF 14 and 15 write. */
  async function textPdf(name: string, text: string, damaged = false): Promise<string> {
    const path = join(work, `${name}-${Math.random().toString(36).slice(2)}.pdf`)
    writeTextPdf(
      path,
      `BT /F1 24 Tf 1 0 0 1 60 40 Tm (${text}) Tj ET${damaged ? ' 6.12E-17 w' : ''}`,
    )
    return path
  }

  const sameBytes = async (a: string, b: string) => (await readFile(a)).equals(await readFile(b))

  test('runOcrmypdf retries an owner-restricted PDF on a decrypted copy when OCRmyPDF refuses it', async () => {
    // Releases before 17 refuse any encrypted input with exit 8 (Debian 12's 14.0, Ubuntu 24.04's 15.2).
    const ownerOnly = await restrict('owner-only-retry.pdf', FIXTURES.mixedPdf)
    const calls = join(work, 'owner-retry-calls.txt')
    vi.stubEnv('CALLS', calls)
    await standInOcrmypdf(
      `${ARGS}\necho "$in" >> "$CALLS"\n` +
        'if qpdf --is-encrypted "$in"; then echo "EncryptedPdfError: Input PDF is encrypted." >&2; exit 8; fi\n' +
        'cp "$in" "$out"',
    )
    const dir = await emptyDir('owner-retry')
    const output = join(dir, 'out.pdf')
    const result = await runOcrmypdf(ownerOnly, output, { mode: 'auto' })

    expect(result).toMatchObject({ ocrApplied: true, exitCode: 0 })
    const tried = (await readFile(calls, 'utf8')).trim().split('\n')
    expect(tried).toHaveLength(2)
    expect(tried[0]).toBe(ownerOnly)
    expect(tried[1]).not.toBe(ownerOnly)
    expect(await readdir(dir)).toEqual(['out.pdf'])
    expect(await isEncrypted(output)).toBe(false)
    expect(await countTextChars(output)).toBeGreaterThan(0)
  }, 60_000)

  test('runOcrmypdf keeps the refusal when the encrypted PDF cannot be decrypted without a password', async () => {
    const locked = join(work, 'locked-retry.pdf')
    await run('qpdf', ['--encrypt', 'user', 'owner', '256', '--', FIXTURES.mixedPdf, locked])
    await standInOcrmypdf('echo "EncryptedPdfError: Input PDF is encrypted." >&2\nexit 8')
    const output = join(work, 'locked-retry-out.pdf')
    const result = await runOcrmypdf(locked, output, { mode: 'auto' })
    expect(result).toMatchObject({ ocrApplied: false, exitCode: 8 })
    expect(describeOcrFailure(result)).toMatch(/^ocrmypdf exit 8: EncryptedPdfError/)
    // It needs a real password, so it stays as uploaded and the pipeline's pdfinfo rejects it.
    expect(await sameBytes(output, locked)).toBe(true)
  }, 60_000)

  test('a refused owner-restricted PDF falls back to its decrypted copy and leaves no scratch file', async () => {
    const ownerOnly = await restrict('owner-only-refused.pdf', FIXTURES.mixedPdf)
    await standInOcrmypdf('echo "EncryptedPdfError: Input PDF is encrypted." >&2\nexit 8')
    const dir = await emptyDir('owner-refused')
    const output = join(dir, 'out.pdf')
    const result = await runOcrmypdf(ownerOnly, output, { mode: 'auto' })
    expect(result).toMatchObject({ ocrApplied: false, exitCode: 8 })
    expect(await readdir(dir)).toEqual(['out.pdf'])
    expect(await isEncrypted(output)).toBe(false)
    expect(await countTextChars(output)).toBeGreaterThan(0)
  }, 60_000)

  test('ocr mode never still hands back an unrestricted copy of a restricted PDF', async () => {
    const ownerOnly = await restrict('owner-only-never.pdf', FIXTURES.librettoShortPdf)
    expect(await isEncrypted(ownerOnly)).toBe(true)
    const output = join(work, 'owner-only-never-out.pdf')
    expect(await runOcrmypdf(ownerOnly, output, { mode: 'never' })).toMatchObject({
      ocrApplied: false,
    })
    expect(await isEncrypted(output)).toBe(false)
    await expect(PDFDocument.load(await readFile(output))).resolves.toBeDefined()
    expect(await countTextChars(output)).toBeGreaterThan(0)
  }, 60_000)

  test('an encrypted PDF that cannot be decrypted is kept as it is, with a warning, and does not throw', async () => {
    const locked = join(work, 'locked-never.pdf')
    await run('qpdf', [
      '--encrypt',
      'user',
      'owner',
      '256',
      '--',
      FIXTURES.librettoShortPdf,
      locked,
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const output = join(work, 'locked-never-out.pdf')
    await runOcrmypdf(locked, output, { mode: 'never' })
    expect(await sameBytes(output, locked)).toBe(true)
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/stays encrypted and exports will refuse/),
    )
  }, 60_000)

  test('a poppler call is bounded by the remaining budget but never lifted above its own cap', () => {
    expect(popplerTimeout()).toBe(POPPLER_TIMEOUT_MS)
    expect(popplerTimeout(30 * 60 * 1000)).toBe(POPPLER_TIMEOUT_MS)
    expect(popplerTimeout(500)).toBe(500)
  })

  test('a cancel during the decrypt step aborts, writes nothing and leaves no scratch file', async () => {
    const ownerOnly = await restrict('owner-only-cancel.pdf', FIXTURES.mixedPdf)
    const bin = await standInOcrmypdf('echo "EncryptedPdfError" >&2\nexit 8')
    const started = join(work, `qpdf-started-${Math.random().toString(36).slice(2)}`)
    vi.stubEnv('STARTED', started)
    // A qpdf that hangs, ahead of the real one on PATH.
    await writeFile(join(bin, 'qpdf'), '#!/bin/sh\ntouch "$STARTED"\nsleep 300\n', { mode: 0o755 })
    const dir = await emptyDir('owner-cancel')
    const output = join(dir, 'out.pdf')
    const controller = new AbortController()
    const job = runOcrmypdf(ownerOnly, output, { mode: 'auto', signal: controller.signal })
    const settled = job.then(
      () => null,
      (e: unknown) => e,
    )
    expect(await until(() => existsSync(started), 20_000)).toBe(true)
    const cancelledAt = Date.now()
    controller.abort()
    expect(await settled).toMatchObject({ name: 'ToolError', aborted: true })
    expect(Date.now() - cancelledAt).toBeLessThan(4000)
    expect(await readdir(dir)).toEqual([])
  }, 60_000)

  describe('when --redo-ocr writes exponent numbers into the page text', () => {
    // Older OCRmyPDF (14.0, 15.2) re-serialises content streams with 6.1E-17 where the PDF said
    // 0.000000000000000061: poppler then reads "E-17" as an unknown operator and loses the text.

    /**
     * An ocrmypdf whose `--redo-ocr` run writes `redo` and whose other (`--skip-text`) run runs
     * `skipBody`, logging the flag of each run to the returned file.
     */
    async function standIn(redo: string, skipBody: string, extraEnv: Record<string, string> = {}) {
      const calls = join(work, `calls-${Math.random().toString(36).slice(2)}.txt`)
      vi.stubEnv('CALLS', calls)
      vi.stubEnv('REDO', redo)
      for (const [k, v] of Object.entries(extraEnv)) vi.stubEnv(k, v)
      await standInOcrmypdf(
        `${ARGS}\necho "$1" >> "$CALLS"\n` +
          `if [ "$1" = "--redo-ocr" ]; then cp "$REDO" "$out"; else ${skipBody}; fi`,
      )
      return async () => (await readFile(calls, 'utf8')).trim().split('\n')
    }

    const run2 = async (input: string) => {
      const dir = await emptyDir('redo')
      const output = join(dir, 'out.pdf')
      const result = await runOcrmypdf(input, output, { mode: 'auto' })
      return { dir, output, result }
    }

    test('--skip-text wins when it found at least as much text', async () => {
      const input = await textPdf('source', 'SOURCE TEXT')
      const redo = await textPdf('redo', 'SOURCE TEXT', true)
      expect(await contentSyntaxErrors(redo)).toBeGreaterThan(0)
      const calls = await standIn(redo, 'cp "$in" "$out"')
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { dir, output, result } = await run2(input)
      expect(result).toMatchObject({ ocrApplied: true, exitCode: 0 })
      expect(result.note).toMatch(
        /damaged the text of some pages; OCR was repeated with --skip-text/,
      )
      expect(await calls()).toEqual(['--redo-ocr', '--skip-text'])
      expect(await sameBytes(output, input)).toBe(true)
      expect(await readdir(dir)).toEqual(['out.pdf'])
    }, 60_000)

    test('--skip-text finding less text keeps the --redo-ocr output', async () => {
      // A page that is a scan under a vector-text overlay: --redo-ocr reads the body, --skip-text
      // leaves it, so the damaged --redo-ocr output still holds more.
      const input = await textPdf('source', 'OVERLAY')
      const redo = await textPdf('redo', 'OVERLAY AND THE SCANNED BODY TEXT', true)
      const skip = await textPdf('skip', 'OVERLAY')
      const calls = await standIn(redo, 'cp "$SKIP" "$out"', { SKIP: skip })

      const { dir, output, result } = await run2(input)
      expect(result).toMatchObject({ ocrApplied: true, exitCode: 0 })
      expect(result.note).toMatch(/--skip-text retry found less text.*--redo-ocr output was kept/)
      expect(await calls()).toEqual(['--redo-ocr', '--skip-text'])
      expect(await sameBytes(output, redo)).toBe(true)
      expect(await readdir(dir)).toEqual(['out.pdf'])
    }, 60_000)

    test('a failed --skip-text keeps the --redo-ocr output instead of copying the input over it', async () => {
      const input = await textPdf('source', 'SOURCE TEXT')
      const redo = await textPdf('redo', 'SOURCE TEXT AND OCR', true)
      await standIn(redo, 'echo "boom" >&2; exit 15')

      const { dir, output, result } = await run2(input)
      expect(result).toMatchObject({ ocrApplied: true, exitCode: 0 })
      expect(result.note).toMatch(
        /--skip-text retry failed \(exit 15: boom\).*--redo-ocr output was kept/,
      )
      expect(await sameBytes(output, redo)).toBe(true)
      expect(await readdir(dir)).toEqual(['out.pdf'])
    }, 60_000)

    test('a --skip-text that runs out of time keeps the --redo-ocr output', async () => {
      const input = await textPdf('source', 'SOURCE TEXT')
      const redo = await textPdf('redo', 'SOURCE TEXT AND OCR', true)
      await standIn(redo, 'sleep 300')
      ocrOverride.timeoutMs = 4000 // the whole budget: the checks and the --redo-ocr run use some

      const { dir, output, result } = await run2(input)
      expect(result).toMatchObject({ ocrApplied: true, exitCode: 0 })
      expect(result.note).toMatch(
        /--skip-text retry failed \(timed out\).*--redo-ocr output was kept/,
      )
      expect(await sameBytes(output, redo)).toBe(true)
      expect(await readdir(dir)).toEqual(['out.pdf'])
    }, 60_000)

    test('output with less text than its input counts as damaged even without syntax errors', async () => {
      const input = await textPdf('source', 'SOURCE WITH A LONGER TEXT')
      const redo = await textPdf('redo', 'HI')
      const calls = await standIn(redo, 'cp "$in" "$out"')
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { output, result } = await run2(input)
      expect(await calls()).toEqual(['--redo-ocr', '--skip-text'])
      expect(result.note).toMatch(/--skip-text/)
      expect(await sameBytes(output, input)).toBe(true)
    }, 60_000)

    test('an input that already had such errors is not retried', async () => {
      const input = await textPdf('source', 'SOURCE TEXT', true)
      const redo = await textPdf('redo', 'SOURCE TEXT', true)
      const calls = await standIn(redo, 'cp "$in" "$out"')

      const { result } = await run2(input)
      expect(result).toMatchObject({ ocrApplied: true, exitCode: 0 })
      expect(result.note).toBeUndefined()
      expect(await calls()).toEqual(['--redo-ocr'])
    }, 60_000)
  })

  test('runOcrmypdf falls back to a copy when ocrmypdf cannot be started', async () => {
    const output = join(work, 'no-ocrmypdf.pdf')
    vi.stubEnv('PATH', work)
    try {
      const result = await runOcrmypdf(FIXTURES.scanPdf, output, { mode: 'auto' })
      expect(result).toMatchObject({ ocrApplied: false, exitCode: null })
      expect(describeOcrFailure(result)).toMatch(/^ocrmypdf exit none: .*ENOENT/)
    } finally {
      vi.unstubAllEnvs()
    }
    expect((await readFile(output)).equals(await readFile(FIXTURES.scanPdf))).toBe(true)
  })

  test('a timed-out OCR run is described by what happened, not by its first stderr line', async () => {
    const pidFile = join(work, `ocr-describe-${Math.random().toString(36).slice(2)}.pid`)
    vi.stubEnv('PIDFILE', pidFile)
    // Prints a banner before hanging, as ocrmypdf does while it starts up.
    await standInOcrmypdf(`echo "Start processing 4 pages concurrently" >&2\n${SLEEPER}`)
    const output = join(work, 'ocr-describe-out.pdf')
    ocrOverride.timeoutMs = 600 // the module mock above applies it to every runOcrmypdf call
    try {
      const result = await runOcrmypdf(FIXTURES.scanPdf, output, { mode: 'auto' })
      expect(result).toMatchObject({ ocrApplied: false, exitCode: null, timedOut: true })
      expect(result.stderr).toContain('Start processing')
      expect(describeOcrFailure(result)).toBe('ocrmypdf timed out after 0.6s')
    } finally {
      reap(readFileSyncSafe(pidFile) ? Number(readFileSyncSafe(pidFile)) : undefined)
    }
  }, 60_000)

  test('runTool aborts the whole process group on signal', async () => {
    const pidFile = join(work, 'group.pid')
    const controller = new AbortController()
    let grandchild: number | undefined
    try {
      const running = runTool('sh', ['-c', 'sleep 300 & echo $! > "$1"; wait', 'sh', pidFile], {
        timeoutMs: 60_000,
        signal: controller.signal,
      })
      const failure = running.catch((e: unknown) => e)
      grandchild = await pidFrom(pidFile)
      expect(isAlive(grandchild)).toBe(true)
      controller.abort()
      const err = await failure
      expect(err).toBeInstanceOf(ToolError)
      expect(err).toMatchObject({ aborted: true, timedOut: false, exitCode: null })
      // The sleep is not the shell's direct child's problem: the group kill reached it too.
      expect(await until(() => !isAlive(grandchild as number), 3000)).toBe(true)
    } finally {
      reap(grandchild)
    }
  }, 30_000)

  test('runTool escalates to SIGKILL for a tool that ignores SIGTERM', async () => {
    const pidFile = join(work, 'stubborn.pid')
    const controller = new AbortController()
    let grandchild: number | undefined
    try {
      const failure = runTool(
        'sh',
        ['-c', 'trap "" TERM; sleep 300 & echo $! > "$1"; wait', 'sh', pidFile],
        { timeoutMs: 60_000, signal: controller.signal },
      ).catch((e: unknown) => e)
      grandchild = await pidFrom(pidFile)
      const started = Date.now()
      controller.abort()
      expect(await failure).toMatchObject({ aborted: true })
      const took = Date.now() - started
      expect(took).toBeGreaterThanOrEqual(KILL_GRACE_MS - 200)
      expect(took).toBeLessThan(KILL_GRACE_MS + 3000)
      expect(await until(() => !isAlive(grandchild as number), 3000)).toBe(true)
    } finally {
      reap(grandchild)
    }
  }, 30_000)

  test('runTool kills the group on timeout and flags it', async () => {
    const pidFile = join(work, 'timeout.pid')
    let grandchild: number | undefined
    try {
      const err = await runTool('sh', ['-c', 'sleep 300 & echo $! > "$1"; wait', 'sh', pidFile], {
        timeoutMs: 400,
      }).catch((e: unknown) => e)
      grandchild = Number(readFileSyncSafe(pidFile))
      expect(err).toBeInstanceOf(ToolError)
      expect(err).toMatchObject({ timedOut: true, aborted: false, exitCode: null })
      expect((err as ToolError).message).toMatch(/^sh timed out after 0\.4s/)
      expect(await until(() => !isAlive(grandchild as number), 3000)).toBe(true)
    } finally {
      reap(grandchild)
    }
  }, 30_000)

  test('runTool with an already aborted signal never starts the tool', async () => {
    const marker = join(work, 'never-started')
    const err = await runTool('sh', ['-c', 'touch "$1"', 'sh', marker], {
      timeoutMs: 10_000,
      signal: AbortSignal.abort(),
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ aborted: true })
    expect(existsSync(marker)).toBe(false)
  })

  test('runTool still reports output, exit codes and a failure to start', async () => {
    expect(await runTool('sh', ['-c', 'echo out; echo err >&2'], { timeoutMs: 10_000 })).toEqual({
      stdout: 'out\n',
      stderr: 'err\n',
    })
    const failed = await runTool('sh', ['-c', 'echo nope >&2; exit 3'], {
      timeoutMs: 10_000,
    }).catch((e: unknown) => e)
    expect(failed).toMatchObject({ exitCode: 3, stderr: 'nope\n', aborted: false, timedOut: false })
    expect((failed as ToolError).message).toBe('sh exited 3: nope')
    const missing = await runTool('binder-no-such-tool', [], { timeoutMs: 10_000 }).catch(
      (e: unknown) => e,
    )
    expect(missing).toMatchObject({ exitCode: null, aborted: false })
    expect((missing as ToolError).stderr).toMatch(/ENOENT/)
  })

  test('runOcrmypdf rethrows an aborted run instead of copying', async () => {
    const pidFile = join(work, 'ocr-abort.pid')
    vi.stubEnv('PIDFILE', pidFile)
    await standInOcrmypdf(SLEEPER)
    const output = join(work, 'ocr-abort-out.pdf')
    const controller = new AbortController()
    let sleeper: number | undefined
    try {
      const failure = runOcrmypdf(FIXTURES.scanPdf, output, {
        mode: 'auto',
        signal: controller.signal,
      }).catch((e: unknown) => e)
      sleeper = await pidFrom(pidFile)
      controller.abort()
      const err = await failure
      expect(err).toBeInstanceOf(ToolError)
      expect(err).toMatchObject({ aborted: true })
      expect(existsSync(output)).toBe(false)
    } finally {
      reap(sleeper)
    }
  }, 30_000)

  test("runOcrmypdf in mode 'never' copies without running OCR", async () => {
    const output = join(work, 'never.pdf')
    const result = await runOcrmypdf(FIXTURES.scanPdf, output, { mode: 'never' })
    expect(result).toEqual({ ocrApplied: false, exitCode: null, stderr: '' })
    expect((await readFile(output)).equals(await readFile(FIXTURES.scanPdf))).toBe(true)
  })

  test('pdfInfo reports displayed dimensions, swapping width and height for /Rotate 90', async () => {
    const info = await pdfInfo(FIXTURES.mixedPdf)
    expect(info.pageCount).toBe(4)
    expect(info.pages.map((p) => p.rotation)).toEqual([0, 90, 0, 0])
    expect(info.pages[1]?.width).toBeCloseTo(841.89, 1)
    expect(info.pages[1]?.height).toBeCloseTo(595.28, 1)
    expect(info.pages[2]?.width).toBeCloseTo(612, 1)
  })

  test('renderThumbnail is 160 px wide and renderPageImage fits 1600 px on the long side', async () => {
    // Page 2 has /Rotate 90: still 160 px wide as displayed.
    const thumb = await renderThumbnail(FIXTURES.mixedPdf, 1, join(work, 'thumb'), 90)
    expect(pngWidth(await readFile(thumb))).toBe(160)
    expect(pngHeight(await readFile(thumb))).toBeLessThan(160)
    const portrait160 = await renderThumbnail(FIXTURES.mixedPdf, 0, join(work, 'thumb0'), 0)
    expect(pngWidth(await readFile(portrait160))).toBe(160)
    const portrait = jpegSize(
      await readFile(await renderPageImage(FIXTURES.mixedPdf, 0, join(work, 'p1'))),
    )
    expect(portrait.height).toBe(1600)
    expect(portrait.width).toBeLessThan(1600)
    const landscape = jpegSize(
      await readFile(await renderPageImage(FIXTURES.mixedPdf, 1, join(work, 'p2'), 800)),
    )
    expect(landscape.width).toBe(800)
    expect(landscape.height).toBeLessThan(800)
  })
})

describe('pg-boss job queue', () => {
  test('starts, creates both queues with dead letters, and sends a document job', async () => {
    const { url } = await getTestDb()
    const boss = new PgBoss({ connectionString: url })
    const errors: unknown[] = []
    boss.on('error', (err) => errors.push(err))
    await boss.start()
    try {
      // A queue left by an earlier release without a dead letter gets one on start.
      await boss.createQueue(PAGE_QUEUE, { retryLimit: 1 })
      const jobs = createJobQueue(boss, { db: s.deps.db, blobs: s.deps.blobs })
      await jobs.start()
      const queues = await boss.getQueues([
        DOCUMENT_QUEUE,
        PAGE_QUEUE,
        DOCUMENT_DEAD_QUEUE,
        PAGE_DEAD_QUEUE,
        REANCHOR_QUEUE,
        REANCHOR_DEAD_QUEUE,
      ])
      expect(
        Object.fromEntries(
          queues.map((q) => [q.name, [q.retryLimit, q.expireInSeconds, q.deadLetter ?? null]]),
        ),
      ).toEqual({
        [DOCUMENT_QUEUE]: [2, 2400, DOCUMENT_DEAD_QUEUE],
        [PAGE_QUEUE]: [3, 300, PAGE_DEAD_QUEUE],
        [REANCHOR_QUEUE]: [3, 600, REANCHOR_DEAD_QUEUE],
        [REANCHOR_DEAD_QUEUE]: [expect.any(Number), expect.any(Number), null],
        [DOCUMENT_DEAD_QUEUE]: [expect.any(Number), expect.any(Number), null],
        [PAGE_DEAD_QUEUE]: [expect.any(Number), expect.any(Number), null],
      })

      await jobs.enqueueDocumentProcess('no-such-version')
      const { rows } = await s.deps.db.$client.query(
        `SELECT data FROM pgboss.job WHERE name = $1`,
        [DOCUMENT_QUEUE],
      )
      expect(rows.map((r) => r.data)).toEqual([{ versionId: 'no-such-version' }])
    } finally {
      await boss.stop({ graceful: true, timeout: 10_000 })
    }
    expect(errors).toEqual([])
  }, 60_000)

  test('re-anchor jobs coalesce per version and a repeat after the run is a no-op', async () => {
    const { url } = await getTestDb()
    const boss = new PgBoss({ connectionString: url })
    const errors: unknown[] = []
    boss.on('error', (err) => errors.push(err))
    await boss.start()
    try {
      const jobs = createJobQueue(boss, { db: s.deps.db, blobs: s.deps.blobs })
      // Queues created as `start()` creates them, but no worker takes the jobs while they are counted.
      await ensureQueues(boss)
      const queue = (await boss.getQueues([REANCHOR_QUEUE]))[0]
      expect(queue?.policy).toBe('short')
      await jobs.enqueueReanchor('v-coalesce-1')
      await jobs.enqueueReanchor('v-coalesce-1')
      await jobs.enqueueReanchor('v-coalesce-2')
      const { rows } = await s.deps.db.$client.query(
        `SELECT data->>'versionId' AS id, singleton_key FROM pgboss.job WHERE name = $1 ORDER BY 1`,
        [REANCHOR_QUEUE],
      )
      expect(rows).toEqual([
        { id: 'v-coalesce-1', singleton_key: 'v-coalesce-1' },
        { id: 'v-coalesce-2', singleton_key: 'v-coalesce-2' },
      ])
    } finally {
      await boss.stop({ graceful: true, timeout: 10_000 })
    }
    expect(errors).toEqual([])
  }, 60_000)

  test('a re-anchor job that fails its last attempt is dead-lettered and makes the version current', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { url } = await getTestDb()
    const boss = new PgBoss({ connectionString: url })
    boss.on('error', () => {})
    await boss.start()
    try {
      const jobs = createJobQueue(boss, { db: s.deps.db, blobs: s.deps.blobs })
      await jobs.start()
      const pdf = await textOnlyPdf()
      const { document, version: v1 } = await upload(pdf)
      await processAll(v1.id)
      const v2 = await addDocumentVersion(s.deps.db, s.deps.blobs, s.jobs, s.ownerActor, {
        documentId: document.id,
        label: 'second',
        file: createReadStream(pdf),
      })
      await processAll(v2.id)
      // Without its word layers the job throws on every attempt; no retries, to be quick.
      await s.deps.db
        .update(pages)
        .set({ wordsKey: 'missing/words.json' })
        .where(eq(pages.documentVersionId, v2.id))
      await boss.send(REANCHOR_QUEUE, { versionId: v2.id }, { retryLimit: 0 })
      const current = async () =>
        (await s.deps.db.select().from(documents).where(eq(documents.id, document.id)))[0]
          ?.currentVersionId
      for (let i = 0; i < 60 && (await current()) !== v2.id; i++) {
        await new Promise((r) => setTimeout(r, 250))
      }
      expect(await current()).toBe(v2.id)
      expect(logged.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
        `re-anchoring ${v2.id} failed after retries`,
      )
    } finally {
      await boss.stop({ graceful: true, timeout: 10_000 })
    }
  }, 120_000)

  test('a document job that fails its last attempt is dead-lettered and fails the version', async () => {
    const { url } = await getTestDb()
    const boss = new PgBoss({ connectionString: url })
    boss.on('error', () => {})
    await boss.start()
    try {
      const jobs = createJobQueue(boss, { db: s.deps.db, blobs: s.deps.blobs })
      await jobs.start()
      const { version } = await upload(await textOnlyPdf())
      // Without its original the document job throws on every attempt; no retries, to be quick.
      await s.deps.blobs.delete(version.originalKey)
      await boss.send(DOCUMENT_QUEUE, { versionId: version.id }, { retryLimit: 0 })

      let current = (await load(version.id)).version
      for (let i = 0; i < 60 && current.status !== 'failed'; i++) {
        await new Promise((r) => setTimeout(r, 250))
        current = (await load(version.id)).version
      }
      expect(current.status).toBe('failed')
      expect(current.error).toMatch(
        /^Processing failed after retries: blob .*original\.pdf is missing$/,
      )
    } finally {
      await boss.stop({ graceful: true, timeout: 10_000 })
    }
  }, 60_000)

  test('schedules a daily sync-chunk-gc job that forgets applied chunks older than seven days', async () => {
    const { url } = await getTestDb()
    const boss = new PgBoss({ connectionString: url })
    const errors: unknown[] = []
    boss.on('error', (err) => errors.push(err))
    await boss.start()
    try {
      await createJobQueue(boss, { db: s.deps.db, blobs: s.deps.blobs }).start()
      const schedules = await boss.getSchedules(SYNC_CHUNK_GC_QUEUE)
      expect(schedules.map((x) => [x.name, x.cron])).toEqual([
        [SYNC_CHUNK_GC_QUEUE, SYNC_CHUNK_GC_CRON],
      ])
      expect(SYNC_CHUNK_GC_CRON.split(' ').slice(2)).toEqual(['*', '*', '*'])

      const now = new Date('2026-10-15T03:00:00Z')
      const day = 24 * 60 * 60 * 1000
      await s.deps.db.insert(syncAppliedChunks).values([
        { batchKey: 'gc:old', chunkIndex: 0, appliedAt: new Date(now.getTime() - 8 * day) },
        { batchKey: 'gc:recent', chunkIndex: 0, appliedAt: new Date(now.getTime() - 6 * day) },
      ])
      await handleSyncChunkGc({ db: s.deps.db }, now)
      const left = await s.deps.db.select().from(syncAppliedChunks)
      expect(left.map((r) => r.batchKey).filter((k) => k.startsWith('gc:'))).toEqual(['gc:recent'])
    } finally {
      await boss.stop({ graceful: true, timeout: 10_000 })
    }
    expect(errors).toEqual([])
  }, 60_000)

  test('the document job expires only after the OCR timeout, with a margin for the rest of the job', () => {
    expect(OCRMYPDF_TIMEOUT_MS).toBe(30 * 60 * 1000)
    expect(DOCUMENT_JOB_EXPIRE_SECONDS * 1000).toBeGreaterThan(OCRMYPDF_TIMEOUT_MS)
    expect(DOCUMENT_JOB_EXPIRE_SECONDS).toBe(40 * 60)
  })
})
