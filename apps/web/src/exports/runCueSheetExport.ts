import { cueListRows } from '@binder/core'
import { type CueFields, type NumberFormat, newId, type SheetFormat } from '@binder/shared'
import { assertDatabaseOwner, runDatabaseWork } from '../auth/localWork'
import { pushNotice } from '../components/noticeStore'
import { type EditContext, fromCueRow } from '../markup/mutations'
import { CUE_TYPES } from '../markup/rows'
import { enqueueExport, type PendingExport } from './outbox'
import { readPaperSize } from './paperSize'
import { downloadBytes, type ExportDb, exportFilename } from './runPrintExport'

export type { SheetFormat }

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

const defaultEffects: CueSheetEffects = {
  download: downloadBytes,
  enqueue: enqueueExport,
  now: () => new Date(),
}

/**
 * Exports a department's cue sheet (PDF, XLSX or CSV) entirely from this device: local rows, then the
 * browser download. The finished file is also queued for upload (the export outbox), which gives
 * the show its ExportRecord whenever there is a network, so it works the same offline. The PDF and
 * XLSX writers (pdf-lib, fflate) are loaded only here, never with the main bundle.
 */
async function runCueSheetExportImpl(
  db: ExportDb,
  ctx: EditContext,
  input: CueSheetInput,
  effects: Partial<CueSheetEffects> = {},
): Promise<CueSheetResult> {
  const fx = { ...defaultEffects, ...effects }

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
      department_id: string | null
      major: number | null
      minor: number | null
      label: string | null
      type: string | null
      notes: string | null
      colour: string | null
      anchor: string | null
    }>(
      'SELECT id, department_id, major, minor, label, type, notes, colour, anchor FROM cues WHERE show_id = ? AND department_id = ?',
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
    cues.push({ id: r.id, ...fromCueRow(r) })
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
  const file = await sheets.cueSheetFile(input.format, rows, {
    title: `${showTitle} ${title}`,
    sheetName: code,
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
  const { bytes } = file
  const filename = exportFilename([showTitle, title], file.ext)

  // The file is the user's the moment it exists, online or not.
  assertDatabaseOwner(db, ctx.userId)
  fx.download(filename, bytes, file.mime)
  try {
    assertDatabaseOwner(db, ctx.userId)
    await fx.enqueue({
      id,
      showId: ctx.showId,
      userId: ctx.userId,
      meta: {
        id,
        kind: file.kind,
        filename,
        layerSelection: [{ kind: 'department', id: department.id }],
        createdAt: createdAt.toISOString(),
      },
      bytes,
      contentType: file.mime,
    })
  } catch (err) {
    pushNotice({
      kind: 'error',
      message: `${filename} was downloaded, but Binder could not keep a copy to record it: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
  return { id, filename, bytes }
}

export function runCueSheetExport(
  ...args: Parameters<typeof runCueSheetExportImpl>
): ReturnType<typeof runCueSheetExportImpl> {
  return runDatabaseWork(args[0], args[1].userId, () => runCueSheetExportImpl(...args))
}
