import type { PaperSize } from '@binder/shared'
import {
  appendBezierCurve,
  BlendMode,
  closePath,
  degrees,
  fillAndStroke,
  fill as fillPath,
  lineTo,
  moveTo,
  PDFDocument,
  type PDFFont,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
  setCharacterSpacing,
  setDashPattern,
  setFillingColor,
  setLineWidth,
  setStrokingColor,
  stroke as strokePath,
} from 'pdf-lib'
import {
  mixIntoWhite,
  NOTE_BAR_WIDTH,
  NOTE_LINE_HEIGHT,
  NOTE_MAX_WIDTH,
  NOTE_TINT,
  ANNOTATION_PAD as PAD,
  STAMP_ANGLE,
  STAMP_FILL_OPACITY,
  STAMP_TRACKING,
  stampTextWidth,
  UNBOUND_FONT,
  unboundSnippet,
  wrapText,
} from '../markup/annotationLayout'
import {
  BAR_WIDTH,
  type CueTagInput,
  type CueTagLayout,
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_RADIUS,
  LEADER_WIDTH,
  layoutCueTags,
  NOTE_FONT_SIZE,
  POINTER_HEIGHT,
  POINTER_WIDTH,
  TAG_FONT_SIZE,
  TAG_RADIUS,
  UNDERLINE_WIDTH,
} from '../markup/cueTags'
import { helveticaWidth } from '../markup/helvetica'
import { type FooterInfo, footerText } from './footer'
import type { StampItem } from './stampItems'
import { toWinAnsi } from './winAnsi'

const FOOTER_SIZE = 7
const FOOTER_LEFT = 24
const FOOTER_BOTTOM = 12
/** The footer's top edge: tags never go below it, so none ends up under the footer text. */
const FOOTER_TOP = FOOTER_BOTTOM + FOOTER_SIZE
const FOOTER_GREY = rgb(0.45, 0.45, 0.45)
const PAGE_INK_RGB = rgb(0x1a / 255, 0x17 / 255, 0x15 / 255)
const WHITE = rgb(1, 1, 1)
/** Helvetica's cap height is about 0.72 em: centring a line on y puts its baseline this far below. */
const BASELINE_DROP = 0.36

/** A page's visible box and rotation, which together define how displayed space maps to user space. */
export interface PageFrame {
  /** Lower-left corner of the visible box (crop box clipped to the media box), in user space. */
  bx: number
  by: number
  /** The visible box's unrotated width and height. */
  w: number
  h: number
  /** 0, 90, 180 or 270. */
  rotation: 0 | 90 | 180 | 270
}

/**
 * A displayed point (relative to the visible box, origin bottom-left, after `/Rotate`) in the
 * page's user space.
 */
export function displayedToUser(f: PageFrame, dx: number, dy: number): { x: number; y: number } {
  switch (f.rotation) {
    case 90:
      return { x: f.bx + f.w - dy, y: f.by + dx }
    case 180:
      return { x: f.bx + f.w - dx, y: f.by + f.h - dy }
    case 270:
      return { x: f.bx + dy, y: f.by + f.h - dx }
    default:
      return { x: f.bx + dx, y: f.by + dy }
  }
}

/** A box's corners in either order, as poppler reads them: lower-left first, non-negative size. */
function normalised(box: { x: number; y: number; width: number; height: number }) {
  return {
    x0: Math.min(box.x, box.x + box.width),
    y0: Math.min(box.y, box.y + box.height),
    x1: Math.max(box.x, box.x + box.width),
    y1: Math.max(box.y, box.y + box.height),
  }
}

/** The frame displayed space is measured in: the visible box and `/Rotate` of a page. */
export function frameOf(page: PDFPage): PageFrame {
  const media = normalised(page.getMediaBox())
  const crop = normalised(page.getCropBox())
  // The visible box is the crop box clipped to the media box.
  const x0 = Math.max(media.x0, crop.x0)
  const y0 = Math.max(media.y0, crop.y0)
  const x1 = Math.min(media.x1, crop.x1)
  const y1 = Math.min(media.y1, crop.y1)
  const clipped = x1 > x0 && y1 > y0
  const angle = (((Math.round(page.getRotation().angle / 90) * 90) % 360) + 360) % 360
  return clipped
    ? { bx: x0, by: y0, w: x1 - x0, h: y1 - y0, rotation: angle as PageFrame['rotation'] }
    : {
        bx: media.x0,
        by: media.y0,
        w: media.x1 - media.x0,
        h: media.y1 - media.y0,
        rotation: angle as PageFrame['rotation'],
      }
}

