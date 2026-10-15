import type { VersionText } from '@binder/core'
import type { WordLayer } from '@binder/shared'
import { useQuery } from '@powersync/react'
import { useEffect, useMemo, useState } from 'react'
import { loadWordLayer } from '../markup/wordLayers'
import { useOnline } from '../offline/useOnline'

/** How many word layers load at once. */
const CONCURRENCY = 6
/** Versions kept parsed in memory: a full libretto is about 10 MB, and compare needs two. */
export const CACHE_VERSIONS = 3

export interface PageInfo {
  index: number
  width: number | null
  height: number | null
  words_key: string | null
}

export interface LoadedVersionText {
  text: VersionText
  /** Pages that have a word layer on the server whose layer could not be read (no cache, no network). */
  unavailable: number
}

type LoadLayer = (key: string) => Promise<WordLayer | null>

/** Reads every page's word layer. A page whose layer fails is counted, never silently left out. */
export async function readVersionText(
  versionId: string,
  documentId: string,
  pages: readonly PageInfo[],
  load: LoadLayer,
): Promise<LoadedVersionText> {
  const layers = new Map<number, WordLayer>()
  let unavailable = 0
  let next = 0
  async function worker() {
    while (next < pages.length) {
      const page = pages[next++]
      if (!page?.words_key) continue
      const layer = await load(page.words_key)
      if (layer) layers.set(page.index, layer)
      else unavailable++
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, worker))
  return {
    text: {
      versionId,
      documentId,
      pageCount: pages.length,
      pages: pages.map((p) => ({ width: p.width, height: p.height })),
      layers,
    },
    unavailable,
  }
}

/**
 * Parsed version texts, the most recently used `max` of them. Only complete results are kept: one
 * with an unreadable page is returned once and forgotten, so the next use (for example back online)
 * reads it again.
 */
export function createVersionTextCache(max: number, load: LoadLayer) {
  const cache = new Map<string, Promise<LoadedVersionText>>()
  return {
    get(versionId: string, documentId: string, pages: readonly PageInfo[]) {
      const signature = `${versionId}|${pages.map((p) => `${p.index}:${p.words_key ?? ''}`).join(',')}`
      const hit = cache.get(signature)
      if (hit) {
        cache.delete(signature)
        cache.set(signature, hit)
        return hit
      }
      const promise = readVersionText(versionId, documentId, pages, load)
      cache.set(signature, promise)
      promise.then(
        (loaded) => {
          if (loaded.unavailable > 0 && cache.get(signature) === promise) cache.delete(signature)
        },
        () => {
          if (cache.get(signature) === promise) cache.delete(signature)
        },
      )
      while (cache.size > max) {
        const oldest = cache.keys().next().value
        if (oldest === undefined) break
        cache.delete(oldest)
      }
      return promise
    },
    clear: () => cache.clear(),
    size: () => cache.size,
  }
}

const cache = createVersionTextCache(CACHE_VERSIONS, loadWordLayer)

/** Frees the parsed texts, for when the screen that used them goes away. */
export const clearVersionTextCache = () => cache.clear()

export interface VersionTextState {
  /** Null while loading, and for a version with no pages yet. */
  text: VersionText | null
  /** Pages whose text could not be read; the text is then incomplete. */
  unavailable: number
}

/**
 * The text of one document version (page sizes and word layers), from the synced page rows and the
 * cached blobs. Reads again when the browser comes back online if any page was unavailable.
 */
export function useVersionText(versionId: string | null): VersionTextState {
  const online = useOnline()
  const { data: pages } = useQuery<PageInfo>(
    'SELECT "index", width, height, words_key FROM pages WHERE document_version_id = ? ORDER BY "index"',
    [versionId ?? ''],
  )
  const { data: versions } = useQuery<{ document_id: string | null }>(
    'SELECT document_id FROM document_versions WHERE id = ?',
    [versionId ?? ''],
  )
  const documentId = versions[0]?.document_id ?? ''
  const signature = useMemo(
    () => pages.map((p) => `${p.index}:${p.words_key ?? ''}`).join(','),
    [pages],
  )
  const [loaded, setLoaded] = useState<{ key: string; value: LoadedVersionText } | null>(null)
  const key = `${versionId}|${signature}`
  const retryKey = online ? 'online' : 'offline'

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the page rows it was built from; `retryKey` re-reads incomplete text when the network returns
  useEffect(() => {
    if (!versionId || pages.length === 0) return
    let live = true
    void cache.get(versionId, documentId, pages).then((value) => {
      if (live) setLoaded({ key, value })
    })
    return () => {
      live = false
    }
  }, [key, versionId, documentId, retryKey])

  return loaded?.key === key
    ? { text: loaded.value.text, unavailable: loaded.value.unavailable }
    : { text: null, unavailable: 0 }
}
