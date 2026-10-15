import type { MarkerSide } from '@binder/shared'
import { helveticaWidth } from './helvetica'
import type { Box } from './markers'

/** Cue tag geometry, in points: the screen overlay and print stamping both draw from it. */
export const TAG_HEIGHT = 14
export const TAG_FONT_SIZE = 9
/** The coloured bar on the tag's outer edge. */
export const TAG_BAR = 4
export const TAG_PAD = 4
export const TAG_DIVIDER = 0.75
/** The divider stops this far short of the tag's top and bottom edges. */
export const TAG_DIVIDER_INSET = 3
/** The gap between a tag and the page edge it is flush with. */
export const TAG_EDGE = 4
/** The gap between two tags laid side by side. */
export const TAG_GAP = 2
export const TAG_OUTLINE = 1
export const TAG_RADIUS = 2
export const HIGHLIGHT_PAD = 1.5
export const HIGHLIGHT_OPACITY = 0.15
export const HIGHLIGHT_OUTLINE = 0.75
export const LEADER_WIDTH = 0.75
export const TICK_HEIGHT = 8
export const GRIP_RADIUS = 0.7
const GRIP_SPACING = 3

/** The width of a tag holding `lead` and `number`: bar, lead, divider and number, each padded. */
export function tagWidth(lead: string, number: string): number {
  return (
    TAG_BAR +
    TAG_PAD +
    helveticaWidth(lead, TAG_FONT_SIZE) +
    TAG_PAD +
    TAG_DIVIDER +
    TAG_PAD +
    helveticaWidth(number, TAG_FONT_SIZE) +
    TAG_PAD
  )
}

export interface CueTagInput {
  id: string
  /** The cue's anchor y: the tag is centred on it. */
  y: number
  side: MarkerSide
  /** The department half of the tag (`LX`, `SB LX`, `W LX`). */
  lead: string
  /** The formatted cue number. */
  number: string
  /** A standby's tag is outlined with a dash. */
  dash: boolean
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
  dash: boolean
  centreY: number
  tag: Box
  /** The coloured bar on the tag's outer edge. */
  bar: Box
  /** Three dots down the middle of the bar. */
  grips: Array<{ x: number; y: number }>
  divider: Box
  dividerX: number
  /** Left edges of the lead and number text; both are centred vertically on `centreY`. */
  leadX: number
  numberX: number
  /** The trigger words' highlight rectangles (the word boxes, padded). */
  triggerBoxes: Box[]
  /** An unbound cue's mark at its anchor. */
  tick: { x: number; y1: number; y2: number } | null
  /** The rule joining the tag to the highlight (or tick), or null when they already meet. */
  leader: { x1: number; x2: number; y: number } | null
}

/**
 * Where every cue tag, highlight and leader on one page goes, in displayed page space. Tags sit
 * flush in the margin of their department's side. Tags on one side whose vertical extents overlap
 * are laid side by side, moving inward from the page edge, in sort-key order. The result is in the
 * order of `cues`.
 */
export function layoutCueTags(input: {
  pageWidth: number
  cues: readonly CueTagInput[]
}): CueTagLayout[] {
  const { pageWidth, cues } = input
  const widths = cues.map((c) => tagWidth(c.lead, c.number))
  const order = cues
    .map((_, i) => i)
    .sort((a, b) => compareKeys(cues[a] as CueTagInput, cues[b] as CueTagInput))
  /** How far in from its page edge each tag starts. */
  const offsets: number[] = []
  const placed: number[] = []
  for (const i of order) {
    const c = cues[i] as CueTagInput
    let offset = 0
    for (const j of placed) {
      const other = cues[j] as CueTagInput
      if (other.side !== c.side || Math.abs(other.y - c.y) >= TAG_HEIGHT) continue
      offset = Math.max(offset, (offsets[j] as number) + (widths[j] as number) + TAG_GAP)
    }
    offsets[i] = offset
    placed.push(i)
  }
  return cues.map((c, i) => layoutOne(c, widths[i] as number, offsets[i] as number, pageWidth))
}

function compareKeys(a: CueTagInput, b: CueTagInput): number {
  return (
    a.sortKey.department - b.sortKey.department ||
    a.sortKey.major - b.sortKey.major ||
    a.sortKey.minor - b.sortKey.minor ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

function layoutOne(c: CueTagInput, w: number, offset: number, pageWidth: number): CueTagLayout {
  const left = c.side === 'left'
  const x = left ? TAG_EDGE + offset : pageWidth - TAG_EDGE - offset - w
  const y = c.y - TAG_HEIGHT / 2
  const tag: Box = { x, y, w, h: TAG_HEIGHT }
  const bar: Box = { x: left ? x : x + w - TAG_BAR, y, w: TAG_BAR, h: TAG_HEIGHT }
  const leadWidth = helveticaWidth(c.lead, TAG_FONT_SIZE)
  const leadX = left ? x + TAG_BAR + TAG_PAD : x + TAG_PAD
  const dividerX = leadX + leadWidth + TAG_PAD
  const numberX = dividerX + TAG_DIVIDER + TAG_PAD
  const barCentre = bar.x + TAG_BAR / 2
  const triggerBoxes = c.triggerBoxes.map((b) => ({
    x: b.x - HIGHLIGHT_PAD,
    y: b.y - HIGHLIGHT_PAD,
    w: b.w + HIGHLIGHT_PAD * 2,
    h: b.h + HIGHLIGHT_PAD * 2,
  }))
  const first = triggerBoxes[0]
  const tick = first ? null : { x: c.anchorX, y1: c.y - TICK_HEIGHT / 2, y2: c.y + TICK_HEIGHT / 2 }
  // The leader runs between the tag's inner edge and the near edge of the first highlight (or tick).
  const from = left ? x + w : first ? first.x + first.w : c.anchorX
  const to = left ? (first ? first.x : c.anchorX) : x
  return {
    id: c.id,
    side: c.side,
    dash: c.dash,
    centreY: c.y,
    tag,
    bar,
    grips: [GRIP_SPACING, 0, -GRIP_SPACING].map((dy) => ({ x: barCentre, y: c.y + dy })),
    divider: {
      x: dividerX,
      y: y + TAG_DIVIDER_INSET,
      w: TAG_DIVIDER,
      h: TAG_HEIGHT - TAG_DIVIDER_INSET * 2,
    },
    dividerX,
    leadX,
    numberX,
    triggerBoxes,
    tick,
    leader: from < to ? { x1: from, x2: to, y } : null,
  }
}
