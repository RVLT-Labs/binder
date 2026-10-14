import type { WordLayer } from '@binder/shared'

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * A word layer in a compact form for agents: each word as `[text, x, y, w, h]` with the box in
 * displayed page space (PDF points, origin bottom-left) rounded to 0.1 pt, `lines` as word-index
 * lists in reading order, and `text` as the page's lines joined with newlines.
 */
export function compactWords(layer: WordLayer) {
  return {
    text: layer.lines.map((line) => line.map((i) => layer.words[i]?.t ?? '').join(' ')).join('\n'),
    words: layer.words.map(
      (w) => [w.t, round1(w.x), round1(w.y), round1(w.w), round1(w.h)] as const,
    ),
    lines: layer.lines,
  }
}
