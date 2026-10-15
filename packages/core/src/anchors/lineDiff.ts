import { diffArrays } from 'diff'
import { buildWordStream, normaliseForMatch, type StreamWord } from './quote'
import type { VersionText } from './types'

export interface LineRef {
  pageIndex: number
  lineIndex: number
}

export type LineDiffEntry = {
  op: 'same' | 'added' | 'removed'
  /** The line's words, single-spaced; for `same`, as in the new version. */
  text: string
  old?: LineRef
  new?: LineRef
}

interface Line {
  ref: LineRef
  key: string
  text: string
}

/** The version's non-empty lines in stream order, each with its comparison key. */
function linesOf(version: VersionText): Line[] {
  const out: Line[] = []
  let current: { line: Line; words: string[]; keys: string[] } | null = null
  const flush = () => {
    if (!current) return
    current.line.text = current.words.join(' ')
    current.line.key = current.keys.join(' ')
    out.push(current.line)
    current = null
  }
  for (const w of buildWordStream(version.layers) as StreamWord[]) {
    if (
      !current ||
      current.line.ref.pageIndex !== w.pageIndex ||
      current.line.ref.lineIndex !== w.lineIndex
    ) {
      flush()
      current = {
        line: { ref: { pageIndex: w.pageIndex, lineIndex: w.lineIndex }, key: '', text: '' },
        words: [],
        keys: [],
      }
    }
    current.words.push(w.t)
    const norm = normaliseForMatch(w.t)
    if (norm !== '') current.keys.push(norm)
  }
  flush()
  return out
}

/**
 * A line diff between two versions: lines in stream order, compared by their normalised tokens joined by
 * spaces, so case and punctuation changes are not differences.
 */
export function diffVersionLines(from: VersionText, to: VersionText): LineDiff {
  // Without a bound the diff always finishes.
  return diffLines(from, to, undefined) as LineDiff
}

/**
 * `diffVersionLines` that gives up (returns `undefined`) when the versions differ by more than
 * `maxEditLength` lines, so a near-total rewrite of a long script cannot hold the thread for seconds.
 */
export function diffVersionLinesBounded(
  from: VersionText,
  to: VersionText,
  maxEditLength: number,
): LineDiff | undefined {
  return diffLines(from, to, maxEditLength)
}

export interface LineDiff {
  entries: LineDiffEntry[]
  added: number
  removed: number
}

function diffLines(
  from: VersionText,
  to: VersionText,
  maxEditLength: number | undefined,
): LineDiff | undefined {
  const a = linesOf(from)
  const b = linesOf(to)
  const entries: LineDiffEntry[] = []
  let added = 0
  let removed = 0
  let i = 0
  let j = 0
  const oldKeys = a.map((l) => l.key)
  const newKeys = b.map((l) => l.key)
  const changes =
    maxEditLength === undefined
      ? diffArrays(oldKeys, newKeys)
      : diffArrays(oldKeys, newKeys, { maxEditLength })
  if (!changes) return undefined
  for (const change of changes) {
    const n = change.value.length
    for (let k = 0; k < n; k++) {
      if (change.added) {
        const l = b[j++] as Line
        entries.push({ op: 'added', text: l.text, new: l.ref })
        added++
      } else if (change.removed) {
        const l = a[i++] as Line
        entries.push({ op: 'removed', text: l.text, old: l.ref })
        removed++
      } else {
        const o = a[i++] as Line
        const l = b[j++] as Line
        entries.push({ op: 'same', text: l.text, old: o.ref, new: l.ref })
      }
    }
  }
  return { entries, added, removed }
}
