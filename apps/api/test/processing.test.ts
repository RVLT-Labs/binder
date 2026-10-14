import { execFile, execFileSync } from 'node:child_process'
import { createReadStream, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { changeLog, documents, documentVersions, pages } from '@binder/db'
import { getTestDb } from '@binder/db/testing'
import { FIXTURES } from '@binder/fixtures'
import type { OcrMode, WordLayer } from '@binder/shared'
import { asc, eq, sql } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { processDocumentVersion } from '../src/processing/documentJob'
import { describeOcrFailure, OCRMYPDF_TIMEOUT_MS, runOcrmypdf } from '../src/processing/ocrmypdf'
import { processPage } from '../src/processing/pageJob'
import { pdfInfo, renderPageImage, renderThumbnail } from '../src/processing/poppler'
import {
  createJobQueue,
  DOCUMENT_DEAD_QUEUE,
  DOCUMENT_JOB_EXPIRE_SECONDS,
  DOCUMENT_QUEUE,
  handleDocumentDeadLetter,
  handlePageDeadLetter,
  PAGE_DEAD_QUEUE,
  PAGE_QUEUE,
} from '../src/processing/queue'
import type { ProcessingDeps } from '../src/processing/types'
import { addDocumentVersion, createDocument } from '../src/services'
import { setupShow } from './documentHelpers'
import { RecordingJobs } from './helpers'

const run = promisify(execFile)

const TOOLS: Array<[string, string[]]> = [
  ['ocrmypdf', ['--version']],
  ['pdfinfo', ['-v']],
  ['pdfimages', ['-v']],
  ['pdftoppm', ['-v']],
  ['pdftotext', ['-v']],
  ['qpdf', ['--version']],
]

function missingTools(): string[] {
  return TOOLS.filter(([cmd, args]) => {
    try {
      execFileSync(cmd, args, { stdio: 'ignore' })
      return false
    } catch {
      return true
    }
  }).map(([cmd]) => cmd)
}

const missing = missingTools()
if (missing.length > 0) {
  console.warn(`Skipping processing tests; missing tools: ${missing.join(', ')}`)
}

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
})
afterAll(async () => {
  if (sharedTmp === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = sharedTmp
  await rm(work, { recursive: true, force: true })
})

async function upload(pdf: string, ocrMode?: OcrMode) {
  return createDocument(s.deps.db, s.deps.blobs, s.jobs, s.ownerActor, {
    showId: s.show.id,
    kind: 'libretto',
    title: basename(pdf),
    ocrMode,
    file: createReadStream(pdf),
  })
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

describe.skipIf(missing.length > 0)('processing pipeline', () => {
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
    expect(done.version).toMatchObject({ status: 'ready', pageCount: 4, error: null })
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
    // (next test), so a stand-in ocrmypdf on PATH plays an OCRmyPDF that refuses them with exit 8.
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
    expect((await blobBytes(done.version.searchableKey)).equals(await readFile(ownerOnly))).toBe(
      true,
    )
    expect((await wordLayer(done.pages[0] as { wordsKey: string })).words.map((w) => w.t)).toEqual([
      'PAGE',
      'ONE',
      'PORTRAIT',
    ])
  }, 120_000)

  test('owner-restricted pdf with the installed OCRmyPDF: processed and OCRd like any other', async () => {
    const ownerOnly = join(work, 'owner-only-real.pdf')
    await run('qpdf', ['--encrypt', '', 'owner', '256', '--', FIXTURES.mixedPdf, ownerOnly])
    const { version } = await upload(ownerOnly)
    const done = await processAll(version.id)
    expect(done.version).toMatchObject({ status: 'ready', pageCount: 4, error: null })
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

  test('a later version becomes current once it is ready', async () => {
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
    expect(await current()).toBe(v2.id)
    expect((await load(v2.id)).version.updatedBy).toBe('system')
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
    await processAll(v2.id)
    await mapLimit(v1Deps.jobs.enqueuedPages, 3, (id) => processPage(v1Deps, id))

    expect((await load(v1.id)).version.status).toBe('ready')
    const [doc] = await s.deps.db.select().from(documents).where(eq(documents.id, document.id))
    expect(doc?.currentVersionId).toBe(v2.id)
  }, 120_000)
})

describe.skipIf(missing.length > 0)('dead letters', () => {
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
      updatedBy: 'system',
    })

    const timedOut = await upload(await textOnlyPdf())
    await handleDocumentDeadLetter(deps, {
      data: { versionId: timedOut.version.id },
      sourceOutput: { value: { message: 'job timed out' } },
    })
    expect((await load(timedOut.version.id)).version.error).toBe(
      'Processing timed out after retries.',
    )

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

describe.skipIf(missing.length > 0)('tool wrappers', () => {
  test('runOcrmypdf falls back to a copy on invalid input and reports the exit code', async () => {
    const input = join(work, 'not-really.pdf')
    const output = join(work, 'not-really-out.pdf')
    await writeFile(input, '%PDF-1.7\nthis is not a pdf\n')
    const result = await runOcrmypdf(input, output, { mode: 'auto' })
    expect(result).toMatchObject({ ocrApplied: false, exitCode: 2 })
    expect(await readFile(output, 'utf8')).toBe('%PDF-1.7\nthis is not a pdf\n')
    expect(describeOcrFailure(result)).toMatch(/^ocrmypdf exit 2: \S/)
  }, 60_000)

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
      ])
      expect(
        Object.fromEntries(
          queues.map((q) => [q.name, [q.retryLimit, q.expireInSeconds, q.deadLetter ?? null]]),
        ),
      ).toEqual({
        [DOCUMENT_QUEUE]: [2, 2400, DOCUMENT_DEAD_QUEUE],
        [PAGE_QUEUE]: [3, 300, PAGE_DEAD_QUEUE],
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

  test('the document job expires only after the OCR timeout, with a margin for the rest of the job', () => {
    expect(OCRMYPDF_TIMEOUT_MS).toBe(30 * 60 * 1000)
    expect(DOCUMENT_JOB_EXPIRE_SECONDS * 1000).toBeGreaterThan(OCRMYPDF_TIMEOUT_MS)
    expect(DOCUMENT_JOB_EXPIRE_SECONDS).toBe(40 * 60)
  })
})
