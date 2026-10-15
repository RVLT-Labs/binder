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
/** A connector that has to jog turns in a gutter this far into the margin from the text block. */
export const LEADER_GUTTER = 2
export const TICK_HEIGHT = 11
/** The tick reaches this far below the anchor, clear of the glyphs; the other 4 pt are above it. */
const TICK_BELOW = 7
/** Leaders of several cues on one line run this far apart, so they separate in black and white. */
export const LEADER_STEP = 1.5
/** Two underlines this close in y are on one line of text. */
const SAME_LINE = 3
/** A tag reaches a mark this far outside its own extent before its connector jogs. */
const STRAIGHT_TOLERANCE = 1
/** The margin assumed on a page with no word layer, in points. */
export const DEFAULT_MARGIN = 56
/** The air kept between a tag and the text block. */
export const TEXT_CLEARANCE = 4

/** The horizontal extent of a page's text block: its leftmost word's left edge and rightmost word's right edge. */
export interface TextExtent {
  minX: number
  maxX: number
}

/**
 * The text block of a page from its word layer; null when it has no words. A stray word out in the
 * margin (a line number, a page number, a scanning speck) must not move the margin, so only lines
 * of at least three words count; a page with no such line falls back to all its words.
 */
export function textExtent(layer: WordLayer | null | undefined): TextExtent | null {
  if (!layer || layer.words.length === 0) return null
  const solid = layer.lines.filter((l) => l.length >= 3).flat()
  const words = solid.length > 0 ? solid.flatMap((i) => layer.words[i] ?? []) : layer.words
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  for (const w of words) {
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
  /** The cue's anchor y: the tag is level with it unless it collides with the tag above. */
  y: number
  side: MarkerSide
  /** The department half of the tag (`LX`, `SB LX`, `W LX`). */
  lead: string
  /** The type word alone (`SB`, `W`, or empty for a go): what the lead shrinks to in a narrow margin. */
  typeWord: string
  /** The formatted cue number. */
  number: string
  /** Standby is outlined with a dash, warn with a heavier line. */
  type: CueType
  /** The trigger words' boxes, one per line; empty when the cue is unbound or its words unknown. */
  triggerBoxes: readonly Box[]
  /** The cue's anchor x: where an unbound cue's tick stands. */
  anchorX: number
  /** Cues on one line are ordered by department sort order, then cue number, then id. */
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
  /**
   * The connector from the tag to the first underline (or tick) as a polyline of square joins, or
   * null when they already meet. It always runs at the underline's y so it never crosses a glyph.
   */
  leader: Array<{ x: number; y: number }> | null
}

/**
 * Where every cue tag, underline and connector on one page goes, in displayed page space. Tags sit
 * flush in the margin of their department's side and never enter the text block: a tag wider than
 * the margin sheds its department code, then its type word, and only as a last resort overlaps the
 * text.
 *
 * Down each side tags are placed top to bottom in page order (higher y first, ties by department,
 * number, id). A tag stays level with its own line unless it would overlap the tag just above it;
 * then it is pushed down to 2 points below that one. Finally the stack is held inside `bounds`: a
 * tag below `minY` is lifted to it, and the tags above are lifted in turn if they would overlap;
 * nothing goes above `maxY`. The result is in the order of `cues`.
 */
export function layoutCueTags(input: {
  pageWidth: number
  /** The vertical limits tags must stay within: the footer's top edge and the page's height. */
  bounds: { minY: number; maxY: number }
  /** The page's text block (from its word layer), or null for the default margin. */
  textExtent?: TextExtent | null
  cues: readonly CueTagInput[]
}): CueTagLayout[] {
  const { pageWidth, cues, bounds } = input
  const left = input.textExtent ? input.textExtent.minX - TEXT_CLEARANCE : DEFAULT_MARGIN
  const right = input.textExtent
    ? input.textExtent.maxX + TEXT_CLEARANCE
    : pageWidth - DEFAULT_MARGIN
  const fitted = cues.map((c) => {
    const room = (c.side === 'left' ? left : pageWidth - right) - TAG_EDGE
    // The department goes first, then the type word: the outline carries the type, but a word is
    // what survives a photocopy.
    const steps = [...new Set([c.lead, c.typeWord, ''])]
    const lead = steps.find((l) => tagWidth(l, c.number) <= room) ?? ''
    return { lead, w: tagWidth(lead, c.number) }
  })
  const centres: number[] = []
  const rank = new Map<number, number>()
  for (const side of ['left', 'right'] as const) {
    const order = cues
      .map((_, i) => i)
      .filter((i) => (cues[i] as CueTagInput).side === side)
      .sort((a, b) => comparePlacement(cues[a] as CueTagInput, cues[b] as CueTagInput))
    order.forEach((i, k) => rank.set(i, k))
    stackSide(order, cues, centres, bounds)
  }
  // Where the text block starts and ends: the connector's gutters sit just outside it.
  const textEdges = {
    left: input.textExtent ? input.textExtent.minX : DEFAULT_MARGIN,
    right: input.textExtent ? input.textExtent.maxX : pageWidth - DEFAULT_MARGIN,
  }
  const targets = cues.map((c) => markTarget(c))
  const offsets = leaderOffsets(cues, targets, rank)
  return cues.map((c, i) =>
    layoutOne(
      c,
      (fitted[i] as { lead: string }).lead,
      (fitted[i] as { w: number }).w,
      centres[i] as number,
      pageWidth,
      textEdges,
      offsets[i] as number,
    ),
  )
}

/** Sweeps one side's tags (indices in placement order) down the page, then holds them in bounds. */
function stackSide(
  order: number[],
  cues: readonly CueTagInput[],
  centres: number[],
  bounds: { minY: number; maxY: number },
) {
  const step = TAG_HEIGHT + TAG_GAP
  let above: number | undefined
  for (const i of order) {
    const y = (cues[i] as CueTagInput).y
    centres[i] =
      above !== undefined && y > (centres[above] as number) - TAG_HEIGHT
        ? (centres[above] as number) - step
        : y
    above = i
  }
  // Bottom up: lift what is below the floor, and whatever it then overlaps, in turn.
  const floor = bounds.minY + TAG_HEIGHT / 2
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k] as number
    if ((centres[i] as number) < floor) centres[i] = floor
    const up = order[k - 1]
    if (up !== undefined && (centres[up] as number) - (centres[i] as number) < TAG_HEIGHT) {
      centres[up] = (centres[i] as number) + step
    }
  }
  // Nothing leaves the page at the top, even if a dense cluster has to overlap there.
  const ceiling = bounds.maxY - TAG_HEIGHT / 2
  for (const i of order) if ((centres[i] as number) > ceiling) centres[i] = ceiling
}