function colourOf(hex: string) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return rgb(0.42, 0.45, 0.5)
  const n = Number.parseInt(m[1] as string, 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/**
 * A rounded rectangle as an SVG path with its top-left corner at the origin, y pointing down (as
 * `drawSvgPath` reads it), `w` wide, `h` tall, corners of radius `r`.
 */
function roundedRectPath(w: number, h: number, r: number): string {
  const k = r * 0.5523
  return `M ${r} 0 L ${w - r} 0 C ${w - r + k} 0 ${w} ${r - k} ${w} ${r} L ${w} ${h - r} C ${w} ${h - r + k} ${w - r + k} ${h} ${w - r} ${h} L ${r} ${h} C ${r - k} ${h} 0 ${h - r + k} 0 ${h - r} L 0 ${r} C 0 ${r - k} ${r - k} 0 ${r} 0 Z`
}

/** Draws in displayed space on one page: every point and rotation goes through the page frame. */
class DisplayedPage {
  private readonly turn
  constructor(
    private readonly page: PDFPage,
    private readonly frame: PageFrame,
    private readonly font: PDFFont,
    private readonly boldFont: PDFFont,
  ) {
    this.turn = degrees(frame.rotation)
  }

  /** Text whose baseline starts at displayed (x, y), reading upright on the displayed page. */
  text(
    s: string,
    x: number,
    y: number,
    size: number,
    colour: ReturnType<typeof rgb>,
    bold = false,
    o: { extraTurn?: number; tracking?: number } = {},
  ) {
    const text = toWinAnsi(s)
    if (!text) return
    const p = displayedToUser(this.frame, x, y)
    if (o.tracking) this.page.pushOperators(pushGraphicsState(), setCharacterSpacing(o.tracking))
    this.page.drawText(text, {
      x: p.x,
      y: p.y,
      size,
      font: bold ? this.boldFont : this.font,
      color: colour,
      rotate: degrees(this.frame.rotation + (o.extraTurn ?? 0)),
    })
    if (o.tracking) this.page.pushOperators(popGraphicsState())
  }

  /**
   * A rounded rectangle turned `angle` degrees counter-clockwise about its centre (displayed
   * space), filled and outlined, the fill at `fillOpacity`.
   */
  turnedRoundedRect(
    cx: number,
    cy: number,
    w: number,
    h: number,
    r: number,
    angle: number,
    o: {
      fill: ReturnType<typeof rgb>
      fillOpacity: number
      stroke: ReturnType<typeof rgb>
      strokeWidth: number
    },
  ) {
    const rad = (angle * Math.PI) / 180
    // The top-left corner after the turn; drawSvgPath's origin is that corner, y pointing down.
    const dx = -w / 2
    const dy = h / 2
    const corner = displayedToUser(
      this.frame,
      cx + dx * Math.cos(rad) - dy * Math.sin(rad),
      cy + dx * Math.sin(rad) + dy * Math.cos(rad),
    )
    this.svgRoundedRect(corner, angle, w, h, r, {
      color: o.fill,
      opacity: o.fillOpacity,
      borderColor: o.stroke,
      borderWidth: o.strokeWidth,
      borderOpacity: 1,
    })
  }

  /**
   * A rounded rectangle through `drawSvgPath`, which keeps opacity and blend mode in an ExtGState.
   * `corner` is its top-left corner in user space; it is turned `angle` degrees on top of the
   * page's own rotation.
   */
  private svgRoundedRect(
    corner: { x: number; y: number },
    angle: number,
    w: number,
    h: number,
    r: number,
    o: Parameters<PDFPage['drawSvgPath']>[1],
  ) {
    this.page.drawSvgPath(roundedRectPath(w, h, r), {
      ...o,
      x: corner.x,
      y: corner.y,
      rotate: degrees(this.frame.rotation + angle),
    })
  }

  /** Text centred vertically on displayed y, as the on-screen markers set theirs. */
  centredText(
    s: string,
    x: number,
    y: number,
    size: number,
    colour: ReturnType<typeof rgb>,
    bold = false,
  ) {
    this.text(s, x, y - size * BASELINE_DROP, size, colour, bold)
  }

  /** An axis-aligned rectangle in displayed space with its lower-left corner at (x, y). */
  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    o: {
      fill?: ReturnType<typeof rgb>
      fillOpacity?: number
      stroke?: ReturnType<typeof rgb>
      strokeWidth?: number
      dash?: number[]
      blendMode?: BlendMode
    },
  ) {
    const p = displayedToUser(this.frame, x, y)
    this.page.drawRectangle({
      x: p.x,
      y: p.y,
      width: w,
      height: h,
      rotate: this.turn,
      color: o.fill,
      opacity: o.fill ? (o.fillOpacity ?? 1) : undefined,
      borderColor: o.stroke,
      borderWidth: o.stroke ? (o.strokeWidth ?? 1) : 0,
      borderDashArray: o.dash,
      blendMode: o.blendMode,
    })
  }

  ellipse(
    x: number,
    y: number,
    w: number,
    h: number,
    stroke: ReturnType<typeof rgb>,
    width: number,
  ) {
    const c = displayedToUser(this.frame, x + w / 2, y + h / 2)
    this.page.drawEllipse({
      x: c.x,
      y: c.y,
      xScale: w / 2,
      yScale: h / 2,
      rotate: this.turn,
      borderColor: stroke,
      borderWidth: width,
    })
  }

  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    colour: ReturnType<typeof rgb>,
    width: number,
  ) {
    this.page.drawLine({
      start: displayedToUser(this.frame, x1, y1),
      end: displayedToUser(this.frame, x2, y2),
      thickness: width,
      color: colour,
      lineCap: 1,
    })
  }

  /**
   * A white-or-coloured rounded rectangle, filled and/or outlined, in displayed space. A fill
   * `fillOpacity` below 1 or a `blendMode` is drawn through the page's graphics state (the
   * outline stays opaque and un-blended); without them it is plain path operators.
   */
  roundedRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    o: {
      fill?: ReturnType<typeof rgb>
      fillOpacity?: number
      stroke?: ReturnType<typeof rgb>
      strokeWidth?: number
      dash?: number[]
      blendMode?: BlendMode
    },
  ) {
    if (o.fill && (o.blendMode !== undefined || o.fillOpacity !== undefined)) {
      this.blendedRoundedRect(x, y, w, h, r, { ...o, fill: o.fill })
      return
    }
    const k = r * 0.5523
    const u = (dx: number, dy: number) => displayedToUser(this.frame, dx, dy)
    const corner = (c1: [number, number], c2: [number, number], to: [number, number]) => {
      const [a, b, e] = [u(...c1), u(...c2), u(...to)]
      return appendBezierCurve(a.x, a.y, b.x, b.y, e.x, e.y)
    }
    const line = (to: [number, number]) => lineTo(u(...to).x, u(...to).y)
    const start = u(x + r, y)
    const both = o.fill && o.stroke
    this.page.pushOperators(
      pushGraphicsState(),
      ...(o.fill ? [setFillingColor(o.fill)] : []),
      ...(o.stroke ? [setStrokingColor(o.stroke), setLineWidth(o.strokeWidth ?? 1)] : []),
      ...(o.dash ? [setDashPattern(o.dash, 0)] : []),
      moveTo(start.x, start.y),
      line([x + w - r, y]),
      corner([x + w - r + k, y], [x + w, y + r - k], [x + w, y + r]),
      line([x + w, y + h - r]),
      corner([x + w, y + h - r + k], [x + w - r + k, y + h], [x + w - r, y + h]),
      line([x + r, y + h]),
      corner([x + r - k, y + h], [x, y + h - r + k], [x, y + h - r]),
      line([x, y + r]),
      corner([x, y + r - k], [x + r - k, y], [x + r, y]),
      closePath(),
      both ? fillAndStroke() : o.fill ? fillPath() : strokePath(),
      popGraphicsState(),
    )
  }

  /** `roundedRect` for a fill that is translucent or blended: pdf-lib keeps those in an ExtGState. */
  private blendedRoundedRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
    o: {
      fill: ReturnType<typeof rgb>
      fillOpacity?: number
      stroke?: ReturnType<typeof rgb>
      strokeWidth?: number
      dash?: number[]
      blendMode?: BlendMode
    },
  ) {
    // drawSvgPath's origin is the shape's top-left corner with y pointing down.
    const corner = displayedToUser(this.frame, x, y + h)
    this.svgRoundedRect(corner, 0, w, h, Math.min(radius, w / 2, h / 2), {
      color: o.fill,
      opacity: o.fillOpacity,
      borderColor: o.stroke,
      borderWidth: o.stroke ? (o.strokeWidth ?? 1) : 0,
      borderDashArray: o.dash,
      blendMode: o.blendMode,
    })
  }

  /** A filled polygon through displayed points. */
  polygon(points: Array<[number, number]>, colour: ReturnType<typeof rgb>) {
    const [first, ...rest] = points.map(([x, y]) => displayedToUser(this.frame, x, y))
    if (!first) return
    this.page.pushOperators(
      pushGraphicsState(),
      setFillingColor(colour),
      moveTo(first.x, first.y),
      ...rest.map((p) => lineTo(p.x, p.y)),
      closePath(),
      fillPath(),
      popGraphicsState(),
    )
  }
}

