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

export interface Hunk {
  /** The changes in it, in order: lines changed one after another. */
  changes: Change[]
  removed: number
  added: number
  /** "p.9–10 — 16 lines cut": what and where, for the card's title. */
  title: string
  /** "v1 p.9–10": the page on each side it is on. */
  meta: string
  /** The zero-based pages to show on each side for its first line. */
  oldPage: number
  newPage: number
  /** The first change's position in the diff's entries. */
  firstIndex: number
}

const lines = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`

/** `p.9` or `p.9–10` from zero-based page numbers. */
function pageRange(pages: number[]): string {
  const lo = Math.min(...pages) + 1
  const hi = Math.max(...pages) + 1
  return lo === hi ? `p.${lo}` : `p.${lo}–${hi}`
}

/**
 * The change list as the mockup draws it: changes that sit next to each other in the diff are one
 * card ("p.9–10 — 16 lines cut", "p.12 — 2 lines added", "p.23 — 1 line reworded"), not a card per
 * line.
 */
export function changeHunks(changes: readonly Change[]): Hunk[] {
  const groups: Change[][] = []
  for (const c of changes) {
    const last = groups[groups.length - 1]
    if (last && last[last.length - 1].index + 1 === c.index) last.push(c)
    else groups.push([c])
  }
  return groups.map((group) => {
    const cut = group.filter((c) => c.op === 'removed')
    const added = group.filter((c) => c.op === 'added')
    const oldPages = cut.map((c) => c.oldPage)
    const newPages = added.map((c) => c.newPage)
    let title: string
    let meta: string
    if (added.length === 0) {
      title = `${pageRange(oldPages)} — ${lines(cut.length)} cut`
      meta = `v1 ${pageRange(oldPages)}`
    } else if (cut.length === 0) {
      title = `${pageRange(newPages)} — ${lines(added.length)} added`
      meta = `v2 ${pageRange(newPages)}`
    } else {
      title =
        cut.length === added.length
          ? `${pageRange(oldPages)} — ${lines(cut.length)} reworded`
          : `${pageRange(oldPages)} — ${cut.length} cut, ${added.length} added`
      meta = `v1 ${pageRange(oldPages)} → v2 ${pageRange(newPages)}`
    }
    return {
      changes: group,
      removed: cut.length,
      added: added.length,
      title,
      meta,
      oldPage: group[0].oldPage,
      newPage: group[0].newPage,
      firstIndex: group[0].index,
    }
  })
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

export interface TintBand extends Box {
  /** How many lines run together in it (the "−6" in the margin). */
  count: number
}

/** Runs of consecutive tinted lines on a page, each as the box covering them and how many there are. */
export function tintBands(
  layer: WordLayer,
  lines: ReadonlyArray<{ lineIndex: number }>,
): TintBand[] {
  const sorted = [...lines].map((l) => l.lineIndex).sort((a, b) => a - b)
  const bands: Array<TintBand & { last: number }> = []
  for (const lineIndex of sorted) {
    const box = lineBox(layer, lineIndex)
    if (!box) continue
    const band = bands[bands.length - 1]
    if (band && band.last === lineIndex - 1) {
      const left = Math.min(band.x, box.x)
      const bottom = Math.min(band.y, box.y)
      band.w = Math.max(band.x + band.w, box.x + box.w) - left
      band.h = Math.max(band.y + band.h, box.y + box.h) - bottom
      band.x = left
      band.y = bottom
      band.count += 1
      band.last = lineIndex
    } else {
      bands.push({ ...box, count: 1, last: lineIndex })
    }
  }
  return bands.map(({ last: _last, ...band }) => band)
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
