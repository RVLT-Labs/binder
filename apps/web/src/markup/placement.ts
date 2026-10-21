import {
  compareReadingOrder,
  snapToCaret,
  snapToLine,
  snapToWord,
  suggestCueNumber,
} from '@binder/core'
import {
  type Anchor,
  type CueMark,
  type CueNumber,
  isCaretMark,
  SNAP_DISTANCE_PT,
  type WordLayer,
} from '@binder/shared'

export interface PlacementInput {
  documentId: string
  documentVersionId: string
  pageIndex: number
  /** Where the pointer is, in displayed page space. */
  point: { x: number; y: number }
  /** The page's word layer; null when it has none or it could not be read. */
  words: WordLayer | null
  /** The document's snap setting, after the session toggle. */
  snap: boolean
  /**
   * A cue dropped by dragging its mark (the margin tag moves only the bubble now): a pointer outside
   * the line's extent starts the trigger at the line's first word (not the nearest), and the anchor's
   * x follows the trigger's first word.
   */
  firstWordOutside?: boolean
}

/**
 * The anchor for a cue placed or dropped by hand (spec 5.2): within 12 points of a text line its
 * y snaps to the line and it captures the quote; otherwise it goes exactly where the pointer is.
 * Placed by hand, the status is always `ok`.
 */
export function anchorAt({
  documentId,
  documentVersionId,
  pageIndex,
  point,
  words,
  snap,
  firstWordOutside = false,
}: PlacementInput): Anchor {
  const snapped =
    snap && words ? snapToLine(words, point, SNAP_DISTANCE_PT, { firstWordOutside }) : null
  const anchor: Anchor = {
    documentId,
    documentVersionId,
    pageIndex,
    x: point.x,
    y: point.y,
    status: 'ok',
  }
  if (!snapped) return anchor
  // A dropped cue's pointer was in the margin: its x is where its trigger starts instead.
  const first = firstWordOutside ? words?.words[snapped.text.wordStart] : undefined
  return { ...anchor, x: first?.x ?? anchor.x, y: snapped.y, text: snapped.text }
}

/**
 * The anchor for a cue placed by hand with a chosen mark. Underline is `anchorAt` exactly (no `mark`
 * key). Highlight takes the one word under the pointer, and a line or pointer sits at the character
 * boundary nearest it; both need snapping on and a text line within `SNAP_DISTANCE_PT`. Without that a
 * highlight is the unbound tick `anchorAt` gives, and a line a free bar, both at the pointer.
 */
export function markAnchorAt({ mark, ...input }: PlacementInput & { mark: CueMark }): Anchor {
  if (mark === 'underline') return anchorAt(input)
  const { documentId, documentVersionId, pageIndex, point, words, snap } = input
  const plain: Anchor = {
    documentId,
    documentVersionId,
    pageIndex,
    x: point.x,
    y: point.y,
    status: 'ok',
    mark,
  }
  if (!snap || !words) return plain
  const snapped = isCaretMark(mark) ? snapToCaret(words, point) : snapToWord(words, point)
  return snapped ? { ...plain, x: snapped.x, y: snapped.y, text: snapped.text } : plain
}

export interface NumberedCue {
  id: string
  major: number
  minor: number
  anchor: { pageIndex: number; y: number } | null
}

/**
 * The suggested number for a cue at `position`, from its department's cues on the same version:
 * the cue just before it and just after it in reading order. `excludeId` leaves out the cue being placed.
 */
export function numberAt(
  position: { pageIndex: number; y: number },
  cues: readonly NumberedCue[],
  excludeId?: string,
): CueNumber {
  const placed = cues
    .filter((c): c is NumberedCue & { anchor: { pageIndex: number; y: number } } =>
      Boolean(c.anchor && c.id !== excludeId),
    )
    .sort((a, b) => compareReadingOrder(a.anchor, b.anchor))
  const prev = placed.findLast((c) => compareReadingOrder(c.anchor, position) <= 0) ?? null
  const next = placed.find((c) => compareReadingOrder(c.anchor, position) > 0) ?? null
  return suggestCueNumber(prev, next)
}
