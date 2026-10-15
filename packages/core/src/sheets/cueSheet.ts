import type { CueType } from '@binder/shared'
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib'
import type { CueListFlag, CueListRow } from '../cues/cueList'
import { wrapText } from '../markup/annotationLayout'
import { helveticaWidth } from '../markup/helvetica'
import { type FooterInfo, footerText } from '../print/footer'
import { toWinAnsi } from '../print/winAnsi'

/** One line of a department's cue sheet, as every export format shows it. */
export interface CueSheetRow {
  /** The number as the department displays it: `10`, `10.5` or `10.50`. Text, so it keeps its format. */
  cue: string
  type: CueType
  label: string
  /** One-based page of the cue's anchor; null for an unplaced cue. */
  page: number | null
  /** The document title, only when the department has cues in more than one document. */
  document: string
  /** The quote the cue was snapped to. */
  trigger: string
  notes: string
  /** The cue list's flags as words, joined with a comma; empty when there are none. */
  status: string
}

export const CUE_SHEET_COLUMNS = [
  'Cue',
  'Type',
  'Label',
  'Page',
  'Document',
  'Trigger',
  'Notes',
  'Status',
] as const

const FLAG_WORDS: Record<CueListFlag, string> = {
  duplicate: 'duplicate',
  approximate: 'approximate',
  unresolved: 'unresolved',
  'older-version': 'on older version',
}

/**
 * The cue list's rows as sheet rows. `page` comes from the anchor (one-based), not from the list's
 * display string, which carries the document title and a `p.` prefix.
 */
export function toCueSheetRows(rows: CueListRow[]): CueSheetRow[] {
  return rows.map((r) => ({
    cue: r.display,
    type: r.type,
    label: r.label,
    page: r.anchor ? r.anchor.pageIndex + 1 : null,
    document: r.documentTitle,
    trigger: r.trigger,
    notes: r.notes,
    status: r.flags.map((f) => FLAG_WORDS[f]).join(', '),
  }))
}

/** The cells of a row, in column order; a missing page is `null`. */
export function cueSheetCells(r: CueSheetRow): Array<string | number | null> {
  return [r.cue, r.type, r.label, r.page, r.document, r.trigger, r.notes, r.status]
}

// ---- CSV -----------------------------------------------------------------------------------

/** A spreadsheet reads a cell starting with one of these as a formula; the apostrophe makes it text. */
const FORMULA_START = /^[=+\-@\t\r]/

function csvCell(value: string | number | null): string {
  if (value === null) return ''
  let text = String(value)
  if (FORMULA_START.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * The sheet as CSV: UTF-8 behind a byte order mark (so Excel reads it as UTF-8), CRLF after every
 * line, RFC 4180 quoting, and a leading apostrophe on any cell a spreadsheet would run as a formula.
 */
export function cueSheetCsv(rows: CueSheetRow[]): string {
  const lines = [
    CUE_SHEET_COLUMNS.join(','),
    ...rows.map((r) => cueSheetCells(r).map(csvCell).join(',')),
  ]
  return `\uFEFF${lines.map((l) => `${l}\r\n`).join('')}`
}

// ---- PDF -----------------------------------------------------------------------------------

const PAPER: Record<'A4' | 'Letter', [number, number]> = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
}

const MARGIN_X = 36
const MARGIN_TOP = 42
const MARGIN_BOTTOM = 48
const FOOTER_Y = 26
const FOOTER_SIZE = 7
const FOOTER_MIN_SIZE = 5
const TITLE_SIZE = 14
const FONT_SIZE = 8
const LINE_HEIGHT = 10
const PAD_X = 3
const PAD_Y = 3
/** Share of the table width each column gets, in `CUE_SHEET_COLUMNS` order. */
const COLUMN_SHARE = [0.07, 0.08, 0.22, 0.05, 0.12, 0.17, 0.2, 0.09]

const INK = rgb(0.1, 0.1, 0.1)
const GREY = rgb(0.4, 0.4, 0.4)
const RULE = rgb(0.8, 0.8, 0.8)
const HEADER_FILL = rgb(0.92, 0.92, 0.92)

/** Text broken at `maxWidth` points: paragraphs, then words, then (for a word too wide) characters. */
function wrapCell(text: string, maxWidth: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split(/\r\n|[\r\n\u2028\u2029]/)) {
    for (const line of wrapText(toWinAnsi(paragraph), FONT_SIZE, maxWidth)) {
      if (helveticaWidth(line, FONT_SIZE) <= maxWidth) {
        out.push(line)
        continue
      }
      let piece = ''
      for (const ch of line) {
        if (piece && helveticaWidth(piece + ch, FONT_SIZE) > maxWidth) {
          out.push(piece)
          piece = ch
        } else {
          piece += ch
        }
      }
      out.push(piece)
    }
  }
  return out
}

/** `text` shortened with an ellipsis until it fits `maxWidth` at `size`. */
function truncateToFit(text: string, size: number, maxWidth: number): string {
  if (helveticaWidth(text, size) <= maxWidth) return text
  let s = text
  while (s.length > 0 && helveticaWidth(`${s}…`, size) > maxWidth) s = s.slice(0, -1)
  return `${s}…`
}