type CueItem = Extract<StampItem, { kind: 'cue' }>
type CueNoteItem = Extract<StampItem, { kind: 'cue-note' }>

interface PlacedCue {
  layout: CueTagLayout
  colour: ReturnType<typeof rgb>
  numberInk: ReturnType<typeof rgb>
  /** The note's colour, when the cue has one. */
  noteColour: ReturnType<typeof rgb> | null
}

/**
 * The cues of one page, laid out together so crowded tags stack inside the page, clear of the
 * footer. Fills, underlines, bars and connectors go down first, under the annotations as on
 * screen; the opaque tags go on last. Only a highlight mark fills the trigger words, translucently
 * and multiplied, so the script text stays black; the other marks leave the script as it was.
 */
function layoutCues(
  pageWidth: number,
  pageHeight: number,
  items: CueItem[],
  notes: ReadonlyMap<string, CueNoteItem>,
): PlacedCue[] {
  const extent = items.find((c) => c.textExtent)?.textExtent ?? null
  const inputs: CueTagInput[] = items.map((c) => ({
    id: c.id,
    y: c.y,
    side: c.side,
    type: c.type,
    lead: toWinAnsi(c.lead),
    typeWord: c.typeWord,
    number: toWinAnsi(c.number),
    triggerBoxes: c.triggerBoxes,
    mark: c.mark,
    caret: c.caret,
    anchorX: c.x,
    sortKey: c.sortKey,
    note: toWinAnsi(notes.get(c.id)?.text ?? ''),
  }))
  const layouts = layoutCueTags({
    pageWidth,
    bounds: { minY: FOOTER_TOP, maxY: pageHeight },
    textExtent: extent,
    cues: inputs,
  })
  return layouts.map((layout, i) => ({
    layout,
    colour: colourOf((items[i] as CueItem).colour),
    numberInk: colourOf((items[i] as CueItem).numberInk),
    noteColour: noteColourOf(notes.get((items[i] as CueItem).id)),
  }))
}

