import { helveticaWidth } from './helvetica'

/** Text size inside a cue marker box and beside it, in points. */
export const MARKER_FONT_SIZE = 10
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
