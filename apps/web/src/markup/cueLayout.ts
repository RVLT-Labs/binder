import {
  asCueType,
  type CueTagLayout,
  formatCueNumber,
  layoutCueTags,
  markerLead,
  markerTypeWord,
  markInputs,
  textExtent,
} from '@binder/core'
import type { ConnectorStyle, CueMark, MarkerSide, TextAnchor, WordLayer } from '@binder/shared'
import type { MarkerCue } from './CueMarker'

export type LayoutCue = MarkerCue & {
  department_id?: string | null
  anchor: MarkerCue['anchor'] & { mark?: CueMark; text?: TextAnchor }
}

/**
 * Where every cue tag, highlight and leader on one page goes: the layout core also uses to stamp
 * the print, so screen and paper match. `words` is the page's word layer (null when it has none, so
 * every cue draws a tick), `sideOf`, `orderOf` and `connectorOf` give a department's margin, sort
 * order and connector style (its weight and pattern).
 */
export function layoutPageCues(
  cues: readonly LayoutCue[],
  words: WordLayer | null,
  size: { width: number; height: number },
  sideOf: (departmentId: string) => MarkerSide,
  orderOf: (departmentId: string) => number,
  connectorOf: (departmentId: string) => ConnectorStyle,
): Map<string, CueTagLayout> {
  const layouts = layoutCueTags({
    pageWidth: size.width,
    bounds: { minY: 0, maxY: size.height },
    textExtent: textExtent(words),
    cues: cues.map((c) => {
      const department = c.department_id ?? ''
      const type = asCueType(c.type)
      const { mark, triggerBoxes, caret } = markInputs(words, c.anchor)
      return {
        id: c.id,
        y: c.anchor.y,
        side: sideOf(department),
        type,
        lead: markerLead(type, c.dept_code),
        typeWord: markerTypeWord(type),
        number: formatCueNumber(c.major ?? 0, c.minor ?? 0, c.dept_number_format),
        mark,
        triggerBoxes,
        caret,
        anchorX: c.anchor.x,
        tag: c.anchor.tag ?? null,
        connector: connectorOf(department),
        sortKey: { department: orderOf(department), major: c.major ?? 0, minor: c.minor ?? 0 },
      }
    }),
  })
  return new Map(layouts.map((l) => [l.id, l]))
}