const noteColourOf = (note: CueNoteItem | undefined) => (note ? colourOf(note.colour) : null)

/** A pointer's triangle sits above the bar's top and points down at it. */
function drawBar(
  d: DisplayedPage,
  bar: NonNullable<CueTagLayout['bar']>,
  colour: ReturnType<typeof rgb>,
) {
  d.line(bar.x, bar.y1, bar.x, bar.y2, colour, BAR_WIDTH)
  if (!bar.pointer) return
  const top = bar.y2 + POINTER_HEIGHT
  d.polygon(
    [
      [bar.x, bar.y2],
      [bar.x - POINTER_WIDTH / 2, top],
      [bar.x + POINTER_WIDTH / 2, top],
    ],
    colour,
  )
}

function drawTrigger(d: DisplayedPage, t: CueTagLayout, colour: ReturnType<typeof rgb>) {
  // Multiply keeps black script text black under the tint; the fill is translucent too.
  for (const f of t.fills)
    d.roundedRect(f.x, f.y, f.w, f.h, HIGHLIGHT_RADIUS, {
      fill: colour,
      fillOpacity: HIGHLIGHT_OPACITY,
      blendMode: BlendMode.Multiply,
    })
  for (const u of t.underlines) d.line(u.x1, u.y, u.x2, u.y, colour, UNDERLINE_WIDTH)
  if (t.tick) d.line(t.tick.x, t.tick.y1, t.tick.x, t.tick.y2, colour, UNDERLINE_WIDTH)
  if (t.bar) drawBar(d, t.bar, colour)
  for (let i = 1; t.leader && i < t.leader.length; i++) {
    const [a, b] = [t.leader[i - 1], t.leader[i]] as Array<{ x: number; y: number }>
    d.line(a.x, a.y, b.x, b.y, colour, LEADER_WIDTH)
  }
}