/**
 * The sheet as a portrait PDF on A4 or Letter: a title, then the table with its header row
 * repeated at the top of every page, long cells wrapped inside their columns, rows kept whole on
 * a page where they fit, and the footer (`footerText`) and a page count at the foot of every page.
 * Every string drawn passes through `toWinAnsi`, so no text can make the standard font throw.
 */
export async function cueSheetPdf(
  rows: CueSheetRow[],
  opts: { title: string; paper: 'A4' | 'Letter'; footer: FooterInfo },
): Promise<Uint8Array> {
  const [pageWidth, pageHeight] = PAPER[opts.paper]
  const doc = await PDFDocument.create({ updateMetadata: false })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const title = toWinAnsi(opts.title)
  doc.setTitle(title)
  doc.setProducer('Binder')
  doc.setCreationDate(opts.footer.date)
  doc.setModificationDate(opts.footer.date)

  const tableWidth = pageWidth - 2 * MARGIN_X
  const widths = COLUMN_SHARE.map((s) => s * tableWidth)
  const lefts = widths.map((_, i) => MARGIN_X + widths.slice(0, i).reduce((a, b) => a + b, 0))
  const bodyBottom = MARGIN_BOTTOM
  const headerHeight = LINE_HEIGHT + 2 * PAD_Y

  let page = doc.addPage([pageWidth, pageHeight])
  const pages: PDFPage[] = [page]
  let y = pageHeight - MARGIN_TOP

  const text = (
    p: PDFPage,
    s: string,
    x: number,
    baseline: number,
    f: PDFFont,
    size: number,
    color = INK,
  ) => {
    if (s) p.drawText(s, { x, y: baseline, size, font: f, color })
  }

  function drawHeader() {
    page.drawRectangle({
      x: MARGIN_X,
      y: y - headerHeight,
      width: tableWidth,
      height: headerHeight,
      color: HEADER_FILL,
    })
    CUE_SHEET_COLUMNS.forEach((name, i) => {
      text(page, name, (lefts[i] as number) + PAD_X, y - PAD_Y - FONT_SIZE + 1, bold, FONT_SIZE)
    })
    y -= headerHeight
    page.drawLine({
      start: { x: MARGIN_X, y },
      end: { x: MARGIN_X + tableWidth, y },
      thickness: 0.75,
      color: GREY,
    })
  }

  function newPage() {
    page = doc.addPage([pageWidth, pageHeight])
    pages.push(page)
    y = pageHeight - MARGIN_TOP
    drawHeader()
  }

  // The first page opens with the title and the cue count; every page opens with the header row.
  text(page, title, MARGIN_X, y - TITLE_SIZE, bold, TITLE_SIZE)
  y -= TITLE_SIZE + 4
  text(
    page,
    `${rows.length} ${rows.length === 1 ? 'cue' : 'cues'}`,
    MARGIN_X,
    y - FONT_SIZE,
    font,
    FONT_SIZE,
    GREY,
  )
  y -= FONT_SIZE + 10
  drawHeader()
  const fullBody = pageHeight - MARGIN_TOP - headerHeight - bodyBottom

  for (const r of rows) {
    const cells = cueSheetCells(r).map((v, i) =>
      wrapCell(v === null ? '' : String(v), (widths[i] as number) - 2 * PAD_X),
    )
    const lineCount = Math.max(...cells.map((c) => c.length))
    const rowHeight = lineCount * LINE_HEIGHT + 2 * PAD_Y
    // Keep a row whole when it would fit on a page of its own.
    if (rowHeight <= fullBody && y - rowHeight < bodyBottom) newPage()

    let done = 0
    while (done < lineCount) {
      let fit = Math.floor((y - bodyBottom - 2 * PAD_Y) / LINE_HEIGHT)
      if (fit < 1) {
        newPage()
        fit = Math.floor((y - bodyBottom - 2 * PAD_Y) / LINE_HEIGHT)
      }
      const take = Math.min(fit, lineCount - done)
      cells.forEach((lines, col) => {
        lines.slice(done, done + take).forEach((line, k) => {
          text(
            page,
            line,
            (lefts[col] as number) + PAD_X,
            y - PAD_Y - FONT_SIZE - k * LINE_HEIGHT + 1,
            font,
            FONT_SIZE,
          )
        })
      })
      y -= take * LINE_HEIGHT + 2 * PAD_Y
      done += take
      page.drawLine({
        start: { x: MARGIN_X, y },
        end: { x: MARGIN_X + tableWidth, y },
        thickness: 0.25,
        color: RULE,
      })
    }
  }

  // Footers last, when the page count is known.
  const line = toWinAnsi(footerText(opts.footer))
  pages.forEach((p, i) => {
    const count = `Page ${i + 1} of ${pages.length}`
    const countWidth = helveticaWidth(count, FOOTER_SIZE)
    const room = tableWidth - countWidth - 12
    let size = FOOTER_SIZE
    while (size > FOOTER_MIN_SIZE && helveticaWidth(line, size) > room) size -= 0.5
    text(p, truncateToFit(line, size, room), MARGIN_X, FOOTER_Y, font, size, GREY)
    text(p, count, MARGIN_X + tableWidth - countWidth, FOOTER_Y, font, FOOTER_SIZE, GREY)
  })

  return doc.save()
}
