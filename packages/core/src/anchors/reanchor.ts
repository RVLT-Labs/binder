import type { Anchor, AnchorStatus, WordLayer } from '@binder/shared'
import {
  anchorAtMatch,
  buildWordStream,
  findQuote,
  type QuoteMatch,
  type StreamWord,
} from './quote'
import { lineCentreY } from './snap'
import type { VersionText } from './types'

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

function place(
  a: Anchor,
  m: QuoteMatch,
  status: AnchorStatus,
  from: VersionText,
  { to, stream }: Target,
): Anchor {
  const p = anchorAtMatch(stream, m, to)
  const left = oldLineLeft(from, a)
  const x = left === null ? p.x : p.lineLeft + (a.x - left)
  const text = a.text as NonNullable<Anchor['text']>
  return {
    ...a,
    documentVersionId: to.versionId,
    pageIndex: p.pageIndex,
    ...clampTo({ pageIndex: p.pageIndex, x, y: p.y }, from, to, a.pageIndex),
    text: { quote: text.quote, wordStart: p.text.wordStart, wordEnd: p.text.wordEnd },
    status,
  }
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

function reanchorWith(a: Anchor, from: VersionText, target: Target): Anchor {
  if (a.text?.quote) {
    for (const mode of ['exact', 'normalised'] as const) {
      const ms = findQuote(target.stream, a.text.quote, mode)
      if (ms.length === 1) {
        return place(a, ms[0] as QuoteMatch, mode === 'exact' ? 'ok' : 'approximate', from, target)
      }
      if (ms.length > 1) {
        return place(a, closest(ms, a, from, target), 'approximate', from, target)
      }
    }
  }
  return positional(a, from, target.to)
}

/**
 * Moves one anchor from version `from` to version `to` (spec 5.4): its quote is found in the new
 * text (exact: ok; normalised or several matches: approximate), otherwise it falls back to its page
 * position and is approximate (same page count) or unresolved. Never throws for a malformed anchor.
 */
export function reanchor(anchor: Anchor, from: VersionText, to: VersionText): Anchor {
  return reanchorWith(anchor, from, { to, stream: buildWordStream(to.layers) })
}

/** `reanchor` for many anchors, building the target word stream once. Same length and order out as in. */
export function reanchorAll(anchors: Anchor[], from: VersionText, to: VersionText): Anchor[] {
  const target = { to, stream: buildWordStream(to.layers) }
  return anchors.map((a) => reanchorWith(a, from, target))
}
