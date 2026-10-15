import { strToU8, zipSync } from 'fflate'
import { CUE_SHEET_COLUMNS, type CueSheetRow, cueSheetCells } from './cueSheet'

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

/** Fixed, so the same sheet always zips to the same bytes. */
const ZIP_TIME = new Date(Date.UTC(2000, 0, 1))

/**
 * Text safe in an XML 1.0 document: tab, line feed and carriage return stay; every other control
 * character (C0, DEL and C1), the two non-characters U+FFFE and U+FFFF and unpaired surrogates are dropped; the five
 * markup characters are escaped.
 */
function xmlText(s: string): string {
  let out = ''
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number
    if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) continue
    if (
      (cp >= 0x7f && cp <= 0x9f) ||
      (cp >= 0xd800 && cp <= 0xdfff) ||
      cp === 0xfffe ||
      cp === 0xffff
    )
      continue
    if (ch === '&') out += '&amp;'
    else if (ch === '<') out += '&lt;'
    else if (ch === '>') out += '&gt;'
    else if (ch === '"') out += '&quot;'
    else if (ch === "'") out += '&apos;'
    else out += ch
  }
  return out
}

/** Excel refuses `: \ / ? * [ ]` in a sheet name, a name over 31 characters, and an empty one. */
function sheetNameOf(name: string): string {
  const cleaned = [...name.replace(/[:\\/?*[\]]/g, '-')]
    .filter((ch) => (ch.codePointAt(0) as number) >= 0x20)
    .slice(0, 31)
    .join('')
    .trim()
  return cleaned || 'Cue sheet'
}

const COLUMN_LETTERS = 'ABCDEFGH'
/** Column widths, in characters, in `CUE_SHEET_COLUMNS` order. */
const COLUMN_WIDTHS = [8, 10, 32, 7, 20, 32, 40, 24]

function stringCell(ref: string, value: string): string {
  const text = xmlText(value)
  if (text === '') return ''
  const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : ''
  return `<c r="${ref}" t="inlineStr"><is><t${space}>${text}</t></is></c>`
}

function sheetXml(rows: CueSheetRow[]): string {
  const header = CUE_SHEET_COLUMNS.map((name, i) => stringCell(`${COLUMN_LETTERS[i]}1`, name)).join(
    '',
  )
  const body = rows
    .map((r, n) => {
      const rowNumber = n + 2
      const cells = cueSheetCells(r)
        .map((value, i) => {
          const ref = `${COLUMN_LETTERS[i]}${rowNumber}`
          // A number is a number cell (it sorts and sums as one); blank is no cell at all.
          if (typeof value === 'number') {
            return Number.isFinite(value) ? `<c r="${ref}" t="n"><v>${value}</v></c>` : ''
          }
          return stringCell(ref, value ?? '')
        })
        .join('')
      return `<row r="${rowNumber}">${cells}</row>`
    })
    .join('')
  const cols = COLUMN_WIDTHS.map(
    (w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`,
  ).join('')
  const last = rows.length + 1
  return (
    `${XML_DECL}<worksheet xmlns="${NS_MAIN}">` +
    `<dimension ref="A1:H${last}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${cols}</cols>` +
    `<sheetData><row r="1">${header}</row>${body}</sheetData></worksheet>`
  )
}

/**
 * The sheet as an .xlsx: one worksheet, the header row, then a row per cue. `Page` is a number
 * cell (blank when the cue is unplaced) and every other column an inline string, so a cue number
 * like `10.50` keeps its format and nothing is ever read as a formula. The package is the minimal
 * SpreadsheetML part set, zipped.
 */
export function cueSheetXlsx(rows: CueSheetRow[], opts: { sheetName: string }): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
        `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
        '</Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      `${XML_DECL}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
        `<sheets><sheet name="${xmlText(sheetNameOf(opts.sheetName))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
        `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
        '</Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml(rows)),
  }
  return zipSync(files, { level: 6, mtime: ZIP_TIME })
}
