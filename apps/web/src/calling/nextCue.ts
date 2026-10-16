import { compareReadingOrder } from '@binder/core'

/** What `nextCue` needs of a cue: its department and where it sits (y up, as anchors store it). */
export interface NextCueCandidate {
  departmentId: string
  anchor: { pageIndex: number; y: number } | null
}

/**
 * The cue the Calling strip announces: the first cue of the department that sits at or after the
 * top of the view, in reading order (page, then top to bottom). `page` is zero-based and `y` is the
 * top of the view on that page, in the same units as the anchors (displayed points, y up): a whole
 * page at its top is its height. Cues on other departments, and cues with nowhere on a page, are
 * skipped. Null when nothing is left.
 */
export function nextCue<T extends NextCueCandidate>(
  cues: readonly T[],
  at: { departmentId: string | null; page: number; y: number },
): T | null {
  if (at.departmentId === null) return null
  const top = { pageIndex: at.page, y: at.y }
  let best: T | null = null
  for (const cue of cues) {
    if (!cue.anchor || cue.departmentId !== at.departmentId) continue
    if (compareReadingOrder(cue.anchor, top) < 0) continue
    if (!best?.anchor || compareReadingOrder(cue.anchor, best.anchor) < 0) best = cue
  }
  return best
}
