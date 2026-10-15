import type { VersionText } from '@binder/core'
import type { WordLayer } from '@binder/shared'
import { useQuery } from '@powersync/react'
import { useEffect, useMemo, useState } from 'react'
import { loadWordLayer } from '../markup/wordLayers'

/** How many word layers load at once. */
const CONCURRENCY = 6

interface PageInfo {
  index: number
  width: number | null
  height: number | null
  words_key: string | null
}

const cache = new Map<string, Promise<VersionText>>()

/** Every page's word layer for a version, read through the blob cache so it works offline. */
function loadVersionText(
  versionId: string,
  documentId: string,
  pages: readonly PageInfo[],
): Promise<VersionText> {
  const signature = `${versionId}|${pages.map((p) => `${p.index}:${p.words_key ?? ''}`).join(',')}`
  let promise = cache.get(signature)
  if (!promise) {
    promise = (async () => {
      const layers = new Map<number, WordLayer>()
      let next = 0
      async function worker() {
        while (next < pages.length) {
          const page = pages[next++]
          if (!page?.words_key) continue
          const layer = await loadWordLayer(page.words_key)
          if (layer) layers.set(page.index, layer)
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, worker))
      return {
        versionId,
        documentId,
        pageCount: pages.length,
        pages: pages.map((p) => ({ width: p.width, height: p.height })),
        layers,
      }
    })()
    cache.set(signature, promise)
    // A failed read is forgotten so the next use tries again.
    promise.catch(() => cache.delete(signature))
  }
  return promise
}

/**
 * The text of one document version (page sizes and word layers), from the synced page rows and the
 * cached blobs. Null while loading, and for a version with no pages yet.
 */
export function useVersionText(versionId: string | null): VersionText | null {
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
  const [loaded, setLoaded] = useState<{ key: string; text: VersionText } | null>(null)
  const key = `${versionId}|${signature}`

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the page rows it was built from
  useEffect(() => {
    if (!versionId || pages.length === 0) return
    let live = true
    void loadVersionText(versionId, documentId, pages).then((text) => {
      if (live) setLoaded({ key, text })
    })
    return () => {
      live = false
    }
  }, [key, versionId, documentId])

  return loaded?.key === key ? loaded.text : null
}
