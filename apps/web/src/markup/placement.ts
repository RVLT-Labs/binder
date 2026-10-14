import { compareReadingOrder, snapToLine, suggestCueNumber } from '@binder/core'
import type { Anchor, CueNumber, WordLayer } from '@binder/shared'

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
}: PlacementInput): Anchor {
  const snapped = snap && words ? snapToLine(words, point) : null
  const anchor: Anchor = {
    documentId,
    documentVersionId,
    pageIndex,
    x: point.x,
    y: point.y,
    status: 'ok',
  }
  return snapped ? { ...anchor, y: snapped.y, text: snapped.text } : anchor
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
