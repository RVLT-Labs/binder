import type { TextAnchor, WordLayer } from '@binder/shared'
import type { Box } from './markers'

/** One rectangle per line the range covers, from the page's word boxes, in reading order. */
export function wordBoxes(layer: WordLayer, text: TextAnchor): Box[] {
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
