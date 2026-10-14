import type { WordLayer } from '@binder/shared'
import { normaliseToken } from './normalise'

export interface Hit {
  lineIndex: number
  /** Inclusive indices into layer.words. */
  wordStart: number
  wordEnd: number
}

export interface DocHit extends Hit {
  pageIndex: number
  snippet: string
}

const CONTEXT_WORDS = 4

function queryTokens(query: string): string[] {
  return query
    .split(/\s+/)
    .map(normaliseToken)
    .filter((t) => t !== '')
}

export function searchWordLayer(layer: WordLayer, query: string): Hit[] {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return []
  const hits: Hit[] = []
  layer.lines.forEach((line, lineIndex) => {
    const cands: { index: number; norm: string }[] = []
    for (const index of line) {
      const word = layer.words[index]
      if (!word) continue
      const norm = normaliseToken(word.t)
      if (norm !== '') cands.push({ index, norm })
    }
    for (let i = 0; i + tokens.length <= cands.length; i++) {
      if (tokens.every((t, k) => cands[i + k]?.norm === t)) {
        hits.push({
          lineIndex,
          wordStart: cands[i]?.index ?? 0,
          wordEnd: cands[i + tokens.length - 1]?.index ?? 0,
        })
      }
    }
  })
  return hits
}

function snippetFor(layer: WordLayer, hit: Hit): string {
  const line = layer.lines[hit.lineIndex] ?? []
  const start = line.indexOf(hit.wordStart)
  const end = line.indexOf(hit.wordEnd)
  return line
    .slice(Math.max(0, start - CONTEXT_WORDS), end + CONTEXT_WORDS + 1)
    .map((i) => layer.words[i]?.t ?? '')
    .join(' ')
}

export function searchDocument(
  layers: Map<number, WordLayer>,
  query: string,
  limit = 200,
): DocHit[] {
  const out: DocHit[] = []
  const pages = [...layers.keys()].sort((a, b) => a - b)
  for (const pageIndex of pages) {
    const layer = layers.get(pageIndex)
    if (!layer) continue
    const hits = searchWordLayer(layer, query).sort(
      (a, b) => a.lineIndex - b.lineIndex || a.wordStart - b.wordStart,
    )
    for (const hit of hits) {
      if (out.length >= limit) return out
      out.push({ ...hit, pageIndex, snippet: snippetFor(layer, hit) })
    }
  }
  return out
}