/** The order tags take down a side: higher on the page first, then department, number, id. */
function comparePlacement(a: CueTagInput, b: CueTagInput): number {
  return b.y - a.y || compareKeys(a, b)
}

/** Where a cue's mark ends: the left or right end of its first underline, or the bottom of its tick. */
function markTarget(c: CueTagInput): { x: number; y: number } | null {
  const first = c.triggerBoxes[0]
  if (first)
    return { x: c.side === 'left' ? first.x : first.x + first.w, y: first.y - UNDERLINE_DROP }
  return { x: c.anchorX, y: c.y - TICK_BELOW }
}

/**
 * How far each leader sits below its natural y: cues on one side that trigger on the same line of
 * text get leaders LEADER_STEP apart, in placement order, so two rules never run along one y.
 */
function leaderOffsets(
  cues: readonly CueTagInput[],
  targets: Array<{ x: number; y: number } | null>,
  rank: Map<number, number>,
): number[] {
  const out = cues.map(() => 0)
  const sorted = cues.map((_, i) => i).sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
  for (const i of sorted) {
    const t = targets[i]
    if (!t) continue
    const earlier = sorted.filter(
      (j) =>
        (rank.get(j) ?? 0) < (rank.get(i) ?? 0) &&
        (cues[j] as CueTagInput).side === (cues[i] as CueTagInput).side &&
        targets[j] &&
        Math.abs((targets[j] as { y: number }).y - t.y) < SAME_LINE,
    ).length
    out[i] = earlier * LEADER_STEP
  }
  return out
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
  textEdges: { left: number; right: number },
  leaderDrop: number,
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
  const tick = first
    ? null
    : { x: c.anchorX, y1: c.y - TICK_BELOW, y2: c.y - TICK_BELOW + TICK_HEIGHT }
  const base = markTarget(c)
  const leader = connector({
    left,
    tag,
    centre,
    target: base ? { x: base.x, y: base.y - leaderDrop } : null,
    gutter: left ? textEdges.left - LEADER_GUTTER : textEdges.right + LEADER_GUTTER,
  })
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
    leader,
  }
}

/**
 * The connector from a tag to its mark, always at the mark's y so it never crosses a glyph. A tag
 * level with its line runs straight out, starting under the pill's curve so it meets the outline.
 * A tag pushed off its line leaves at its own centre, turns in the gutter beside the text block,
 * and runs in to the mark.
 */
function connector(o: {
  left: boolean
  tag: Box
  centre: number
  target: { x: number; y: number } | null
  gutter: number
}): Array<{ x: number; y: number }> | null {
  const { left, tag, centre, target } = o
  if (!target) return null
  const edge = left ? tag.x + tag.w : tag.x
  // Already touching or overlapping the mark.
  if (left ? edge >= target.x : edge <= target.x) return null
  if (Math.abs(target.y - centre) <= TAG_HEIGHT / 2 + STRAIGHT_TOLERANCE) {
    return [{ x: left ? edge - TAG_RADIUS : edge + TAG_RADIUS, y: target.y }, target]
  }
  // The gutter is never beyond the tag's edge or the mark.
  const gx = left
    ? Math.min(Math.max(o.gutter, edge), target.x)
    : Math.max(Math.min(o.gutter, edge), target.x)
  return [{ x: edge, y: centre }, { x: gx, y: centre }, { x: gx, y: target.y }, target]
}
