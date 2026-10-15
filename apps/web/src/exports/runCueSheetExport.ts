import { cueListRows } from '@binder/core'
import { type Anchor, type CueFields, type NumberFormat, newId } from '@binder/shared'
import { pushNotice } from '../components/noticeStore'
import type { EditContext } from '../markup/mutations'
import { enqueueExport, type PendingExport } from './outbox'
import { readPaperSize } from './paperSize'
import { downloadBytes, type ExportDb, exportFilename } from './runPrintExport'

export type SheetFormat = 'pdf' | 'xlsx' | 'csv'

export interface CueSheetInput {
  departmentId: string
  format: SheetFormat
}

export interface CueSheetResult {
  id: string
  filename: string
  bytes: Uint8Array
}

/** What happens to the finished file; replaced in tests. */
export interface CueSheetEffects {
  download(filename: string, bytes: Uint8Array, contentType: string): void
  enqueue(p: PendingExport): Promise<void>
  now(): Date
}

const FORMATS: Record<
  SheetFormat,
  { kind: 'pdf-sheet' | 'xlsx' | 'csv'; ext: SheetFormat; contentType: string }
> = {
  pdf: { kind: 'pdf-sheet', ext: 'pdf', contentType: 'application/pdf' },
  xlsx: {
    kind: 'xlsx',
    ext: 'xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  csv: { kind: 'csv', ext: 'csv', contentType: 'text/csv; charset=utf-8' },
}

const defaultEffects: CueSheetEffects = {
  download: downloadBytes,
  enqueue: enqueueExport,
  now: () => new Date(),
}

const CUE_TYPES: readonly string[] = ['go', 'standby', 'warn']

function parseAnchor(text: string | null): Anchor | null {
  if (!text) return null
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? (value as Anchor) : null
  } catch {
    return null
  }
}

/**
 * Exports a department's cue sheet (PDF, XLSX or CSV) entirely from this device: local rows, then the
 * browser download. The finished file is also queued for upload (the export outbox), which gives
 * the show its ExportRecord whenever there is a network, so it works the same offline. The PDF and
 * XLSX writers (pdf-lib, fflate) are loaded only here, never with the main bundle.
 */
export async function runCueSheetExport(
  db: ExportDb,
  ctx: EditContext,
  input: CueSheetInput,
  effects: Partial<CueSheetEffects> = {},
): Promise<CueSheetResult> {
  const fx = { ...defaultEffects, ...effects }
  const format = FORMATS[input.format]
  if (!format) throw new Error('Choose PDF, XLSX or CSV.')

  const [show] = await db.getAll<{ title: string | null; settings: string | null }>(
    'SELECT title, settings FROM shows WHERE id = ?',
    [ctx.showId],
  )
  const [department] = await db.getAll<{
    id: string
    code: string | null
    number_format: string | null
  }>('SELECT id, code, number_format FROM departments WHERE id = ? AND show_id = ?', [
    input.departmentId,
    ctx.showId,
  ])
  if (!show || !department) throw new Error('This department is not on this device yet.')
  const code = department.code ?? ''

  const [cueRows, documentRows] = await Promise.all([
    db.getAll<{
      id: string
      major: number | null
      minor: number | null
      label: string | null
      type: string | null
      notes: string | null
      colour: string | null
      anchor: string | null
    }>(
      'SELECT id, major, minor, label, type, notes, colour, anchor FROM cues WHERE show_id = ? AND department_id = ?',
      [ctx.showId, department.id],
    ),
    db.getAll<{ id: string; title: string | null; current_version_id: string | null }>(
      'SELECT id, title, current_version_id FROM documents WHERE show_id = ?',
      [ctx.showId],
    ),
  ])
  const cues: Array<CueFields & { id: string }> = []
  for (const r of cueRows) {
    if (!CUE_TYPES.includes(r.type ?? '')) continue
    cues.push({
      id: r.id,
      departmentId: department.id,
      major: r.major ?? 0,
      minor: r.minor ?? 0,
      label: r.label ?? '',
      type: r.type as CueFields['type'],
      notes: r.notes ?? '',
      colour: r.colour,
      anchor: parseAnchor(r.anchor),
    })
  }

  // Loaded here, at export time: the writers are large and nothing else in the app needs them.
  const sheets = await import('./sheetCore')
  const rows = sheets.toCueSheetRows(
    cueListRows(
      cues,
      [
        {
          id: department.id,
          code,
          numberFormat: (department.number_format === 'point'
            ? 'point'
            : 'decimal') as NumberFormat,
        },
      ],
      documentRows.map((d) => ({
        id: d.id,
        title: d.title ?? '',
        currentVersionId: d.current_version_id,
      })),
    ),
  )

  const id = newId()
  const createdAt = fx.now()
  const showTitle = show.title ?? ''
  const title = `${code} cue sheet`
  let bytes: Uint8Array
  if (input.format === 'pdf') {
    bytes = await sheets.cueSheetPdf(rows, {
      title: `${showTitle} ${title}`,
      paper: readPaperSize(show.settings),
      footer: {
        showTitle,
        documentLabel: title,
        layerLabel: code,
        binderVersion: null,
        exportId: id,
        date: createdAt,
      },
    })
  } else if (input.format === 'xlsx') {
    bytes = sheets.cueSheetXlsx(rows, { sheetName: code })
  } else {
    bytes = new TextEncoder().encode(sheets.cueSheetCsv(rows))
  }
  const filename = exportFilename([showTitle, title], format.ext)

  // The file is the user's the moment it exists, online or not.
  fx.download(filename, bytes, format.contentType)
  try {
    await fx.enqueue({
      id,
      showId: ctx.showId,
      userId: ctx.userId,
      meta: {
        id,
        kind: format.kind,
        filename,
        layerSelection: [{ kind: 'department', id: department.id }],
        createdAt: createdAt.toISOString(),
      },
      bytes,
      contentType: format.contentType,
    })
  } catch (err) {
    pushNotice({
      kind: 'error',
      message: `${filename} was downloaded, but Binder could not keep a copy to record it: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
  return { id, filename, bytes }
}
