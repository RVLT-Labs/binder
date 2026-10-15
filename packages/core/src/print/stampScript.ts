import {
  closePath,
  degrees,
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
  setFillingColor,
} from 'pdf-lib'
import {
  MARKER_FONT_SIZE,
  NOTE_LINE_HEIGHT,
  NOTE_MAX_WIDTH,
  ANNOTATION_PAD as PAD,
  UNBOUND_FONT,
  unboundSnippet,
  wrapText,
} from '../markup/annotationLayout'
import { helveticaWidth } from '../markup/helvetica'
import { cueMarkerBox, MARKER_PADDING, markerStyle } from '../markup/markers'
import { type FooterInfo, footerText } from './footer'
import type { StampItem } from './stampItems'
import { toWinAnsi } from './winAnsi'

const FOOTER_SIZE = 7
const FOOTER_LEFT = 24
const FOOTER_BOTTOM = 12
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
  ) {
    this.turn = degrees(frame.rotation)
  }

  /** Text whose baseline starts at displayed (x, y), reading upright on the displayed page. */
  text(s: string, x: number, y: number, size: number, colour: ReturnType<typeof rgb>) {
    const text = toWinAnsi(s)
    if (!text) return
    const p = displayedToUser(this.frame, x, y)
    this.page.drawText(text, {
      x: p.x,
      y: p.y,
      size,
      font: this.font,
      color: colour,
      rotate: this.turn,
    })
  }

  /** Text centred vertically on displayed y, as the on-screen markers set theirs. */
  centredText(s: string, x: number, y: number, size: number, colour: ReturnType<typeof rgb>) {
    this.text(s, x, y - size * BASELINE_DROP, size, colour)
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

function drawCue(d: DisplayedPage, item: Extract<StampItem, { kind: 'cue' }>) {
  const colour = colourOf(item.colour)
  const text = toWinAnsi(item.boxText)
  const box = cueMarkerBox(item.x, item.y, helveticaWidth(text, MARKER_FONT_SIZE))
  const style = markerStyle(item.type)
  const solid = style.fill === 'solid'
  d.rect(box.x, box.y, box.w, box.h, {
    // An outline marker keeps a white backing so its number reads over the script's text.
    fill: solid ? colour : WHITE,
    fillOpacity: solid ? 1 : 0.85,
    stroke: style.stroke === 'none' ? undefined : colour,
    strokeWidth: 1.25,
    dash: style.stroke === 'dashed' ? [3, 2] : undefined,
  })
  d.centredText(text, box.x + MARKER_PADDING / 2, item.y, MARKER_FONT_SIZE, solid ? WHITE : colour)
  if (item.labelText)
    haloText(d, item.labelText, box.x + box.w + 3, item.y, MARKER_FONT_SIZE, colour)
}

/** Label text over a white backing that stands in for the screen's white halo. */
function haloText(
  d: DisplayedPage,
  s: string,
  x: number,
  y: number,
  size: number,
  colour: ReturnType<typeof rgb>,
) {
  const text = toWinAnsi(s)
  d.rect(x - 1.5, y - size * 0.7, helveticaWidth(text, size) + 3, size * 1.4, {
    fill: WHITE,
    fillOpacity: 0.8,
  })
  d.centredText(text, x, y, size, colour)
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
 * The script PDF with its markup drawn on: markers, annotations, and a footer on every page.
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
  const pages = doc.getPages()
  const drawers = pages.map((page) => new DisplayedPage(page, frameOf(page), font))

  for (const item of items) {
    const d = drawers[item.pageIndex]
    if (!d) continue
    if (item.kind === 'cue') drawCue(d, item)
    else drawAnnotation(d, item)
  }

  const line = footerText(footer)
  for (const d of drawers) d.text(line, FOOTER_LEFT, FOOTER_BOTTOM, FOOTER_SIZE, FOOTER_GREY)
  return doc.save()
}