function drawTag(
  d: DisplayedPage,
  t: CueTagLayout,
  colour: ReturnType<typeof rgb>,
  numberInk: ReturnType<typeof rgb>,
) {
  const { tag } = t
  // An opaque white pill outlined in the department colour: the script never shows through.
  d.roundedRect(tag.x, tag.y, tag.w, tag.h, TAG_RADIUS, {
    fill: WHITE,
    stroke: colour,
    strokeWidth: t.outlineWidth,
    dash: t.dash ? [3, 2] : undefined,
  })
  if (t.lead) d.centredText(t.lead, t.leadX, t.centreY, TAG_FONT_SIZE, colour)
  d.centredText(t.number, t.numberX, t.centreY, TAG_FONT_SIZE, numberInk, true)
}

/** The cue's note: one line of 7 pt text in the department colour, under the tag. */
function drawNote(d: DisplayedPage, t: CueTagLayout, colour: ReturnType<typeof rgb>) {
  if (!t.note) return
  const { box, text } = t.note
  d.centredText(text, box.x, box.y + box.h / 2, NOTE_FONT_SIZE, colour)
}

function drawAnnotation(d: DisplayedPage, item: Extract<StampItem, { kind: 'annotation' }>) {
  const { x, y, geometry: g } = item
  const colour = colourOf(item.colour)
  const sw = item.strokeWidth
  const num = (key: string) => Number(g[key]) || 0
  switch (item.type) {
    case 'rect':
      d.rect(x, y, num('w'), num('h'), { stroke: colour, strokeWidth: sw })
      return
    case 'ellipse':
      d.ellipse(x, y, num('w'), num('h'), colour, sw)
      return
    case 'line':
    case 'arrow': {
      const x2 = x + num('dx')
      const y2 = y + num('dy')
      d.line(x, y, x2, y2, colour, sw)
      if (item.type === 'arrow') {
        const head = Math.min(Math.max(6, sw * 4), Math.hypot(x2 - x, y2 - y) * 0.6)
        const angle = Math.atan2(y2 - y, x2 - x)
        const at = (da: number): [number, number] => [
          x2 + head * Math.cos(angle + Math.PI + da),
          y2 + head * Math.sin(angle + Math.PI + da),
        ]
        d.polygon([[x2, y2], at(0.45), at(-0.45)], colour)
      }
      return
    }
    case 'note': {
      const lines = wrapText(item.text, item.fontSize, NOTE_MAX_WIDTH).map(toWinAnsi)
      const lineHeight = item.fontSize * NOTE_LINE_HEIGHT
      const textWidth = Math.max(...lines.map((l) => helveticaWidth(l, item.fontSize)))
      const w = textWidth + PAD * 2 + 3
      const h = lines.length * lineHeight + PAD * 2
      // The anchor is the note's top-left corner: a tinted block with a bar on its left and no outline.
      d.rect(x, y - h, w, h, { fill: colourOf(mixIntoWhite(item.colour, NOTE_TINT)) })
      d.rect(x, y - h, NOTE_BAR_WIDTH, h, { fill: colour })
      for (const [i, line] of lines.entries()) {
        d.centredText(
          line,
          x + PAD + 3,
          y - PAD - lineHeight * (i + 0.5),
          item.fontSize,
          PAGE_INK_RGB,
        )
      }
      return
    }
    case 'stamp': {
      const text = toWinAnsi(item.text)
      const w = stampTextWidth(text, item.fontSize) + PAD * 3
      const h = item.fontSize + PAD * 2
      // A stamp sits centred on the point it was placed at, turned -3deg about that centre.
      d.turnedRoundedRect(x, y, w, h, 3, STAMP_ANGLE, {
        fill: WHITE,
        fillOpacity: STAMP_FILL_OPACITY,
        stroke: colour,
        strokeWidth: sw,
      })
      const rad = (STAMP_ANGLE * Math.PI) / 180
      const ox = -w / 2 + PAD * 1.5
      const oy = -item.fontSize * BASELINE_DROP
      d.text(
        text,
        x + ox * Math.cos(rad) - oy * Math.sin(rad),
        y + ox * Math.sin(rad) + oy * Math.cos(rad),
        item.fontSize,
        colour,
        true,
        { extraTurn: STAMP_ANGLE, tracking: STAMP_TRACKING * item.fontSize },
      )
      return
    }
    default: {
      if (item.wordBoxes.length > 0) {
        for (const b of item.wordBoxes)
          d.rect(b.x, b.y, b.w, b.h, { fill: colour, fillOpacity: 0.35 })
        return
      }
      // The words are not bound: a dashed marker at the anchor, as on screen.
      const snippet = toWinAnsi(unboundSnippet(item.text))
      const w = helveticaWidth(snippet, UNBOUND_FONT) + 8
      d.rect(x, y - 6, w, 12, {
        fill: WHITE,
        fillOpacity: 0.85,
        stroke: colour,
        strokeWidth: 1.25,
        dash: [3, 2],
      })
      d.centredText(snippet, x + 4, y, UNBOUND_FONT, colour)
    }
  }
}

