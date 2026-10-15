/** The kinds of export file Binder stores (an export record's `kind` also allows `tmix` in later milestones). */
export type StoredExportKind = 'pdf-script' | 'pdf-sheet' | 'csv' | 'xlsx'

export interface ExportFileType {
  ext: 'pdf' | 'xlsx' | 'csv'
  /** The media type of the file (a text file is UTF-8). */
  mime: string
  /** The bytes an upload of this kind must begin with; none for CSV, which has no signature. */
  magic?: string
}

/** The one table of what each stored export kind is: its extension, media type and file signature. */
export const EXPORT_FILE_TYPES: Record<StoredExportKind, ExportFileType> = {
  'pdf-script': { ext: 'pdf', mime: 'application/pdf', magic: '%PDF-' },
  'pdf-sheet': { ext: 'pdf', mime: 'application/pdf', magic: '%PDF-' },
  csv: { ext: 'csv', mime: 'text/csv' },
  xlsx: {
    ext: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    magic: 'PK',
  },
}

/** The formats a cue sheet can be exported in. */
export type SheetFormat = 'pdf' | 'xlsx' | 'csv'

/** The stored export kind of each cue sheet format. */
export const SHEET_FORMAT_KIND: Record<SheetFormat, StoredExportKind> = {
  pdf: 'pdf-sheet',
  xlsx: 'xlsx',
  csv: 'csv',
}
