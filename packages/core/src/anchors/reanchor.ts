import { type Anchor, type AnchorStatus, isCaretMark, markOf, type WordLayer } from '@binder/shared'
import { caretX, clampOffset } from '../markup/caret'
import {
  anchorAtMatch,
  buildWordStream,
  findQuote,
  normaliseForMatch,
  type QuoteMatch,
  type StreamWord,
} from './quote'
import { lineCentreY } from './snap'
import type { VersionText } from './types'

/** Words either side of a match compared to tell one copy of a repeated quote from another. */
const CONTEXT_WORDS = 8

const SEVERITY: Record<AnchorStatus, number> = { ok: 0, approximate: 1, unresolved: 2 }

const worse = (a: AnchorStatus, b: AnchorStatus): AnchorStatus =>
  SEVERITY[a] >= SEVERITY[b] ? a : b

const finite = (n: number): number => (Number.isFinite(n) ? n : 0)

/** Fraction of the page height below the top edge; 0 when the height is unknown. */
const fromTop = (y: number, height: number | null | undefined): number =>
  height && height > 0 ? (height - y) / height : 0

const rel = (pageIndex: number, y: number, height: number | null | undefined, pageCount: number) =>
  (pageIndex + fromTop(y, height)) / Math.max(1, pageCount)

interface Target {
  to: VersionText
  stream: StreamWord[]
}

/** Spec 5.4 positional fallback and match placement share this clamp. */
function clampTo(
  a: { pageIndex: number; x: number; y: number },
  from: VersionText,
  to: VersionText,
  sourcePageIndex: number,
): { x: number; y: number } {
  const target = to.pages[a.pageIndex]
  const source = from.pages[sourcePageIndex]
  const width = target?.width ?? source?.width ?? null
  const height = target?.height ?? source?.height ?? null
  const x = finite(a.x)
  const y = finite(a.y)
  return {
    x: width === null ? x : Math.min(Math.max(x, 0), width),
    y: height === null ? y : Math.min(Math.max(y, 0), height),
  }
}

/** x of the first word of the old line holding word `wordStart`, or null when unknown. */
function oldLineLeft(from: VersionText, a: Anchor): number | null {
  const wordStart = a.text?.wordStart
  if (wordStart === undefined || wordStart < 0) return null
  const layer = from.layers.get(a.pageIndex) as WordLayer | undefined
  const line = layer?.lines.find((indices) => indices.includes(wordStart))
  if (!layer || !line) return null
  for (const i of line) {
    const w = layer.words[i]
    if (w) return w.x
  }
  return null
}

/** The match nearest the anchor's relative position in the document; the earliest on a tie. */
function closest(
  ms: QuoteMatch[],
  a: Anchor,
  from: VersionText,
  { to, stream }: Target,
): QuoteMatch {
  const want = rel(a.pageIndex, a.y, from.pages[a.pageIndex]?.height, from.pageCount)
  let best = ms[0] as QuoteMatch
  let bestDistance = Number.POSITIVE_INFINITY
  for (const m of ms) {
    const w = stream[m.start] as StreamWord
    const layer = to.layers.get(w.pageIndex) as WordLayer
    const got = rel(
      w.pageIndex,
      lineCentreY(layer, w.lineIndex),
      to.pages[w.pageIndex]?.height,
      to.pageCount,
    )
    const distance = Math.abs(got - want)
    if (distance < bestDistance) {
      best = m
      bestDistance = distance
    }
  }
  return best
}

/**
 * The anchor placed on match `m`. The matched range is the whole quote (not capped at eight words);
 * the stored quote is kept. A character offset is clamped to the new word and, for a line or pointer
 * mark, `x` is that caret's x (the stored x is the bar's x) instead of the old line-relative x.
 */
