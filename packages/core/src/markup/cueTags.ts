import type { CueMark, CueType, MarkerSide, WordLayer } from '@binder/shared'
import type { Caret } from './caret'
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
/** A highlight is the trigger words' boxes filled at this opacity (more when its cue is active). */
export const HIGHLIGHT_OPACITY = 0.28
export const HIGHLIGHT_OPACITY_ACTIVE = 0.4
export const HIGHLIGHT_RADIUS = 2
/** A highlight's fill reaches this far past each side of the word box. */
export const HIGHLIGHT_PAD_X = 1
/** A line or pointer is a bar this thick, reaching this far above and below the word box. */
export const BAR_WIDTH = 1.5
export const BAR_OVERHANG = 3
/** A pointer's triangle (drawn by the renderers), this wide and this tall. */
export const POINTER_WIDTH = 6
export const POINTER_HEIGHT = 5
/** A line or pointer with no word to sit in is a free bar this tall, centred on the cue's y. */
export const FREE_BAR_HEIGHT = 14
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
/** A cue note is one line of Helvetica this size under its tag, in a block this high. */
export const NOTE_FONT_SIZE = 7
export const NOTE_HEIGHT = 9
/** A note's column is the margin less this (the gaps at the page edge and at the text block). */
export const NOTE_COLUMN_INSET = 8
/** A column narrower than this draws no note. */
export const NOTE_MIN_COLUMN = 40
const ELLIPSIS = '…'

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
  /** The cue's anchor y: the tag is level with it unless it is crowded by another tag. */
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
  /** The cue's anchor x: where an unbound cue's tick (or a free bar) stands. */
  anchorX: number
  /** How the trigger is drawn; absent is an underline. */
  mark?: CueMark
  /** For a line or pointer: where the bar stands and the word it sits in; null or absent when unbound. */
  caret?: Caret | null
  /** The cue's note, printed in one line under the tag; empty or absent for none. */
  note?: string
  /** Cues on one line are ordered by department sort order, then cue number, then id. */
  sortKey: { department: number; major: number; minor: number }
}

export interface CueTagLayout {
  id: string
  side: MarkerSide
  /** A standby's outline is dashed. */
  dash: boolean
  outlineWidth: number
  /** The tag's vertical centre: the cue's y, or above or below it when crowded by other tags. */
  centreY: number
  /** What the tag shows after fitting the margin: the lead (empty when dropped) and the number. */
  lead: string
  number: string
  tag: Box
  /**
   * The note under the tag: its text, cut with an ellipsis to the tag column, and its box (a block
   * `NOTE_HEIGHT` high directly under the tag, flush with the tag's outer edge; `w` is the text's
   * width). Null when the cue has no note or the column is under `NOTE_MIN_COLUMN` wide.
   */
  note: { text: string; box: Box } | null
  /** Left edges of the lead and the number; both are centred vertically on `centreY`. */
  leadX: number
  numberX: number
  /** The trigger words' boxes, one per line: what a selected cue fills on screen. */
  triggerBoxes: Box[]
  /** How the trigger is drawn. */
  mark: CueMark
  /** A highlight's fills: the trigger boxes padded by `HIGHLIGHT_PAD_X` on each side. */
  fills: Box[]
  /** A line or pointer's bar (`y1` the bottom, `y2` the top, as `tick`); null for the other marks. */
  bar: { x: number; y1: number; y2: number; pointer: boolean } | null
  /** The underline under each trigger box (underline mark only). */
  underlines: Array<{ x1: number; x2: number; y: number }>
  /** An unbound cue's mark at its anchor. */
  tick: { x: number; y1: number; y2: number } | null
  /**
   * The connector from the tag to the mark (the first underline or tick, the outer edge of a
   * highlight's first fill, or a line or pointer's bar) as a polyline of square joins, or null when
   * they already meet. It always runs at the underline's y so it never crosses a glyph.
   */
  leader: Array<{ x: number; y: number }> | null
}

