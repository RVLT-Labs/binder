import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { documentVersions, pages } from '@binder/db'
import type { Actor, WordLayer } from '@binder/shared'
import { and, eq } from 'drizzle-orm'
import { type BlobStore, readBlobBytes } from '../blob/BlobStore'
import { pageImageBlobKey } from '../blob/keys'
import { conflict, invalid, notFound } from '../errors'
import { jpegSize } from '../processing/jpeg'
import { renderPageImage } from '../processing/poppler'
import { blobFile, withTempDir } from '../processing/tmp'
import type { DocumentVersion, Page } from './documents'
import type { Executor } from './executor'
import { requireShowRole } from './tenancy'

/** Spec 3.10: page images are at most this many pixels on the long side. */
export const MAX_PAGE_IMAGE_PX = 1600
const MIN_PAGE_IMAGE_PX = 100

/** A version the actor can read (viewer or above), or not_found. */
export async function readableVersion(
  db: Executor,
  actor: Actor,
  versionId: string,
): Promise<DocumentVersion> {
  const [version] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, versionId))
  if (!version) throw notFound('Version not found')
  await requireShowRole(db, actor, version.showId, 'viewer')
  return version
}

async function readablePage(
  db: Executor,
  actor: Actor,
  versionId: string,
  index: number,
): Promise<{ version: DocumentVersion; page: Page }> {
  const version = await readableVersion(db, actor, versionId)
  const [page] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.documentVersionId, versionId), eq(pages.index, index)))
  if (!page) throw notFound('Page not found')
  return { version, page }
}

/** A page's word layer, parsed. Empty for a page with no layer (not yet processed, or failed). */
export async function readWordLayer(blobs: BlobStore, page: Page): Promise<WordLayer> {
  if (!page.wordsKey) return { words: [], lines: [] }
  const bytes = await readBlobBytes(blobs, page.wordsKey)
  if (!bytes) throw new Error(`word layer ${page.wordsKey} is missing`)
  return JSON.parse(bytes.toString('utf8')) as WordLayer
}

/** Any member. A page (zero-based `index`) and its word layer; check `page.status` for readiness. */
export async function getPage(
  db: Executor,
  blobs: BlobStore,
  actor: Actor,
  input: { versionId: string; index: number },
): Promise<{ page: Page; words: WordLayer }> {
  const { page } = await readablePage(db, actor, input.versionId, input.index)
  return { page, words: await readWordLayer(blobs, page) }
}

/**
 * Any member. The page rendered from the searchable PDF as a JPEG at most `maxPx` (default and
 * maximum 1600) on its long side. The 1600 px render is made once and cached beside the page's
 * other blobs; smaller sizes are rendered on demand and not cached.
 */
export async function getPageImage(
  db: Executor,
  blobs: BlobStore,
  actor: Actor,
  input: { versionId: string; index: number; maxPx?: number },
): Promise<{ jpeg: Uint8Array; width: number; height: number }> {
  const maxPx = input.maxPx ?? MAX_PAGE_IMAGE_PX
  if (!Number.isInteger(maxPx) || maxPx < MIN_PAGE_IMAGE_PX || maxPx > MAX_PAGE_IMAGE_PX) {
    throw invalid(`maxPx must be a whole number from ${MIN_PAGE_IMAGE_PX} to ${MAX_PAGE_IMAGE_PX}`)
  }
  const { version, page } = await readablePage(db, actor, input.versionId, input.index)
  const { searchableKey } = version
  if (!searchableKey) throw conflict('This version is still being processed; try again shortly')

  const cacheKey =
    maxPx === MAX_PAGE_IMAGE_PX
      ? pageImageBlobKey(version.showId, version.documentId, version.id, page.index, maxPx)
      : null
  const cached = cacheKey ? await readBlobBytes(blobs, cacheKey) : null
  if (cached) return { jpeg: cached, ...jpegSize(cached) }

  const jpeg = await withTempDir('binder-render-', async (dir) => {
    const pdf = await blobFile(blobs, searchableKey, dir, 'searchable.pdf')
    return readFile(await renderPageImage(pdf, page.index, join(dir, 'page'), maxPx))
  })
  if (cacheKey) await blobs.put(cacheKey, jpeg, 'image/jpeg')
  return { jpeg, ...jpegSize(jpeg) }
}
