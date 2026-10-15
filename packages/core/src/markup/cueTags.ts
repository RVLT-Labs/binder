import type { CueType, MarkerSide, WordLayer } from '@binder/shared'
import { helveticaBoldWidth, helveticaWidth } from './helvetica'
import type { Box } from './markers'

/** Cue tag geometry, in points: the screen overlay and print stamping both draw from it. */
export const TAG_HEIGHT = 14
export const TAG_FONT_SIZE = 9
/** The tag is a pill: a radius of half its height. */
export const TAG_RADIUS = TAG_HEIGHT / 2
/** Space between the pill's ends and its text. */
export const TAG_PAD = 6
/** Space between the department code and the number. */
export const TAG_TEXT_GAP = 3
/** The gap between a tag and the page edge it is flush with. */
export const TAG_EDGE = 4
/** The gap between two stacked tags. */
export const TAG_GAP = 2
/** Outline weights: go and standby 1 pt, warn 1.5 pt. */
export const TAG_OUTLINE = 1
export const TAG_OUTLINE_WARN = 1.5
/** The trigger words are underlined: this thick, this far below the word box. */
export const UNDERLINE_WIDTH = 1.5
export const UNDERLINE_DROP = 1
/** The on-screen fill of a selected or hovered cue's trigger words. */
export const SELECTED_FILL_OPACITY = 0.1
export const LEADER_WIDTH = 0.75
/** The connector stops this short of the underline. */
export const LEADER_STOP = 2
export const TICK_HEIGHT = 8
/** The margin assumed on a page with no word layer, in points. */
export const DEFAULT_MARGIN = 56
/** The air kept between a tag and the text block. */
export const TEXT_CLEARANCE = 4

/** The horizontal extent of a page's text block: its leftmost word's left edge and rightmost word's right edge. */
export interface TextExtent {
  minX: number
  maxX: number
}