/** The paper sizes in points, portrait. */
export const PAPER_POINTS: Record<PaperSize, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
}
/** A page this close to the paper's size (each side) is left as it is. */
const FIT_TOLERANCE = 0.03

export interface StampOptions {
  /** Zero-based indices of the pages to keep; the output has just these, in page order. */
  pages?: readonly number[]
  /** Fit every page to this paper, centred and scaled to fit, the sheet turned to match the page. */
  paper?: PaperSize
}

/**
 * The script PDF with its markup drawn on: cue tags (and their notes), annotations, and a footer
 * on every page. Item coordinates are displayed page space, relative to each page's visible box;
 * items for pages the PDF does not have, or that `pages` leaves out, are skipped.
 *
 * Without options pages are only drawn on, so sizes, boxes, rotation and the invisible text layer
 * are untouched. `pages` copies the chosen pages into a fresh document, so the rest of the script
 * is not carried along. `paper` then wraps each stamped page that is not already within 3% of the
 * paper in a page of that paper, scaled to fit and centred; the wrapped page is a form XObject, so
 * its text still reads, and the footer scales with the page.
 */
export async function stampScript(
  pdf: Uint8Array,
  items: StampItem[],
  footer: FooterInfo,
  opts: StampOptions = {},
): Promise<Uint8Array> {
  const src = await PDFDocument.load(pdf, { updateMetadata: false })
  const { doc, remap } = await subset(src, opts.pages)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold)
  const pages = doc.getPages()
  const drawers = pages.map((page) => new DisplayedPage(page, frameOf(page), font, boldFont))

  const kept: StampItem[] = []
  for (const item of items) {
    const pageIndex = remap(item.pageIndex)
    if (pageIndex !== undefined && drawers[pageIndex]) kept.push({ ...item, pageIndex })
  }
  const notes = new Map<string, CueNoteItem>()
  for (const item of kept) if (item.kind === 'cue-note') notes.set(item.cueId, item)
  const cuesByPage = new Map<number, CueItem[]>()
  for (const item of kept) {
    if (item.kind === 'cue')
      cuesByPage.set(item.pageIndex, [...(cuesByPage.get(item.pageIndex) ?? []), item])
  }
  const placed = new Map<number, PlacedCue[]>()
  for (const [pageIndex, cues] of cuesByPage) {
    const frame = frameOf(pages[pageIndex] as PDFPage)
    const quarter = frame.rotation === 90 || frame.rotation === 270
    placed.set(
      pageIndex,
      layoutCues(quarter ? frame.h : frame.w, quarter ? frame.w : frame.h, cues, notes),
    )
  }
  // Underlines and connectors first, then the annotations, then the tags, which are opaque and
  // so sit on top of everything: the order the screen draws in. Notes go last: they sit in the
  // margin, clear of the tags.
  for (const [pageIndex, cues] of placed)
    for (const { layout, colour } of cues)
      drawTrigger(drawers[pageIndex] as DisplayedPage, layout, colour)
  for (const item of kept) {
    const d = drawers[item.pageIndex]
    if (d && item.kind === 'annotation') drawAnnotation(d, item)
  }
  for (const [pageIndex, cues] of placed)
    for (const { layout, colour, numberInk } of cues)
      drawTag(drawers[pageIndex] as DisplayedPage, layout, colour, numberInk)
  for (const [pageIndex, cues] of placed)
    for (const { layout, noteColour } of cues)
      if (noteColour) drawNote(drawers[pageIndex] as DisplayedPage, layout, noteColour)

  const line = footerText(footer)
  for (const d of drawers) d.text(line, FOOTER_LEFT, FOOTER_BOTTOM, FOOTER_SIZE, FOOTER_GREY)
  if (opts.paper) await fitToPaper(doc, opts.paper)
  return doc.save()
}

