import { helveticaBoldWidth, helveticaWidth } from './helvetica'

export const DEFAULT_STROKE = 1.5
export const DEFAULT_NOTE_FONT = 10
export const DEFAULT_STAMP_FONT = 12
export const NOTE_MAX_WIDTH = 160
export const ANNOTATION_PAD = 4
export const NOTE_LINE_HEIGHT = 1.25
/** An unbound highlight draws its quote's first characters in a small dashed marker. */
export const UNBOUND_FONT = 8
export const UNBOUND_CHARS = 24

/** Greedy word wrap at `maxWidth` points in Helvetica; a new line starts a paragraph. */
export function wrapText(text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (line && helveticaWidth(candidate, size) > maxWidth) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    lines.push(line)
  }
  return lines
}

/** The quote shortened for an unbound highlight's marker. */
export function unboundSnippet(quote: string): string {
  return quote.length > UNBOUND_CHARS ? `${quote.slice(0, UNBOUND_CHARS)}…` : quote
}

/** A note's left bar, in points (the mockup's `.note` border-left). */
export const NOTE_BAR_WIDTH = 2
/** A note's tint: its colour mixed this far into white. */
export const NOTE_TINT = 0.12
/** A stamp is turned this many degrees counter-clockwise about its centre (the mockup's -3deg). */
export const STAMP_ANGLE = 3
/** A stamp's letter-spacing, as a fraction of its font size (.06em). */
export const STAMP_TRACKING = 0.06
/** A stamp's fill opacity over the page. */
export const STAMP_FILL_OPACITY = 0.8

/** The width a stamp's bold, tracked text takes. */
export function stampTextWidth(text: string, size: number): number {
  return helveticaBoldWidth(text, size) + [...text].length * STAMP_TRACKING * size
}

/** `#rrggbb` mixed `amount` of the way from white: a note's tint; other colour strings come back as they are. */
export function mixIntoWhite(colour: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(colour)
  if (!m) return colour
  const n = Number.parseInt(m[1] as string, 16)
  const ch = (v: number) =>
    Math.round(255 - (255 - v) * amount)
      .toString(16)
      .padStart(2, '0')
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`
}
