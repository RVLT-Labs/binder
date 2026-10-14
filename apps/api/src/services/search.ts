import { type DocHit, searchDocument } from '@binder/core'
import { pages } from '@binder/db'
import type { Actor, WordLayer } from '@binder/shared'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { BlobStore } from '../blob/BlobStore'
import { invalid } from '../errors'
import type { Executor } from './executor'
import { readableVersion, readWordLayer } from './pages'

export const MAX_SEARCH_LIMIT = 200

export interface SearchHit extends DocHit {
  /** The first matched word's box, in displayed page space (PDF points, origin bottom-left). */
  box: { x: number; y: number; w: number; h: number }
}

/** Any member. Phrase search over a version's ready pages, in page then reading order. */
export async function searchVersion(
  db: Executor,
  blobs: BlobStore,
  actor: Actor,
  input: { versionId: string; query: string; limit?: number },
): Promise<SearchHit[]> {
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
    throw invalid(`limit must be a whole number from 1 to ${MAX_SEARCH_LIMIT}`)
  }
  await readableVersion(db, actor, input.versionId)
  const ready = await db
    .select()
    .from(pages)
    .where(
      and(
        eq(pages.documentVersionId, input.versionId),
        eq(pages.status, 'ready'),
        isNotNull(pages.wordsKey),
      ),
    )
  const layers = new Map<number, WordLayer>(
    await Promise.all(ready.map(async (p) => [p.index, await readWordLayer(blobs, p)] as const)),
  )
  return searchDocument(layers, input.query, limit).map((hit) => {
    const word = layers.get(hit.pageIndex)?.words[hit.wordStart]
    const box = word ? { x: word.x, y: word.y, w: word.w, h: word.h } : { x: 0, y: 0, w: 0, h: 0 }
    return { ...hit, box }
  })
}
