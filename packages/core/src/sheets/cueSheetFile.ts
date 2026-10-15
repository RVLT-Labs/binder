import {
  EXPORT_FILE_TYPES,
  SHEET_FORMAT_KIND,
  type SheetFormat,
  type StoredExportKind,
} from '@binder/shared'
import type { FooterInfo } from '../print/footer'
import { type CueSheetRow, cueSheetCsv, cueSheetPdf } from './cueSheet'
import { cueSheetXlsx } from './xlsx'

export interface CueSheetFile {
  bytes: Uint8Array
  /** The export record kind the file is stored as. */
  kind: StoredExportKind
  ext: 'pdf' | 'xlsx' | 'csv'
  mime: string
}

/**
 * The cue sheet in one format, with how it is stored (kind, extension, media type). The one place
 * that turns rows into a file, for the server's agent export and the client's offline export alike.
 */
export async function cueSheetFile(
  format: SheetFormat,
  rows: CueSheetRow[],
  opts: {
    /** The PDF's title. */
    title: string
    /** The XLSX's worksheet name. */
    sheetName: string
    paper: 'A4' | 'Letter'
    footer: FooterInfo
  },
): Promise<CueSheetFile> {
  if (!Object.hasOwn(SHEET_FORMAT_KIND, format)) {
    throw new Error(`unknown cue sheet format: ${String(format)}`)
  }
  const kind = SHEET_FORMAT_KIND[format]
  const { ext, mime } = EXPORT_FILE_TYPES[kind]
  let bytes: Uint8Array
  if (format === 'pdf') {
    bytes = await cueSheetPdf(rows, { title: opts.title, paper: opts.paper, footer: opts.footer })
  } else if (format === 'xlsx') {
    bytes = cueSheetXlsx(rows, { sheetName: opts.sheetName })
  } else {
    bytes = new TextEncoder().encode(cueSheetCsv(rows))
  }
  return { bytes, kind, ext, mime }
}
