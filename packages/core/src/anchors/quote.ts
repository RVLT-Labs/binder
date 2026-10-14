import { QUOTE_MAX_WORDS, type TextAnchor, type WordLayer } from '@binder/shared'
import { normaliseToken } from '../search/normalise'
import { lineCentreY } from './snap'
import type { VersionText } from './types'

export interface StreamWord {
  pageIndex: number
  wordIndex: number
  lineIndex: number
  t: string
}

/** Inclusive indices into the word stream. */
export interface QuoteMatch {
  start: number
  end: number
}

const NON_ALNUM = /[^\p{L}\p{N}]/gu

/** `normaliseToken`, then every character outside letters and numbers removed. */
export function normaliseForMatch(t: string): string {
  return normaliseToken(t).replace(NON_ALNUM, '')
}

/**
 * Every word of a version in reading order: pages ascending; within a page lines top to bottom
 * (descending centre, ties by the first word's x); words in line order. Lines with no words are skipped.
 */
export function buildWordStream(layers: ReadonlyMap<number, WordLayer>): StreamWord[] {
  const out: StreamWord[] = []
  for (const pageIndex of [...layers.keys()].sort((a, b) => a - b)) {
    const layer = layers.get(pageIndex) as WordLayer
    const lines = layer.lines
      .map((indices, lineIndex) => ({
        lineIndex,
        indices: indices.filter((i) => layer.words[i]),
        centre: lineCentreY(layer, lineIndex),
      }))
      .filter((l) => l.indices.length > 0)
      .sort(
        (a, b) =>
          b.centre - a.centre ||
          (layer.words[a.indices[0] as number]?.x ?? 0) -
            (layer.words[b.indices[0] as number]?.x ?? 0),
      )
    for (const line of lines) {
      for (const wordIndex of line.indices) {
        out.push({
          pageIndex,
          wordIndex,
          lineIndex: line.lineIndex,
          t: (layer.words[wordIndex] as { t: string }).t,
        })
      }
    }
  }
  return out
}

const tokensOf = (quote: string): string[] => quote.split(/\s+/).filter((t) => t !== '')

function findExact(stream: StreamWord[], tokens: string[]): QuoteMatch[] {
  const out: QuoteMatch[] = []
  for (let i = 0; i + tokens.length <= stream.length; i++) {
    if (tokens.every((t, k) => stream[i + k]?.t === t))
      out.push({ start: i, end: i + tokens.length - 1 })
  }
  return out
}

interface Unit {
  norm: string
  start: number
  end: number
}

/** Normalised tokens of the stream; a hyphenated line end joins with the next word. */
function unitsOf(stream: StreamWord[]): Unit[] {
  const units: Unit[] = []
  for (let i = 0; i < stream.length; i++) {
    const w = stream[i] as StreamWord
    const next = stream[i + 1]
    const endsLine = !next || next.pageIndex !== w.pageIndex || next.lineIndex !== w.lineIndex
    if (next && endsLine && w.t.endsWith('-')) {
      const norm = normaliseForMatch(w.t) + normaliseForMatch(next.t)
      if (norm !== '') units.push({ norm, start: i, end: i + 1 })
      i++
      continue
    }
    const norm = normaliseForMatch(w.t)
    if (norm !== '') units.push({ norm, start: i, end: i })
  }
  return units
}

function findNormalised(stream: StreamWord[], rawTokens: string[]): QuoteMatch[] {
  const kept = rawTokens
    .map((raw) => ({ raw, norm: normaliseForMatch(raw) }))
    .filter((t) => t.norm !== '')
  if (kept.length === 0) return []
  const prefix = (kept.at(-1) as { raw: string }).raw.endsWith('-')
  const units = unitsOf(stream)
  const out: QuoteMatch[] = []
  for (let i = 0; i + kept.length <= units.length; i++) {
    const ok = kept.every((t, k) => {
      const unit = units[i + k] as Unit
      return prefix && k === kept.length - 1 ? unit.norm.startsWith(t.norm) : unit.norm === t.norm
    })
    if (ok) {
      out.push({
        start: (units[i] as Unit).start,
        end: (units[i + kept.length - 1] as Unit).end,
      })
    }
  }
  return out
}

/** Every occurrence of `quote` in the stream, in stream order. */
export function findQuote(
  stream: StreamWord[],
  quote: string,
  mode: 'exact' | 'normalised',
): QuoteMatch[] {
  const tokens = tokensOf(quote)
  if (tokens.length === 0) return []
  return mode === 'exact' ? findExact(stream, tokens) : findNormalised(stream, tokens)
}

/** Where a cue for the match sits: the first word's page, x and line centre, plus its text anchor. */
export function anchorAtMatch(
  stream: StreamWord[],
  m: QuoteMatch,
  to: VersionText,
): { pageIndex: number; x: number; y: number; lineLeft: number; text: TextAnchor } {
  const first = stream[m.start] as StreamWord
  const layer = to.layers.get(first.pageIndex) as WordLayer
  const matched = stream.slice(m.start, Math.min(m.end, m.start + QUOTE_MAX_WORDS - 1) + 1)
  const onStartPage = matched.filter((w) => w.pageIndex === first.pageIndex)
  const line = layer.lines[first.lineIndex] ?? []
  const lineFirst = layer.words[line[0] as number]
  return {
    pageIndex: first.pageIndex,
    x: (layer.words[first.wordIndex] as { x: number }).x,
    y: lineCentreY(layer, first.lineIndex),
    lineLeft: lineFirst?.x ?? (layer.words[first.wordIndex] as { x: number }).x,
    text: {
      quote: matched.map((w) => w.t).join(' '),
      wordStart: first.wordIndex,
      wordEnd: (onStartPage.at(-1) as StreamWord).wordIndex,
    },
  }
}
