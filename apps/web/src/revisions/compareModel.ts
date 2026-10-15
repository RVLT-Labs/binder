import type { Box, LineDiffEntry } from '@binder/core'
import type { WordLayer } from '@binder/shared'

export interface Change {
  /** Position in the diff's entries. */
  index: number
  op: 'added' | 'removed'
  text: string
  /** The zero-based pages to show on each side to see this change. */
  oldPage: number
  newPage: number
  oldLine?: number
  newLine?: number
}

/**
 * Where the other side of a change is: the page of the nearest unchanged line before it (else after
 * it) on that side, else the first page.
 */
function counterpart(entries: readonly LineDiffEntry[], at: number, side: 'old' | 'new'): number {
  for (let j = at - 1; j >= 0; j--) {
    const e = entries[j]
    if (e?.op === 'same' && e[side]) return e[side].pageIndex
  }
  for (let j = at + 1; j < entries.length; j++) {
    const e = entries[j]
    if (e?.op === 'same' && e[side]) return e[side].pageIndex
  }
  return 0
}

/** The diff's changed lines in order, each with the pages that show it on both sides. */
export function changeList(entries: readonly LineDiffEntry[]): Change[] {
  const out: Change[] = []
  entries.forEach((e, index) => {
    if (e.op === 'same') return
    out.push({
      index,
      op: e.op,
      text: e.text,
      oldPage: e.old ? e.old.pageIndex : counterpart(entries, index, 'old'),
      newPage: e.new ? e.new.pageIndex : counterpart(entries, index, 'new'),
      oldLine: e.old?.lineIndex,
      newLine: e.new?.lineIndex,
    })
  })
  return out
}

/** The rectangle covering a line's words, or null when the page has no such line. */
export function lineBox(layer: WordLayer, lineIndex: number): Box | null {
  const indices = layer.lines[lineIndex]
  if (!indices || indices.length === 0) return null
  let left = Number.POSITIVE_INFINITY
  let bottom = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.NEGATIVE_INFINITY
  for (const i of indices) {
    const w = layer.words[i]
    if (!w) continue
    left = Math.min(left, w.x)
    bottom = Math.min(bottom, w.y)
    right = Math.max(right, w.x + w.w)
    top = Math.max(top, w.y + w.h)
  }
  if (!Number.isFinite(left)) return null
  return { x: left, y: bottom, w: right - left, h: top - bottom }
}

/**
 * The lines to tint on one side: the removed lines on the old version, the added ones on the new,
 * by zero-based page.
 */
export function tintedLines(
  entries: readonly LineDiffEntry[],
  side: 'old' | 'new',
): Map<number, Array<{ lineIndex: number }>> {
  const op = side === 'old' ? 'removed' : 'added'
  const out = new Map<number, Array<{ lineIndex: number }>>()
  for (const e of entries) {
    const ref = e.op === op ? e[side] : undefined
    if (!ref) continue
    const list = out.get(ref.pageIndex)
    if (list) list.push({ lineIndex: ref.lineIndex })
    else out.set(ref.pageIndex, [{ lineIndex: ref.lineIndex }])
  }
  return out
}
