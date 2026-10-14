import type { Word, WordLayer } from '@binder/shared'

const PAGE = /<page\b[^>]*>([\s\S]*?)<\/page>/
const LINE = /<line\b[^>]*>([\s\S]*?)<\/line>/g
const WORD = /<word\b([^>]*)>([\s\S]*?)<\/word>/g
const ATTR = /(xMin|yMin|xMax|yMax)="([^"]*)"/g
const ENTITY = /&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeEntities(s: string): string {
  return s.replace(ENTITY, (_, name: string) => {
    if (name[0] !== '#') return NAMED[name] ?? ''
    const code = name[1] === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
    return String.fromCodePoint(code)
  })
}

function box(attrs: string): { xMin: number; yMin: number; xMax: number; yMax: number } {
  const b: Record<string, number> = {}
  for (const [, key, value] of attrs.matchAll(ATTR)) if (key) b[key] = Number(value)
  const { xMin, yMin, xMax, yMax } = b
  if (![xMin, yMin, xMax, yMax].every((n) => Number.isFinite(n))) {
    throw new Error(`poppler word without a complete bounding box: ${attrs.trim()}`)
  }
  return b as { xMin: number; yMin: number; xMax: number; yMax: number }
}

/**
 * Parses the first page of `pdftotext -bbox-layout` output into a word layer in displayed page
 * space (spec 4.3: PDF points, origin bottom-left, after /Rotate).
 *
 * Poppler reports word boxes in the displayed (rotated) orientation with a top-left origin, but its
 * `<page>` element carries the unrotated size, so the caller passes the displayed size and y is
 * flipped with the displayed height.
 */
export function fromPopplerBbox(
  xhtml: string,
  displayed: { width: number; height: number },
): WordLayer {
  const words: Word[] = []
  const lines: number[][] = []
  const page = PAGE.exec(xhtml)?.[1] ?? ''
  for (const [, lineBody = ''] of page.matchAll(LINE)) {
    const line: number[] = []
    for (const [, attrs = '', text = ''] of lineBody.matchAll(WORD)) {
      const { xMin, yMin, xMax, yMax } = box(attrs)
      line.push(words.length)
      words.push({
        t: decodeEntities(text),
        x: xMin,
        y: displayed.height - yMax,
        w: xMax - xMin,
        h: yMax - yMin,
      })
    }
    if (line.length > 0) lines.push(line)
  }
  return { words, lines }
}