/**
 * The document to stamp: `src` itself, or when `pages` is given a fresh one holding copies of just
 * those pages (pdf-lib's `removePage` leaves the orphaned objects in the file, copying does not).
 * `remap` gives a source page's index in that document, or undefined when it was left out.
 */
async function subset(
  src: PDFDocument,
  pages: readonly number[] | undefined,
): Promise<{ doc: PDFDocument; remap: (sourceIndex: number) => number | undefined }> {
  if (!pages) return { doc: src, remap: (i) => i }
  const count = src.getPageCount()
  const keep = [...new Set(pages)].sort((a, b) => a - b)
  if (keep.length === 0) throw new RangeError('Choose at least one page to print.')
  const bad = keep.find((i) => !Number.isInteger(i) || i < 0 || i >= count)
  if (bad !== undefined)
    throw new RangeError(`Page ${bad + 1} is not in this ${count}-page script.`)
  const doc = await PDFDocument.create({ updateMetadata: false })
  for (const page of await doc.copyPages(src, keep)) doc.addPage(page)
  const out = new Map(keep.map((from, to) => [from, to]))
  return { doc, remap: (i) => out.get(i) }
}

/** Where displayed space sits in a page's user space, as a form matrix (the inverse of `displayedToUser`). */
function toDisplayedMatrix(f: PageFrame): [number, number, number, number, number, number] {
  switch (f.rotation) {
    case 90:
      return [0, -1, 1, 0, -f.by, f.bx + f.w]
    case 180:
      return [-1, 0, 0, -1, f.bx + f.w, f.by + f.h]
    case 270:
      return [0, 1, -1, 0, f.by + f.h, -f.bx]
    default:
      return [1, 0, 0, 1, -f.bx, -f.by]
  }
}

/**
 * Replaces each page that is not already within 3% of `paper` (in both directions, with the sheet
 * turned to the page's orientation) by a page of the paper that draws the old one, scaled to fit
 * and centred. The old page is embedded by its visible box and `/Rotate`, the frame the stamps
 * use, so the new page is upright with no rotation of its own.
 */
async function fitToPaper(doc: PDFDocument, paper: PaperSize): Promise<void> {
  const { width: pw, height: ph } = PAPER_POINTS[paper]
  const pages = doc.getPages()
  for (const [i, page] of pages.entries()) {
    const frame = frameOf(page)
    const quarter = frame.rotation === 90 || frame.rotation === 270
    const w = quarter ? frame.h : frame.w
    const h = quarter ? frame.w : frame.h
    const [tw, th] = w > h ? [ph, pw] : [pw, ph]
    if (Math.abs(w / tw - 1) <= FIT_TOLERANCE && Math.abs(h / th - 1) <= FIT_TOLERANCE) continue
    const embedded = await doc.embedPage(
      page,
      { left: frame.bx, bottom: frame.by, right: frame.bx + frame.w, top: frame.by + frame.h },
      toDisplayedMatrix(frame),
    )
    const scale = Math.min(tw / w, th / h)
    const sheet = doc.insertPage(i, [tw, th])
    sheet.drawPage(embedded, {
      x: (tw - w * scale) / 2,
      y: (th - h * scale) / 2,
      xScale: scale,
      yScale: scale,
    })
    doc.removePage(i + 1)
  }
}
