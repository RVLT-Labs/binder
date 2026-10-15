import {
  appendBezierCurve,
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
  setDashPattern,
  setFillingColor,
  setLineWidth,
  setStrokingColor,
  stroke as strokePath,
} from 'pdf-lib'
import {
  NOTE_LINE_HEIGHT,
  NOTE_MAX_WIDTH,
  ANNOTATION_PAD as PAD,
  UNBOUND_FONT,
  unboundSnippet,
  wrapText,
} from '../markup/annotationLayout'
import {
  type CueTagInput,
  type CueTagLayout,
  LEADER_WIDTH,
  layoutCueTags,
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
const INK = rgb(0.067, 0.094, 0.153)
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
  ) {
    const text = toWinAnsi(s)
    if (!text) return
    const p = displayedToUser(this.frame, x, y)
    this.page.drawText(text, {
      x: p.x,
      y: p.y,
      size,
      font: bold ? this.boldFont : this.font,
      color: colour,
      rotate: this.turn,
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

  /** A white-or-coloured rounded rectangle, filled and/or outlined, in displayed space. */
  roundedRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    o: {
      fill?: ReturnType<typeof rgb>
      stroke?: ReturnType<typeof rgb>
      strokeWidth?: number
      dash?: number[]
    },
  ) {
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

interface PlacedCue {
  layout: CueTagLayout
  colour: ReturnType<typeof rgb>
}

/**
 * The cues of one page, laid out together so crowded tags stack inside the page, clear of the
 * footer. Underlines and connectors go down first, under the annotations as on screen; the opaque
 * tags go on last. Print never fills the trigger words: the script stays as it was, underlined.
 */
function layoutCues(pageWidth: number, pageHeight: number, items: CueItem[]): PlacedCue[] {
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
    anchorX: c.x,
    sortKey: c.sortKey,
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
  }))
}

function drawTrigger(d: DisplayedPage, t: CueTagLayout, colour: ReturnType<typeof rgb>) {
  for (const u of t.underlines) d.line(u.x1, u.y, u.x2, u.y, colour, UNDERLINE_WIDTH)
  if (t.tick) d.line(t.tick.x, t.tick.y1, t.tick.x, t.tick.y2, colour, UNDERLINE_WIDTH)
  for (let i = 1; t.leader && i < t.leader.length; i++) {
    const [a, b] = [t.leader[i - 1], t.leader[i]] as Array<{ x: number; y: number }>
    d.line(a.x, a.y, b.x, b.y, colour, LEADER_WIDTH)
  }
}

function drawTag(d: DisplayedPage, t: CueTagLayout, colour: ReturnType<typeof rgb>) {
  const { tag } = t
  // An opaque white pill outlined in the department colour: the script never shows through.
  d.roundedRect(tag.x, tag.y, tag.w, tag.h, TAG_RADIUS, {
    fill: WHITE,
    stroke: colour,
    strokeWidth: t.outlineWidth,
    dash: t.dash ? [3, 2] : undefined,
  })
  if (t.lead) d.centredText(t.lead, t.leadX, t.centreY, TAG_FONT_SIZE, colour)
  d.centredText(t.number, t.numberX, t.centreY, TAG_FONT_SIZE, INK, true)
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
      // The anchor is the note's top-left corner.
      d.rect(x, y - h, w, h, { fill: WHITE, fillOpacity: 0.92, stroke: colour, strokeWidth: 1.25 })
      d.rect(x, y - h, 3, h, { fill: colour })
      for (const [i, line] of lines.entries()) {
        d.centredText(line, x + PAD + 3, y - PAD - lineHeight * (i + 0.5), item.fontSize, INK)
      }
      return
    }
    case 'stamp': {
      const text = toWinAnsi(item.text)
      const w = helveticaWidth(text, item.fontSize) + PAD * 3
      const h = item.fontSize + PAD * 2
      // A stamp sits centred on the point it was placed at.
      d.rect(x - w / 2, y - h / 2, w, h, {
        fill: WHITE,
        fillOpacity: 0.85,
        stroke: colour,
        strokeWidth: sw,
      })
      d.centredText(text, x - w / 2 + PAD * 1.5, y, item.fontSize, colour)
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

/**
 * The script PDF with its markup drawn on: cue tags, annotations, and a footer on every page.
 * Pages are only drawn on, so sizes, boxes, rotation and the invisible text layer are untouched.
 * Item coordinates are displayed page space, relative to each page's visible box; items for
 * pages the PDF does not have are skipped.
 */
export async function stampScript(
  pdf: Uint8Array,
  items: StampItem[],
  footer: FooterInfo,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold)
  const pages = doc.getPages()
  const drawers = pages.map((page) => new DisplayedPage(page, frameOf(page), font, boldFont))

  const cuesByPage = new Map<number, CueItem[]>()
  for (const item of items) {
    if (!drawers[item.pageIndex]) continue
    if (item.kind === 'cue')
      cuesByPage.set(item.pageIndex, [...(cuesByPage.get(item.pageIndex) ?? []), item])
  }
  const placed = new Map<number, PlacedCue[]>()
  for (const [pageIndex, cues] of cuesByPage) {
    const frame = frameOf(pages[pageIndex] as PDFPage)
    const quarter = frame.rotation === 90 || frame.rotation === 270
    placed.set(
      pageIndex,
      layoutCues(quarter ? frame.h : frame.w, quarter ? frame.w : frame.h, cues),
    )
  }
  // Underlines and connectors first, then the annotations, then the tags, which are opaque and
  // so sit on top of everything: the order the screen draws in.
  for (const [pageIndex, cues] of placed)
    for (const { layout, colour } of cues)
      drawTrigger(drawers[pageIndex] as DisplayedPage, layout, colour)
  for (const item of items) {
    const d = drawers[item.pageIndex]
    if (d && item.kind === 'annotation') drawAnnotation(d, item)
  }
  for (const [pageIndex, cues] of placed)
    for (const { layout, colour } of cues)
      drawTag(drawers[pageIndex] as DisplayedPage, layout, colour)

  const line = footerText(footer)
  for (const d of drawers) d.text(line, FOOTER_LEFT, FOOTER_BOTTOM, FOOTER_SIZE, FOOTER_GREY)
  return doc.save()
}
