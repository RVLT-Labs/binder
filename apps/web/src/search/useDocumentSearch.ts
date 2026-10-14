import { type DocHit, searchDocument } from '@binder/core'
import type { WordLayer } from '@binder/shared'
import { usePowerSync } from '@powersync/react'
import { useCallback, useRef, useState } from 'react'
import { blobUrl, fetchBlob } from '../blobs/fetchBlob'

/** How many word layers download at once. */
const CONCURRENCY = 6

interface Loaded {
  layers: Map<number, WordLayer>
  /** Pages whose words could not be loaded, so searches cannot find anything on them. */
  unavailable: number
}

interface PageWords {
  index: number
  words_key: string | null
}

async function loadLayer(key: string): Promise<WordLayer | null> {
  try {
    const res = await fetchBlob(blobUrl(key))
    if (!res.ok) return null
    const layer = (await res.json()) as Partial<WordLayer>
    return Array.isArray(layer.words) && Array.isArray(layer.lines) ? (layer as WordLayer) : null
  } catch {
    return null
  }
}

async function loadAll(pages: readonly PageWords[]): Promise<Loaded> {
  const layers = new Map<number, WordLayer>()
  let unavailable = 0
  let next = 0
  async function worker() {
    while (next < pages.length) {
      const page = pages[next++]
      const layer = page.words_key ? await loadLayer(page.words_key) : null
      if (layer) layers.set(page.index, layer)
      else unavailable++
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, worker))
  return { layers, unavailable }
}

export interface DocumentSearch {
  /** Finds `query` in the version's text. The first call loads every page's words. */
  search(query: string): Promise<DocHit[]>
  /** True while the words are loading. */
  loading: boolean
  /** The loaded word layers by zero-based page index; null until the first search. */
  layers: ReadonlyMap<number, WordLayer> | null
  /** Pages that could not be searched (words missing or unreadable). */
  unavailable: number
}

/**
 * Full-text search over one document version, in the browser. Every page's words.json is read
 * through the blob cache once, on the first search, and kept in memory for the rest. It works
 * offline once the show has been made available offline.
 */
export function useDocumentSearch(versionId: string): DocumentSearch {
  const db = usePowerSync()
  const [loaded, setLoaded] = useState<(Loaded & { versionId: string }) | null>(null)
  const [loadingFor, setLoadingFor] = useState<string | null>(null)
  /** The load for the current version, shared by searches that overlap. */
  const inFlight = useRef<{ versionId: string; promise: Promise<Loaded> } | null>(null)

  const ensureLoaded = useCallback((): Promise<Loaded> => {
    if (inFlight.current?.versionId === versionId) return inFlight.current.promise
    setLoadingFor(versionId)
    const promise = (async () => {
      const pages = await db.getAll<PageWords>(
        'SELECT "index", words_key FROM pages WHERE document_version_id = ? ORDER BY "index"',
        [versionId],
      )
      return loadAll(pages)
    })()
    const mine = { versionId, promise }
    inFlight.current = mine
    promise.then(
      (result) => {
        setLoaded({ ...result, versionId })
        setLoadingFor((now) => (now === versionId ? null : now))
      },
      () => {
        // Forget a failed load so the next search retries it.
        if (inFlight.current === mine) inFlight.current = null
        setLoadingFor((now) => (now === versionId ? null : now))
      },
    )
    return promise
  }, [db, versionId])

  const search = useCallback(
    async (query: string) => searchDocument((await ensureLoaded()).layers, query),
    [ensureLoaded],
  )

  // Words from another version are never offered for this one.
  const current = loaded?.versionId === versionId ? loaded : null
  return {
    search,
    loading: loadingFor === versionId,
    layers: current?.layers ?? null,
    unavailable: current?.unavailable ?? 0,
  }
}
