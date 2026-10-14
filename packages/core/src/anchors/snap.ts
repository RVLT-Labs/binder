import { QUOTE_MAX_WORDS, SNAP_DISTANCE_PT, type TextAnchor, type WordLayer } from '@binder/shared'

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

/**
 * Spec 5.2 snapping: the line whose centre is nearest `point.y` within `maxDistance`, with the text
 * anchor taken from the word nearest `point.x` forward to the line end, up to eight words. `x` is
 * not snapped. Null when no line is close enough.
 */
export function snapToLine(
  layer: WordLayer,
  point: { x: number; y: number },
  maxDistance = SNAP_DISTANCE_PT,
): { y: number; text: TextAnchor } | null {
  let best: { lineIndex: number; centre: number; distance: number } | null = null
  for (let lineIndex = 0; lineIndex < layer.lines.length; lineIndex++) {
    const centre = lineCentreY(layer, lineIndex)
    if (Number.isNaN(centre)) continue
    const distance = Math.abs(centre - point.y)
    if (distance <= maxDistance && (!best || distance < best.distance)) {
      best = { lineIndex, centre, distance }
    }
  }
  if (!best) return null

  const line = (layer.lines[best.lineIndex] ?? []).filter((i) => layer.words[i])
  let nearest = 0
  let nearestDx = Number.POSITIVE_INFINITY
  line.forEach((wordIndex, pos) => {
    const w = layer.words[wordIndex]
    if (!w) return
    const dx = point.x < w.x ? w.x - point.x : point.x > w.x + w.w ? point.x - (w.x + w.w) : 0
    if (dx < nearestDx) {
      nearestDx = dx
      nearest = pos
    }
  })
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
