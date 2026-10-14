import { buildWordStream, lineCentreY } from '@binder/core'
import { QUOTE_MAX_WORDS, type TextAnchor, type WordLayer } from '@binder/shared'

type Point = { x: number; y: number }
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** The distance from `p` to the word's box (0 inside it). */
function distanceTo(w: WordLayer['words'][number], p: Point): number {
  const dx = p.x < w.x ? w.x - p.x : p.x > w.x + w.w ? p.x - (w.x + w.w) : 0
  const dy = p.y < w.y ? w.y - p.y : p.y > w.y + w.h ? p.y - (w.y + w.h) : 0
  return Math.hypot(dx, dy)
}

/**
 * The words a drag from `from` to `to` covers (displayed points on one page): each end maps to its
 * nearest word, and the range is every word between them in reading order. The quote is the first
 * eight words; `wordStart` and `wordEnd` are indices into the page's words. Null for a page with no words.
 */
export function wordRangeFromDrag(layer: WordLayer, from: Point, to: Point): TextAnchor | null {
  const stream = buildWordStream(new Map([[0, layer]]))
  if (stream.length === 0) return null
  const nearest = (p: Point) => {
    let best = 0
    let bestDistance = Number.POSITIVE_INFINITY
    stream.forEach((s, pos) => {
      const word = layer.words[s.wordIndex]
      const d = word ? distanceTo(word, p) : Number.POSITIVE_INFINITY
      if (d < bestDistance) {
        best = pos
        bestDistance = d
      }
    })
    return best
  }
  const a = nearest(from)
  const b = nearest(to)
  const covered = stream.slice(Math.min(a, b), Math.max(a, b) + 1)
  const indices = covered.map((w) => w.wordIndex)
  return {
    quote: covered
      .slice(0, QUOTE_MAX_WORDS)
      .map((w) => w.t)
      .join(' '),
    wordStart: Math.min(...indices),
    wordEnd: Math.max(...indices),
  }
}

/** Where a highlight's anchor sits: the first word's x and its line's centre. Null when unbound. */
export function highlightPoint(layer: WordLayer, text: TextAnchor): Point | null {
  const word = text.wordStart >= 0 ? layer.words[text.wordStart] : undefined
  if (!word) return null
  const line = layer.lines.findIndex((l) => l.includes(text.wordStart))
  return { x: word.x, y: line >= 0 ? lineCentreY(layer, line) : word.y + word.h / 2 }
}

/** One rectangle per line the range covers, from the page's word boxes, in reading order. */
export function highlightBoxes(layer: WordLayer, text: TextAnchor): Box[] {
  if (text.wordStart < 0) return []
  const lineOf = new Map<number, number>()
  layer.lines.forEach((indices, line) => {
    for (const i of indices) lineOf.set(i, line)
  })
  const byLine = new Map<number, Box>()
  for (let i = text.wordStart; i <= Math.min(text.wordEnd, layer.words.length - 1); i++) {
    const word = layer.words[i]
    if (!word) continue
    // A word on no line stands alone.
    const key = lineOf.get(i) ?? -1 - i
    const box = byLine.get(key)
    if (!box) {
      byLine.set(key, { x: word.x, y: word.y, w: word.w, h: word.h })
      continue
    }
    const right = Math.max(box.x + box.w, word.x + word.w)
    const top = Math.max(box.y + box.h, word.y + word.h)
    box.x = Math.min(box.x, word.x)
    box.y = Math.min(box.y, word.y)
    box.w = right - box.x
    box.h = top - box.y
  }
  return [...byLine.values()]
}
