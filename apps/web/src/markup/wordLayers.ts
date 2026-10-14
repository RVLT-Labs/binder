import type { WordLayer } from '@binder/shared'
import { useEffect, useState } from 'react'
import { loadLayer } from '../search/useDocumentSearch'

const cache = new Map<string, Promise<WordLayer | null>>()

/**
 * A page's word layer, read once per page for the page's lifetime in memory (blob keys never change
 * content). A failed read is forgotten, so the next use tries again.
 */
export function loadWordLayer(key: string): Promise<WordLayer | null> {
  let promise = cache.get(key)
  if (!promise) {
    promise = loadLayer(key)
    cache.set(key, promise)
    void promise.then((layer) => {
      if (!layer) cache.delete(key)
    })
  }
  return promise
}

/** The word layer behind `key` once loaded; null while loading and for pages without words. */
export function useWordLayer(key: string | null | undefined): WordLayer | null {
  const [loaded, setLoaded] = useState<{ key: string; layer: WordLayer | null } | null>(null)
  useEffect(() => {
    if (!key) return
    let live = true
    void loadWordLayer(key).then((layer) => {
      if (live) setLoaded({ key, layer })
    })
    return () => {
      live = false
    }
  }, [key])
  return key && loaded?.key === key ? loaded.layer : null
}
