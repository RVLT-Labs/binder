import {
  QUOTE_MAX_CHARS,
  QUOTE_MAX_WORDS,
  SNAP_DISTANCE_PT,
  type TextAnchor,
  type WordLayer,
} from '@binder/shared'

/** Mean of `y + h / 2` over the line's words; NaN for a line with no words. */
export function lineCentreY(layer: WordLayer, lineIndex: number): number {
  const line = layer.lines[lineIndex] ?? []
  let sum = 0
  let n = 0
  for (const i of line) {
    const w = layer.words[i]
    if (!w) continue
    sum += w.y + w.h / 2
    n++
  }
  return n === 0 ? Number.NaN : sum / n
}

/** The line whose centre is nearest `y` within `maxDistance`, or null. */
export function nearestLine(
  layer: WordLayer,
  y: number,
  maxDistance = SNAP_DISTANCE_PT,
): { lineIndex: number; centre: number; distance: number } | null {
  let best: { lineIndex: number; centre: number; distance: number } | null = null
  for (let lineIndex = 0; lineIndex < layer.lines.length; lineIndex++) {
    const centre = lineCentreY(layer, lineIndex)
    if (Number.isNaN(centre)) continue
    const distance = Math.abs(centre - y)
    if (distance <= maxDistance && (!best || distance < best.distance)) {
      best = { lineIndex, centre, distance }
    }
  }
  return best
}

/**
 * Spec 5.2 snapping: the line whose centre is nearest `point.y` within `maxDistance`, with the text
 * anchor taken from the word nearest `point.x` forward to the line end, up to eight words. `x` is
 * not snapped. Null when no line is close enough. With `firstWordOutside` (a cue dropped by its
 * margin tag) a point outside the line's horizontal extent starts at the line's first word instead
 * of the nearest one.
 */
export function snapToLine(
  layer: WordLayer,
  point: { x: number; y: number },
  maxDistance = SNAP_DISTANCE_PT,
  options: { firstWordOutside?: boolean } = {},
): { y: number; text: TextAnchor } | null {
  const best = nearestLine(layer, point.y, maxDistance)
  if (!best) return null

  const line = (layer.lines[best.lineIndex] ?? []).filter((i) => layer.words[i])
  let nearest = 0
  let nearestDx = Number.POSITIVE_INFINITY
  const extent = line.map((i) => layer.words[i] as { x: number; w: number })
  const outside =
    point.x < Math.min(...extent.map((w) => w.x)) ||
    point.x > Math.max(...extent.map((w) => w.x + w.w))
  if (!(options.firstWordOutside && outside)) {
    line.forEach((wordIndex, pos) => {
      const w = layer.words[wordIndex]
      if (!w) return
      const dx = point.x < w.x ? w.x - point.x : point.x > w.x + w.w ? point.x - (w.x + w.w) : 0
      if (dx < nearestDx) {
        nearestDx = dx
        nearest = pos
      }
    })
  }
  const picked = line.slice(nearest, nearest + QUOTE_MAX_WORDS)
  const first = picked[0] as number
  const last = picked.at(-1) as number
  return {
    y: best.centre,
    text: {
      quote: picked.map((i) => (layer.words[i] as { t: string }).t).join(' '),
      wordStart: first,
      wordEnd: last,
    },
  }
}

/**
 * The words joined with spaces, cut on a word boundary so the result is at most `QUOTE_MAX_CHARS`.
 * The first word is always kept, even when it alone is longer.
 */
export function cutQuote(words: readonly string[]): string {
  let out = ''
  for (let i = 0; i < words.length; i++) {
    const next = i === 0 ? (words[0] as string) : `${out} ${words[i]}`
    if (i > 0 && next.length > QUOTE_MAX_CHARS) break
    out = next
  }
  return out
}

/** The text anchor for a range of words (indices in either order); the quote is the whole range, cut. */
export function rangeText(layer: WordLayer, from: number, to: number): TextAnchor {
  const wordStart = Math.min(from, to)
  const wordEnd = Math.max(from, to)
  const texts: string[] = []
  for (let i = wordStart; i <= wordEnd; i++) {
    const w = layer.words[i]
    if (w) texts.push(w.t)
  }
  return { quote: cutQuote(texts), wordStart, wordEnd }
}

/**
 * The line nearest `point.y` within `maxDistance`, then the word nearest `point.x`, as a one-word
 * range. `x` is the word's left edge. Null when no line is close enough.
 */
export function snapToWord(
  layer: WordLayer,
  point: { x: number; y: number },
  maxDistance = SNAP_DISTANCE_PT,
): { x: number; y: number; text: TextAnchor } | null {
  const best = nearestLine(layer, point.y, maxDistance)
  if (!best) return null
  let pick = -1
  let pickDx = Number.POSITIVE_INFINITY
  for (const i of layer.lines[best.lineIndex] ?? []) {
    const w = layer.words[i]
    if (!w) continue
    const dx = point.x < w.x ? w.x - point.x : point.x > w.x + w.w ? point.x - (w.x + w.w) : 0
    if (dx < pickDx) {
      pickDx = dx
      pick = i
    }
  }
  const word = layer.words[pick]
  if (!word) return null
  return { x: word.x, y: best.centre, text: rangeText(layer, pick, pick) }
}

/**
 * The line nearest `point.y` within `maxDistance`, the word nearest `point.x` on it (the first or
 * last word when the point is outside the line), then `wordCount` words from there by layer index,
 * stopping at the layer's last word. `x` is the first word's left edge and `y` the line's centre.
 * Null when no line is close enough. Moving a cue's mark by dragging it uses this so a range keeps
 * its length.
 */
export function snapRange(
  layer: WordLayer,
  point: { x: number; y: number },
  wordCount: number,
  maxDistance = SNAP_DISTANCE_PT,
): { x: number; y: number; text: TextAnchor } | null {
  const start = snapToWord(layer, point, maxDistance)
  if (!start) return null
  const first = start.text.wordStart
  const last = Math.min(
    first + (Number.isFinite(wordCount) ? Math.max(1, Math.floor(wordCount)) : 1) - 1,
    layer.words.length - 1,
  )
  return { x: start.x, y: start.y, text: rangeText(layer, first, last) }
}
