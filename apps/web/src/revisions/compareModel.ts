import {
  type Box,
  diffVersionLinesBounded,
  type LineDiff,
  type LineDiffEntry,
  type VersionText,
} from '@binder/core'
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

/**
 * The most lines two versions may differ by for the line diff to run: a few seconds of work at most
 * for a full-length libretto, where a near-total rewrite would otherwise hold the main thread.
 */
export const MAX_COMPARE_EDITS = 2000

export type CompareOutcome =
  | { kind: 'diff'; diff: LineDiff }
  | { kind: 'too-many' }
  | { kind: 'incomplete'; unavailable: number }

/**
 * The comparison of two versions' text: the diff, or why there is none. A page whose text could not
 * be read makes the whole comparison incomplete (a diff would show that page as removed or added).
 */
export function compareTexts(
  old: { text: VersionText; unavailable: number },
  next: { text: VersionText; unavailable: number },
  maxEdits = MAX_COMPARE_EDITS,
): CompareOutcome {
  const unavailable = old.unavailable + next.unavailable
  if (unavailable > 0) return { kind: 'incomplete', unavailable }
  const diff = diffVersionLinesBounded(old.text, next.text, maxEdits)
  return diff ? { kind: 'diff', diff } : { kind: 'too-many' }
}

export const incompleteMessage = (n: number): string =>
  `${n} ${n === 1 ? 'page has' : 'pages have'} no text available offline, so the comparison is incomplete.`

export const TOO_MANY_MESSAGE = 'Too many changes to compare line by line.'
