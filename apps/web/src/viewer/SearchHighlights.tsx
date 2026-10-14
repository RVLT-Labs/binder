import type { DocHit } from '@binder/core'
import type { Word } from '@binder/shared'

export interface SearchHighlightsProps {
  /** The hits on this page. */
  hits: readonly DocHit[]
  /** This page's word layer: `hit.wordStart..wordEnd` index into it. */
  words: readonly Word[]
  /** The hit being looked at, drawn stronger than the rest. */
  active?: DocHit | null
}

/** A rectangle over each matched word, in displayed coordinates. Draw inside a PageOverlay. */
export function SearchHighlights({ hits, words, active }: SearchHighlightsProps) {
  return hits.flatMap((hit) => {
    const rects = []
    for (let i = hit.wordStart; i <= hit.wordEnd; i++) {
      const word = words[i]
      if (!word) continue
      rects.push(
        <rect
          key={`${hit.lineIndex}:${i}`}
          className={hit === active ? 'search-hit search-hit-active' : 'search-hit'}
          x={word.x}
          y={word.y}
          width={word.w}
          height={word.h}
        />,
      )
    }
    return rects
  })
}