function place(
  a: Anchor,
  m: QuoteMatch,
  status: AnchorStatus,
  from: VersionText,
  { to, stream }: Target,
): Anchor {
  const p = anchorAtMatch(stream, m, to, Number.POSITIVE_INFINITY)
  const left = oldLineLeft(from, a)
  let x = left === null ? p.x : p.lineLeft + (a.x - left)
  const text = a.text as NonNullable<Anchor['text']>
  const placed: NonNullable<Anchor['text']> = {
    quote: text.quote,
    wordStart: p.text.wordStart,
    wordEnd: p.text.wordEnd,
  }
  if (text.offset !== undefined) {
    const word = to.layers.get(p.pageIndex)?.words[p.text.wordStart]
    if (word) {
      placed.offset = clampOffset(word.t, text.offset)
      if (isCaretMark(markOf(a))) x = caretX(word, placed.offset)
    }
  }
  return {
    ...a,
    documentVersionId: to.versionId,
    pageIndex: p.pageIndex,
    ...clampTo({ pageIndex: p.pageIndex, x, y: p.y }, from, to, a.pageIndex),
    text: placed,
    status,
  }
}

/**
 * Whether a highlight's stored range covered more words than its stored quote: the quote was cut at
 * the character limit. Measured in the old word stream (reading order), not by word index, because
 * layer indices are not guaranteed to follow reading order. False when the range cannot be located.
 */
function highlightWasCut(a: Anchor, fromStream: StreamWord[]): boolean {
  const text = a.text
  if (markOf(a) !== 'highlight' || !text) return false
  const at = (wordIndex: number): number =>
    fromStream.findIndex((w) => w.pageIndex === a.pageIndex && w.wordIndex === wordIndex)
  const first = at(text.wordStart)
  const last = at(text.wordEnd)
  if (first < 0 || last < first) return false
  return last - first + 1 > text.quote.split(/\s+/).filter((t) => t !== '').length
}

function positional(a: Anchor, from: VersionText, to: VersionText): Anchor {
  let pageIndex: number
  let fallback: AnchorStatus
  if (a.pageIndex >= to.pageCount) {
    pageIndex = to.pageCount - 1
    fallback = 'unresolved'
  } else {
    pageIndex = a.pageIndex
    fallback = to.pageCount === from.pageCount ? 'approximate' : 'unresolved'
  }
  pageIndex = Math.max(0, pageIndex)
  const out: Anchor = {
    ...a,
    documentVersionId: to.versionId,
    pageIndex,
    ...clampTo({ pageIndex, x: a.x, y: a.y }, from, to, a.pageIndex),
    status: worse(fallback, a.status),
  }
  if (a.text) out.text = { quote: a.text.quote, wordStart: -1, wordEnd: -1 }
  return out
}

/** The old version's word stream, built on first use; empty when it cannot be built. */
function lazyStream(version: VersionText): () => StreamWord[] {
  let stream: StreamWord[] | undefined
  return () => {
    if (!stream) {
      try {
        stream = buildWordStream(version.layers)
      } catch {
        stream = []
      }
    }
    return stream
  }
}

/** The normalised words nearest the match on each side, nearest first. */
function contextOf(stream: StreamWord[], m: QuoteMatch): { before: string[]; after: string[] } {
  const side = (start: number, step: 1 | -1): string[] => {
    const out: string[] = []
    for (let i = start; i >= 0 && i < stream.length && out.length < CONTEXT_WORDS; i += step) {
      const norm = normaliseForMatch((stream[i] as StreamWord).t)
      if (norm !== '') out.push(norm)
    }
    return out
  }
  return { before: side(m.start - 1, -1), after: side(m.end + 1, 1) }
}

/** How many words, nearest first, the two lists share before they first differ. */
function commonRun(x: string[], y: string[]): number {
  let n = 0
  while (n < x.length && n < y.length && x[n] === y[n]) n++
  return n
}