/**
 * Where every cue tag, underline and connector on one page goes, in displayed page space. Tags sit
 * flush in the margin of their department's side and never enter the text block: a tag wider than
 * the margin sheds its department code, then its type word, and only as a last resort overlaps the
 * text.
 *
 * Down each side tags keep their page order (higher y first, ties by department, number, id). A tag
 * stays level with its own line unless it would overlap a neighbour; tags that crowd one another
 * form a group, stacked 2 points apart in that order and spread up and down around their lines
 * (centred so the group moves no further in total than it must). A tag with a note counts as the
 * tag plus the note's 9 points, so a tag never lands on a note. Groups that then overlap merge and
 * are centred again. The stack is held inside `bounds`: a group below `minY` is lifted to it, with
 * the tags above lifted in turn if they would overlap, and nothing goes above `maxY`. The result is in the order of `cues`.
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
  // Where the text block starts and ends: the connector's gutters sit just outside it.
  const textEdges = {
    left: input.textExtent ? input.textExtent.minX : DEFAULT_MARGIN,
    right: input.textExtent ? input.textExtent.maxX : pageWidth - DEFAULT_MARGIN,
  }
  // A note's column: the margin between the page edge and the text block, less 8.
  const columns = {
    left: textEdges.left - NOTE_COLUMN_INSET,
    right: pageWidth - textEdges.right - NOTE_COLUMN_INSET,
  }
  const notes = cues.map((c) => fitNote(c.note, columns[c.side]))
  const noteExtra = notes.map((n) => (n ? NOTE_HEIGHT : 0))
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
    order.forEach((i, k) => {
      rank.set(i, k)
    })
    stackSide(order, cues, noteExtra, centres, bounds)
  }
  const targets = cues.map((c) => markTarget(c))
  const offsets = leaderOffsets(cues, targets, rank)
  return cues.map((c, i) =>
    layoutOne(
      c,
      (fitted[i] as { lead: string }).lead,
      (fitted[i] as { w: number }).w,
      notes[i] ?? null,
      centres[i] as number,
      pageWidth,
      textEdges,
      offsets[i] as number,
    ),
  )
}

/**
 * Places one side's tags (indices in placement order, top of the page first) so crowded ones spread
 * up and down around their own lines.
 *
 * Every tag starts as a group of its own, level with its cue. A group's members are stacked in
 * placement order, `TAG_HEIGHT + TAG_GAP` apart (plus a noted tag's `NOTE_HEIGHT`), and the stack is
 * centred where its members want to be: the position that minimises the total distance they move,
 * which is the one where the displacements add up to nothing. When a group's lowest tag overlaps the
 * next group's highest, the two merge and the merged stack is centred again, until nothing overlaps
 * (pool-adjacent-violators). A group is held inside `bounds` as part of placing it: lifted off the
 * footer, kept below the top of the page, so what it then overlaps merges in as well.
 */
function stackSide(
  order: number[],
  cues: readonly CueTagInput[],
  /** The points a note adds under each tag: 0 or `NOTE_HEIGHT`. */
  extra: readonly number[],
  centres: number[],
  bounds: { minY: number; maxY: number },
) {
  const step = TAG_HEIGHT + TAG_GAP
  const ceiling = bounds.maxY - TAG_HEIGHT / 2
  // A note hangs below its tag, so the tag is lifted that much further off the floor.
  const floorOf = (i: number) => bounds.minY + TAG_HEIGHT / 2 + (extra[i] as number)
  interface Group {
    members: number[]
    /** Where each member sits below the group's first tag (0 for the first). */
    offsets: number[]
    /** The first (highest) tag's centre. */
    top: number
  }
  const place = (members: number[]): Group => {
    const offsets: number[] = []
    let offset = 0
    let wanted = 0
    members.forEach((i, k) => {
      if (k > 0) offset += step + (extra[members[k - 1] as number] as number)
      offsets.push(offset)
      wanted += (cues[i] as CueTagInput).y + offset
    })
    // The lowest tag is the one the footer can reach; the highest is the one the page top can.
    const lowest = members[members.length - 1] as number
    const lowestOffset = offsets[offsets.length - 1] as number
    const top = Math.min(Math.max(wanted / members.length, floorOf(lowest) + lowestOffset), ceiling)
    return { members, offsets, top }
  }
  const bottomOf = (g: Group) => g.top - (g.offsets[g.offsets.length - 1] as number)
  const groups: Group[] = []
  for (const i of order) {
    let group = place([i])
    for (let prev = groups[groups.length - 1]; prev; prev = groups[groups.length - 1]) {
      const held = extra[prev.members[prev.members.length - 1] as number] as number
      if (bottomOf(prev) - group.top >= TAG_HEIGHT + held) break
      groups.pop()
      group = place([...prev.members, ...group.members])
    }
    groups.push(group)
  }
  for (const g of groups) {
    g.members.forEach((i, k) => {
      // A cluster too big for the room between the footer and the top cannot be spread; it still
      // stays on the page, overlapping, rather than leave it.
      centres[i] = Math.min(ceiling, Math.max(g.top - (g.offsets[k] as number), floorOf(i)))
    })
  }
}

/** The order tags take down a side: higher on the page first, then department, number, id. */
function comparePlacement(a: CueTagInput, b: CueTagInput): number {
  return b.y - a.y || compareKeys(a, b)
}

/** A line or pointer's bar at a caret: the word's height plus the overhang, `y1` the bottom, `y2` the top. */
export function barAt(caret: Caret): { x: number; y1: number; y2: number } {
  const b = caret.box
  return { x: caret.x, y1: b.y - BAR_OVERHANG, y2: b.y + b.h + BAR_OVERHANG }
}

