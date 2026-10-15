import {
  type CueTagLayout,
  formatCueNumber,
  layoutCueTags,
  markerLead,
  textExtent,
  wordBoxes,
} from '@binder/core'
import type { CueType, MarkerSide, TextAnchor, WordLayer } from '@binder/shared'
import type { MarkerCue } from './CueMarker'

export type LayoutCue = MarkerCue & {
  department_id?: string | null
  anchor: MarkerCue['anchor'] & { text?: TextAnchor }
}

const asType = (t: LayoutCue['type']): CueType => (t === 'standby' || t === 'warn' ? t : 'go')

/**
 * Where every cue tag, highlight and leader on one page goes: the layout core also uses to stamp
 * the print, so screen and paper match. `words` is the page's word layer (null when it has none, so
 * every cue draws a tick), `sideOf` and `orderOf` give a department's margin and sort order.
 */
export function layoutPageCues(
  cues: readonly LayoutCue[],
  words: WordLayer | null,
  pageWidth: number,
  sideOf: (departmentId: string) => MarkerSide,
  orderOf: (departmentId: string) => number,
): Map<string, CueTagLayout> {
  const layouts = layoutCueTags({
    pageWidth,
    textExtent: textExtent(words),
    cues: cues.map((c) => {
      const department = c.department_id ?? ''
      const type = asType(c.type)
      return {
        id: c.id,
        y: c.anchor.y,
        side: sideOf(department),
        type,
        lead: markerLead(type, c.dept_code),
        code: c.dept_code,
        number: formatCueNumber(c.major ?? 0, c.minor ?? 0, c.dept_number_format),
        triggerBoxes: words && c.anchor.text ? wordBoxes(words, c.anchor.text) : [],
        anchorX: c.anchor.x,
        sortKey: { department: orderOf(department), major: c.major ?? 0, minor: c.minor ?? 0 },
      }
    }),
  })
  return new Map(layouts.map((l) => [l.id, l]))
}
