import type { VersionText } from '@binder/core'
import { documentVersions, pages } from '@binder/db'
import type { WordLayer } from '@binder/shared'
import { asc, eq } from 'drizzle-orm'
import type { BlobStore } from '../blob/BlobStore'
import { notFound } from '../errors'
import type { Executor } from './executor'
import { readWordLayer } from './pages'

const CACHE_VERSIONS = 8

interface Cached {
  /** The pages' words keys in index order; the entry is only valid while they are unchanged. */
  signature: string
  text: VersionText
}

/** Most recently used last. Word-layer blobs never change under a key, so a key list is a sound validator. */
const cache = new Map<string, Cached>()

/**
 * Internal (not in the barrel): every page's word layer for a version, with page sizes. Reads the
 * page rows each time (cheap) and the blobs only when a page's words key is new, keeping the eight
 * most recently used versions in process.
 */
export async function loadVersionText(
  db: Executor,
  blobs: BlobStore,
  versionId: string,
): Promise<VersionText> {
  const [version] = await db
    .select({ documentId: documentVersions.documentId, pageCount: documentVersions.pageCount })
    .from(documentVersions)
    .where(eq(documentVersions.id, versionId))
  if (!version) throw notFound('Version not found')
  const rows = await db
    .select()
    .from(pages)
    .where(eq(pages.documentVersionId, versionId))
    .orderBy(asc(pages.index))
  const signature = rows.map((p) => `${p.index}:${p.wordsKey ?? ''}`).join('|')

  const hit = cache.get(versionId)
  if (hit && hit.signature === signature) {
    cache.delete(versionId)
    cache.set(versionId, hit)
    return hit.text
  }

  const layers = new Map<number, WordLayer>()
  await Promise.all(
    rows
      .filter((p) => p.wordsKey)
      .map(async (p) => {
        layers.set(p.index, await readWordLayer(blobs, p))
      }),
  )
  const text: VersionText = {
    versionId,
    documentId: version.documentId,
    pageCount: version.pageCount ?? rows.length,
    pages: rows.map((p) => ({ width: p.width, height: p.height })),
    layers,
  }
  cache.delete(versionId)
  cache.set(versionId, { signature, text })
  while (cache.size > CACHE_VERSIONS) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return text
}
