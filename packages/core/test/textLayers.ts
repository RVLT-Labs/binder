import type { WordLayer } from '@binder/shared'
import type { VersionText } from '../src/anchors/types'

export interface VersionFromLinesOptions {
  versionId: string
  linesPerPage?: number
  left?: number
  top?: number
  lineHeight?: number
  charWidth?: number
  width?: number
  height?: number
}

/**
 * A version built from lines of text: `linesPerPage` lines per page, each line `lineHeight` below the
 * previous one starting at `top`, words split on whitespace with deterministic boxes. A blank line keeps
 * its slot (an empty line row) so line numbers stay stable. Every page has a layer.
 */
export function versionFromLines(lines: string[], opts: VersionFromLinesOptions): VersionText {
  const {
    versionId,
    linesPerPage = 48,
    left = 72,
    top = 770,
    lineHeight = 14,
    charWidth = 6,
    width = 595,
    height = 842,
  } = opts
  const pageCount = Math.max(1, Math.ceil(lines.length / linesPerPage))
  const layers = new Map<number, WordLayer>()
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const words: WordLayer['words'] = []
    const rows: number[][] = []
    const pageLines = lines.slice(pageIndex * linesPerPage, (pageIndex + 1) * linesPerPage)
    pageLines.forEach((text, row) => {
      const indices: number[] = []
      let x = left
      for (const t of text.split(/\s+/).filter((w) => w !== '')) {
        indices.push(words.length)
        words.push({ t, x, y: top - row * lineHeight, w: t.length * charWidth, h: 10 })
        x += (t.length + 1) * charWidth
      }
      rows.push(indices)
    })
    layers.set(pageIndex, { words, lines: rows })
  }
  return {
    versionId,
    documentId: 'doc',
    pageCount,
    pages: Array.from({ length: pageCount }, () => ({ width, height })),
    layers,
  }
}