/**
 * Whether `survivor`, the one exact match left in the new text, is the copy of the quote that `a` was
 * on. A quote that was unique in the old text has nothing to tell apart. Otherwise the anchor sat on one
 * of several copies, and the survivor counts as that copy only when its surrounding words match it
 * better than they match every other old copy; a tie, or no shared words, cannot be told and is false.
 */
function survivorIsAnchored(
  a: Anchor,
  survivor: QuoteMatch,
  from: VersionText,
  fromStream: StreamWord[],
  target: Target,
): boolean {
  const copies = findQuote(fromStream, (a.text as NonNullable<Anchor['text']>).quote, 'exact')
  if (copies.length < 2) return true
  let anchored = copies.findIndex((c) => {
    const w = fromStream[c.start] as StreamWord
    return w.pageIndex === a.pageIndex && w.wordIndex === a.text?.wordStart
  })
  if (anchored < 0) {
    anchored = copies.indexOf(closest(copies, a, from, { to: from, stream: fromStream }))
  }
  const now = contextOf(target.stream, survivor)
  const scores = copies.map((c) => {
    const then = contextOf(fromStream, c)
    return commonRun(then.before, now.before) + commonRun(then.after, now.after)
  })
  const best = Math.max(...scores)
  return best > 0 && scores[anchored] === best && scores.filter((s) => s === best).length === 1
}

function reanchorWith(
  a: Anchor,
  from: VersionText,
  fromStream: () => StreamWord[],
  target: Target,
): Anchor {
  if (a.text?.quote) {
    for (const mode of ['exact', 'normalised'] as const) {
      const ms = findQuote(target.stream, a.text.quote, mode)
      if (ms.length === 1) {
        const m = ms[0] as QuoteMatch
        const sure =
          mode === 'exact' &&
          survivorIsAnchored(a, m, from, fromStream(), target) &&
          !highlightWasCut(a, fromStream())
        return place(a, m, sure ? 'ok' : 'approximate', from, target)
      }
      if (ms.length > 1) {
        return place(a, closest(ms, a, from, target), 'approximate', from, target)
      }
    }
  }
  return positional(a, from, target.to)
}

/** One anchor, never throwing: a failure while matching falls back to the positional result. */
function reanchorSafely(
  a: Anchor,
  from: VersionText,
  fromStream: () => StreamWord[],
  target: Target,
): Anchor {
  try {
    return reanchorWith(a, from, fromStream, target)
  } catch {
    try {
      return { ...positional(a, from, target.to), status: 'unresolved' }
    } catch {
      const out: Anchor = {
        ...a,
        documentVersionId: target.to.versionId,
        pageIndex: Math.max(0, Math.min(a.pageIndex, target.to.pageCount - 1)),
        status: 'unresolved',
      }
      if (a.text) out.text = { quote: a.text.quote, wordStart: -1, wordEnd: -1 }
      return out
    }
  }
}

function targetOf(to: VersionText): Target {
  try {
    return { to, stream: buildWordStream(to.layers) }
  } catch {
    return { to, stream: [] } // every anchor then falls back by position
  }
}

/**
 * Moves one anchor from version `from` to version `to` (spec 5.4): its quote is found in the new
 * text (exact: ok; normalised or several matches: approximate), otherwise it falls back to its page
 * position and is approximate (same page count) or unresolved. A quote that appeared several times
 * in `from` and has one exact match left is ok only when that match is the copy the anchor was on.
 * Never throws.
 */
export function reanchor(anchor: Anchor, from: VersionText, to: VersionText): Anchor {
  return reanchorSafely(anchor, from, lazyStream(from), targetOf(to))
}

/** `reanchor` for many anchors, building the target word stream once. Same length and order out as in. */
export function reanchorAll(anchors: Anchor[], from: VersionText, to: VersionText): Anchor[] {
  const target = targetOf(to)
  const fromStream = lazyStream(from)
  return anchors.map((a) => reanchorSafely(a, from, fromStream, target))
}
