import { QUOTE_MAX_WORDS, SNAP_DISTANCE_PT, type TextAnchor, type WordLayer } from '@binder/shared'
import { nearestLine } from '../anchors/snap'
import { helveticaWidth } from './helvetica'
import type { Box } from './markers'

export interface Caret {
  x: number
  /** The word's box. */
  box: Box
}

type CaretWord = { x: number; w: number; t: string }

/** An integer within 0 to the word's code-point count. */
export function clampOffset(text: string, offset: number): number {
  const n = Array.from(text).length
  if (!Number.isFinite(offset)) return offset > 0 ? n : 0
  return Math.min(n, Math.max(0, Math.trunc(offset)))
}

/** The x of a character boundary: Helvetica-proportional share of the word's width. */
export function caretX(word: CaretWord, offset: number): number {
  const chars = Array.from(word.t)
  const at = clampOffset(word.t, offset)
  const whole = helveticaWidth(word.t, 10)
  if (!(whole > 0) || at === 0) return word.x
  const share = helveticaWidth(chars.slice(0, at).join(''), 10) / whole
  return word.x + word.w * Math.min(1, Math.max(0, share))
}

/** Where a text anchor's caret sits; null when it is unbound or its word is gone. */
export function caretAt(
  layer: WordLayer,
  text: { wordStart: number; offset?: number },
): Caret | null {
  const word = layer.words[text.wordStart]
  if (!word) return null
  return {
    x: caretX(word, text.offset ?? 0),
    box: { x: word.x, y: word.y, w: word.w, h: word.h },
  }
}

/**
 * Snaps a pointer to the nearest character boundary on the nearest line (within `maxDistance`),
 * with the text anchored from that word to the line end, up to eight words.
 */
export function snapToCaret(
  layer: WordLayer,
  point: { x: number; y: number },
  maxDistance = SNAP_DISTANCE_PT,
): { x: number; y: number; text: TextAnchor & { offset: number } } | null {
  const best = nearestLine(layer, point.y, maxDistance)
  if (!best) return null
  const line = (layer.lines[best.lineIndex] ?? []).filter((i) => layer.words[i])
  let pick: { pos: number; offset: number; x: number } | null = null
  let pickDx = Number.POSITIVE_INFINITY
  line.forEach((wordIndex, pos) => {
    const w = layer.words[wordIndex] as CaretWord
    const n = Array.from(w.t).length
    for (let offset = 0; offset <= n; offset++) {
      const x = caretX(w, offset)
      const dx = Math.abs(x - point.x)
      if (dx < pickDx) {
        pickDx = dx
        pick = { pos, offset, x }
      }
    }
  })
  if (!pick) return null
  const { pos, offset, x } = pick as { pos: number; offset: number; x: number }
  const picked = line.slice(pos, pos + QUOTE_MAX_WORDS)
  return {
    x,
    y: best.centre,
    text: {
      quote: picked.map((i) => (layer.words[i] as { t: string }).t).join(' '),
      wordStart: picked[0] as number,
      wordEnd: picked.at(-1) as number,
      offset,
    },
  }
}