/** A line or pointer's bar: at the caret (`barAt`), or free at the anchor. */
function barOf(c: CueTagInput): { x: number; y1: number; y2: number; pointer: boolean } {
  const pointer = c.mark === 'pointer'
  if (c.caret) return { ...barAt(c.caret), pointer }
  return { x: c.anchorX, y1: c.y - FREE_BAR_HEIGHT / 2, y2: c.y + FREE_BAR_HEIGHT / 2, pointer }
}

/**
 * Where a cue's mark ends: the left or right end of its first underline (or the padded outer edge
 * of a highlight's first fill, at the same y), the bar of a line or pointer (at the word's
 * underline y, or the bottom of a free bar), or the bottom of a tick.
 */
function markTarget(c: CueTagInput): { x: number; y: number } | null {
  const first = c.triggerBoxes[0]
  if (c.mark === 'line' || c.mark === 'pointer') {
    const bar = barOf(c)
    return { x: bar.x, y: c.caret ? c.caret.box.y - UNDERLINE_DROP : bar.y1 }
  }
  if (first) {
    const pad = c.mark === 'highlight' ? HIGHLIGHT_PAD_X : 0
    return {
      x: c.side === 'left' ? first.x - pad : first.x + first.w + pad,
      y: first.y - UNDERLINE_DROP,
    }
  }
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
  note: string | null,
  centre: number,
  pageWidth: number,
  textEdges: { left: number; right: number },
  leaderDrop: number,
): CueTagLayout {
  const left = c.side === 'left'
  const x = left ? TAG_EDGE : pageWidth - TAG_EDGE - w
  const tag: Box = { x, y: centre - TAG_HEIGHT / 2, w, h: TAG_HEIGHT }
  const noteBox = note
    ? {
        text: note,
        box: noteBoxUnder(tag, note, left),
      }
    : null
  const leadX = x + TAG_PAD
  const numberX = lead === '' ? leadX : leadX + helveticaWidth(lead, TAG_FONT_SIZE) + TAG_TEXT_GAP
  const mark = c.mark ?? 'underline'
  const barred = mark === 'line' || mark === 'pointer'
  const underlines =
    mark === 'underline'
      ? c.triggerBoxes.map((b) => ({ x1: b.x, x2: b.x + b.w, y: b.y - UNDERLINE_DROP }))
      : []
  const fills =
    mark === 'highlight'
      ? c.triggerBoxes.map((b) => ({
          x: b.x - HIGHLIGHT_PAD_X,
          y: b.y,
          w: b.w + 2 * HIGHLIGHT_PAD_X,
          h: b.h,
        }))
      : []
  // A tick stands where a mark has no word to sit on: an unbound underline or highlight.
  const tick =
    !barred && c.triggerBoxes.length === 0
      ? { x: c.anchorX, y1: c.y - TICK_BELOW, y2: c.y - TICK_BELOW + TICK_HEIGHT }
      : null
  const bar = barred ? barOf(c) : null
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
    note: noteBox,
    leadX,
    numberX,
    triggerBoxes: c.triggerBoxes.map((b) => ({ ...b })),
    mark,
    fills,
    bar,
    underlines,
    tick,
    leader,
  }
}

/**
 * A cue note cut to the column it prints in: whitespace collapsed, and if it is wider than the
 * column, the longest start of it that fits with an ellipsis. Null when there is no note or the
 * column is narrower than `NOTE_MIN_COLUMN`.
 */
function fitNote(note: string | undefined, column: number): string | null {
  const text = (note ?? '').replace(/\s+/g, ' ').trim()
  if (text === '' || column < NOTE_MIN_COLUMN) return null
  if (helveticaWidth(text, NOTE_FONT_SIZE) <= column) return text
  const chars = [...text]
  let n = chars.length
  while (
    n > 0 &&
    helveticaWidth(chars.slice(0, n).join('').trimEnd() + ELLIPSIS, NOTE_FONT_SIZE) > column
  )
    n--
  return chars.slice(0, n).join('').trimEnd() + ELLIPSIS
}

/** The block under a tag that holds its note, flush with the tag's outer (page-edge) side. */
function noteBoxUnder(tag: Box, text: string, left: boolean): Box {
  const w = helveticaWidth(text, NOTE_FONT_SIZE)
  return { x: left ? tag.x : tag.x + tag.w - w, y: tag.y - NOTE_HEIGHT, w, h: NOTE_HEIGHT }
}

/**
 * The connector from a tag to its mark, always at the mark's y so it never crosses a glyph. A tag
 * level with its line runs straight out, starting under the pill's curve so it meets the outline.
 * A tag spread off its line (above or below it) leaves at its own centre, turns in the gutter beside the text block,
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