/** The text block of a page from its word layer; null when it has no words. */
export function textExtent(layer: WordLayer | null | undefined): TextExtent | null {
  if (!layer || layer.words.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  for (const w of layer.words) {
    minX = Math.min(minX, w.x)
    maxX = Math.max(maxX, w.x + w.w)
  }
  return { minX, maxX }
}

/**
 * The width of a pill holding `lead` (the code, in regular weight), a gap and `number` (bold). A
 * pill with no lead (the last step of the shrink ladder) holds just the number.
 */
export function tagWidth(lead: string, number: string): number {
  const num = helveticaBoldWidth(number, TAG_FONT_SIZE)
  if (lead === '') return TAG_PAD + num + TAG_PAD
  return TAG_PAD + helveticaWidth(lead, TAG_FONT_SIZE) + TAG_TEXT_GAP + num + TAG_PAD
}

export interface CueTagInput {
  id: string
  /** The cue's anchor y: the tag is level with it unless it is stacked below another. */
  y: number
  side: MarkerSide
  /** The department half of the tag (`LX`, `SB LX`, `W LX`). */
  lead: string
  /** The department code alone (`LX`): what the lead shrinks to when the margin is narrow. */
  code: string
  /** The formatted cue number. */
  number: string
  /** Standby is outlined with a dash, warn with a heavier line. */
  type: CueType
  /** The trigger words' boxes, one per line; empty when the cue is unbound or its words unknown. */
  triggerBoxes: readonly Box[]
  /** The cue's anchor x: where an unbound cue's tick stands. */
  anchorX: number
  /** Crowded tags are laid out in this order: department sort order, then cue number, then id. */
  sortKey: { department: number; major: number; minor: number }
}

export interface CueTagLayout {
  id: string
  side: MarkerSide
  /** A standby's outline is dashed. */
  dash: boolean
  outlineWidth: number
  /** The tag's vertical centre: the cue's y, or lower when stacked under another tag. */
  centreY: number
  /** What the tag shows after fitting the margin: the lead (empty when dropped) and the number. */
  lead: string
  number: string
  tag: Box
  /** Left edges of the lead and the number; both are centred vertically on `centreY`. */
  leadX: number
  numberX: number
  /** The trigger words' boxes, one per line: what a selected cue fills on screen. */
  triggerBoxes: Box[]
  /** The underline under each trigger box. */
  underlines: Array<{ x1: number; x2: number; y: number }>
  /** An unbound cue's mark at its anchor. */
  tick: { x: number; y1: number; y2: number } | null
  /** The connector from the tag to the first underline (or tick), or null when they already meet. */
  leader: { x1: number; x2: number; y: number } | null
}

/**
 * Where every cue tag, highlight and leader on one page goes, in displayed page space. Tags sit
 * flush in the margin of their department's side and never enter the text block: a tag wider than
 * the margin sheds its `SB `/`W ` prefix, then its department code, and only as a last resort
 * overlaps the text. Tags on one side whose vertical extents overlap are stacked downward within
 * the margin, 2 points apart, in sort-key order. The result is in the order of `cues`.
 */
export function layoutCueTags(input: {
  pageWidth: number
  /** The page's text block (from its word layer), or null for the default margin. */
  textExtent?: TextExtent | null
  cues: readonly CueTagInput[]
}): CueTagLayout[] {
  const { pageWidth, cues } = input
  const left = input.textExtent ? input.textExtent.minX - TEXT_CLEARANCE : DEFAULT_MARGIN
  const right = input.textExtent
    ? input.textExtent.maxX + TEXT_CLEARANCE
    : pageWidth - DEFAULT_MARGIN
  const fitted = cues.map((c) => {
    const room = (c.side === 'left' ? left : pageWidth - right) - TAG_EDGE
    const steps = [...new Set([c.lead, c.code, ''])]
    const lead = steps.find((l) => tagWidth(l, c.number) <= room) ?? ''
    return { lead, w: tagWidth(lead, c.number) }
  })
  const order = cues
    .map((_, i) => i)
    .sort((a, b) => compareKeys(cues[a] as CueTagInput, cues[b] as CueTagInput))
  /** Each tag's centre once stacked. */
  const centres: number[] = []
  const placed: number[] = []
  for (const i of order) {
    const c = cues[i] as CueTagInput
    let cy = c.y
    for (;;) {
      const hit = placed
        .filter(
          (j) =>
            (cues[j] as CueTagInput).side === c.side &&
            Math.abs(cy - (centres[j] as number)) < TAG_HEIGHT,
        )
        .sort((a, b) => (centres[a] as number) - (centres[b] as number))[0]
      if (hit === undefined) break
      cy = (centres[hit] as number) - (TAG_HEIGHT + TAG_GAP)
    }
    centres[i] = cy
    placed.push(i)
  }
  return cues.map((c, i) =>
    layoutOne(
      c,
      (fitted[i] as { lead: string }).lead,
      (fitted[i] as { w: number }).w,
      centres[i] as number,
      pageWidth,
    ),
  )
}

function compareKeys(a: CueTagInput, b: CueTagInput): number {
  return (
    a.sortKey.department - b.sortKey.department ||
    a.sortKey.major - b.sortKey.major ||
    a.sortKey.minor - b.sortKey.minor ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

function layoutOne(
  c: CueTagInput,
  lead: string,
  w: number,
  centre: number,
  pageWidth: number,
): CueTagLayout {
  const left = c.side === 'left'
  const x = left ? TAG_EDGE : pageWidth - TAG_EDGE - w
  const tag: Box = { x, y: centre - TAG_HEIGHT / 2, w, h: TAG_HEIGHT }
  const leadX = x + TAG_PAD
  const numberX = lead === '' ? leadX : leadX + helveticaWidth(lead, TAG_FONT_SIZE) + TAG_TEXT_GAP
  const underlines = c.triggerBoxes.map((b) => ({
    x1: b.x,
    x2: b.x + b.w,
    y: b.y - UNDERLINE_DROP,
  }))
  const first = underlines[0]
  const tick = first ? null : { x: c.anchorX, y1: c.y - TICK_HEIGHT / 2, y2: c.y + TICK_HEIGHT / 2 }
  // The connector runs level with the tag between its inner edge and the first underline (or tick).
  const from = left ? x + w : first ? first.x2 + LEADER_STOP : c.anchorX
  const to = left ? (first ? first.x1 - LEADER_STOP : c.anchorX) : x
  return {
    id: c.id,
    side: c.side,
    dash: c.type === 'standby',
    outlineWidth: c.type === 'warn' ? TAG_OUTLINE_WARN : TAG_OUTLINE,
    centreY: centre,
    lead,
    number: c.number,
    tag,
    leadX,
    numberX,
    triggerBoxes: c.triggerBoxes.map((b) => ({ ...b })),
    underlines,
    tick,
    leader: from < to ? { x1: from, x2: to, y: centre } : null,
  }
}
