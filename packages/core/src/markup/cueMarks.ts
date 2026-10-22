import {
  type Anchor,
  type CueMark,
  isCaretMark,
  markOf,
  type TextAnchor,
  type WordLayer,
} from '@binder/shared'
import { type Caret, caretAt, clampOffset } from './caret'
import type { Box } from './markers'
import { wordBoxes } from './wordBoxes'

export interface MarkInputs {
  mark: CueMark
  /** Underline and highlight: the range's boxes. Line and pointer: the first word's box only. */
  triggerBoxes: Box[]
  /** Line and pointer: the character boundary the bar sits on. Null otherwise. */
  caret: Caret | null
}

/** The range cut down to its first word; an unbound range, or one already a word long, is returned as it is. */
function oneWord(text: TextAnchor, layer?: WordLayer | null): TextAnchor {
  if (text.wordStart < 0 || text.wordEnd <= text.wordStart) return text
  // The quote is the range's words joined by spaces, so its first token is the first word without a layer.
  const first = layer?.words[text.wordStart]?.t ?? text.quote.split(' ')[0] ?? text.quote
  return { ...text, quote: first, wordEnd: text.wordStart }
}

/** The single place that turns an anchor and the page's words into the geometry a mark needs. */
export function markInputs(
  words: WordLayer | null | undefined,
  anchor: Pick<Anchor, 'mark' | 'text'>,
): MarkInputs {
  const mark = markOf(anchor)
  const text = anchor.text
  if (!words || !text || text.wordStart < 0) return { mark, triggerBoxes: [], caret: null }
  if (!isCaretMark(mark)) return { mark, triggerBoxes: wordBoxes(words, text), caret: null }
  return {
    mark,
    triggerBoxes: wordBoxes(words, { ...text, wordEnd: text.wordStart }),
    caret: caretAt(words, text),
  }
}

/**
 * A copy of the anchor drawn with another mark. Never mutates its input, and `x` stays where it was
 * when leaving a line, so a moved bubble (an offset from `x`) does not shift.
 *
 * A line's stored range runs on to the end of its line (a line is placed with up to eight words as
 * its quote). Leaving a line keeps that range, as the MCP `update_cue` has always done, unless
 * `oneWord` is set (the cue editor): then an underline or a highlight covers only the word the bar
 * sits in, which is what someone who clicked to place a line expects to see.
 */
export function withMark(
  anchor: Anchor,
  mark: CueMark,
  opts: { layer?: WordLayer | null; offset?: number; oneWord?: boolean } = {},
): Anchor {
  const { mark: _drop, ...rest } = anchor
  if (!isCaretMark(mark)) {
    const next: Anchor = { ...rest }
    if (mark !== 'underline') next.mark = mark
    if (next.text) {
      const { offset: _o, ...text } = next.text
      next.text = opts.oneWord && isCaretMark(markOf(anchor)) ? oneWord(text, opts.layer) : text
    }
    return next
  }
  const next: Anchor = { ...rest, mark }
  const text = anchor.text
  if (!text || text.wordStart < 0) return next
  const word = opts.layer?.words[text.wordStart]
  const raw = opts.offset ?? text.offset ?? 0
  const offset = word ? clampOffset(word.t, raw) : Math.max(0, Math.trunc(raw))
  next.text = { ...text, offset }
  if (opts.layer) {
    const caret = caretAt(opts.layer, next.text)
    if (caret) next.x = caret.x
  }
  return next
}
