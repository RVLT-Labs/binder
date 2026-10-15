import { Readable } from 'node:stream'
import {
  buildStampItems,
  cueListRows,
  cueSheetFile,
  layerSelectionLabel,
  stampScript,
  toCueSheetRows,
} from '@binder/core'
import {
  annotations,
  cues as cuesTable,
  departments as departmentsTable,
  documents,
  documentVersions,
  exportRecords,
  shows,
} from '@binder/db'
import {
  type Actor,
  EXPORT_FILE_TYPES,
  type LayerRef,
  layerKey,
  newId,
  paperSize,
  SHEET_FORMAT_KIND,
  type SheetFormat,
  type StoredExportKind,
} from '@binder/shared'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { type BlobStore, readBlobBytes } from '../blob/BlobStore'
import { exportBlobKey } from '../blob/keys'
import { AppError, forbidden, IdTaken, invalid, notFound, payloadTooLarge } from '../errors'
import { MAX_UPLOAD_BYTES } from '../upload/multipart'
import { hasNoNul, parseOrInvalid, text } from '../validation'
import type { Executor } from './executor'
import { visibleAnnotationsTo } from './history'
import { requireShowRole } from './tenancy'
import { loadVersionText } from './wordLayers'

export type ExportRecord = typeof exportRecords.$inferSelect

type StoredKind = StoredExportKind

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MIN_CLIENT_TIME = Date.UTC(2000, 0, 1)
const MAX_CLIENT_TIME = Date.UTC(2100, 0, 1)

/** The `binder://` resource for an export's file (spec 3.10). */
export const exportUri = (showId: string, exportId: string): string =>
  `binder://shows/${showId}/exports/${exportId}`

const layerRefSchema = z.object({
  kind: z.enum(['department', 'personal']),
  id: text(100),
})
const selectionSchema = z.array(layerRefSchema).max(200)

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null
  return e?.code === '23505' || e?.cause?.code === '23505'
}

async function drain(stream: Readable): Promise<void> {
  try {
    for await (const _ of stream) {
      // Discard: the upload was a replay and nothing is stored.
    }
  } catch {
    // A replay of a broken upload is still a replay.
  }
}

async function loadRow(db: Executor, id: string): Promise<ExportRecord | null> {
  if (id.includes('\u0000')) return null
  const [row] = await db.select().from(exportRecords).where(eq(exportRecords.id, id))
  return row ?? null
}

/**
 * Internal (not in the barrel): the single guard for every read of an export (list-by-id, the blob
 * route, the MCP resource). Viewer or above on the export's show, then `not_found` when the row
 * does not exist, is private to someone else, is not in `showId` (when given), or its file is not
 * `fileKey` (when given), so none of those can be told apart and existence never leaks. A token
 * whose scope excludes `showId` is `forbidden` before the row is looked at (R27).
 */
export async function readableExport(
  db: Executor,
  actor: Actor,
  input: { exportId: string; showId?: string; fileKey?: string },
): Promise<ExportRecord> {
  if (input.showId !== undefined) await requireShowRole(db, actor, input.showId, 'viewer')
  const row = await loadRow(db, input.exportId)
  if (!row) throw notFound('Export not found')
  if (input.showId !== undefined && row.showId !== input.showId) throw notFound('Export not found')
  try {
    await requireShowRole(db, actor, row.showId, 'viewer')
  } catch (err) {
    // A non-member gets the message a missing id gets; token scope stays forbidden.
    if (err instanceof AppError && err.code === 'not_found') {
      throw notFound('Export not found')
    }
    throw err
  }
  if (row.privateTo !== null && row.privateTo !== actor.userId) throw notFound('Export not found')
  if (input.fileKey !== undefined && input.fileKey !== row.fileKey) {
    throw notFound('Export not found')
  }
  return row
}

/**
 * Internal: viewer or above. Archived shows are allowed: archiving freezes a show's content, and
 * printing or exporting a closed show is a main reason to keep it (M1-R20); an export record logs
 * a read, not a content edit. The route calls it before reading an upload body, so a refusal costs nothing.
 */
export async function assertCanExport(db: Executor, actor: Actor, showId: string): Promise<void> {
  await requireShowRole(db, actor, showId, 'viewer')
}

/** A personal layer in a selection must be the actor's own; every department must be in the show. */
async function assertSelection(
  db: Executor,
  actor: Actor,
  showId: string,
  selection: LayerRef[],
): Promise<void> {
  const departmentIds = new Set<string>()
  for (const l of selection) {
    if (l.kind === 'personal') {
      if (l.id !== actor.userId)
        throw forbidden('an export can only include your own personal layer')
    } else {
      departmentIds.add(l.id)
    }
  }
  if (departmentIds.size === 0) return
  const found = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(
      and(eq(departmentsTable.showId, showId), inArray(departmentsTable.id, [...departmentIds])),
    )
  if (found.length !== departmentIds.size)
    throw invalid('a department in the selection is not in this show')
}

const dedupe = (selection: LayerRef[]): LayerRef[] => {
  const seen = new Set<string>()
  return selection.filter((l) => {
    const k = layerKey(l)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * Viewer or above. Records an export whose file the client generated: a department layer must be in
 * the show and a personal layer must be the caller's own, which makes the record private to them.
 * The id is client-chosen: a replay by the same user (including one that lost a race) returns the
 * existing record and stores nothing, any other use of the id is `conflict`. The file goes to a
 * fresh server-generated key, so concurrent uploads never write the same blob.
 */
export async function createExportRecord(
  db: Executor,
  blobs: BlobStore,
  actor: Actor,
  input: {
    id: string
    showId: string
    kind: StoredKind
    filename: string
    layerSelection: LayerRef[]
    file: Readable
    declaredSize?: number
    createdAt?: Date
  },
): Promise<ExportRecord> {
  if (input.declaredSize !== undefined && input.declaredSize > MAX_UPLOAD_BYTES) {
    throw payloadTooLarge()
  }
  if (!UUID_RE.test(input.id)) throw invalid('id must be a UUID')
  if (input.showId.includes('\u0000')) throw invalid('showId must not contain NUL')
  if (!Object.hasOwn(EXPORT_FILE_TYPES, input.kind))
    throw invalid('kind must be pdf-script, pdf-sheet, csv or xlsx')
  const filename = parseOrInvalid(text(200), input.filename)
  const selection = dedupe(parseOrInvalid(selectionSchema, input.layerSelection))
  if (input.createdAt !== undefined) {
    const t = input.createdAt.getTime()
    if (!Number.isFinite(t) || t < MIN_CLIENT_TIME || t >= MAX_CLIENT_TIME) {
      throw invalid('createdAt must be between 2000 and 2100')
    }
  }

  await assertCanExport(db, actor, input.showId)
  await assertSelection(db, actor, input.showId, selection)

  const resolveExisting = async (existing: ExportRecord): Promise<ExportRecord> => {
    if (existing.createdBy !== actor.userId || existing.showId !== input.showId) {
      throw new IdTaken('An export with this id already exists')
    }
    return existing
  }

  const first = await loadRow(db, input.id)
  if (first) {
    await drain(input.file)
    return resolveExisting(first)
  }

  const { ext, mime } = EXPORT_FILE_TYPES[input.kind]
  // A text file is stored as UTF-8.
  const contentType = mime.startsWith('text/') ? `${mime}; charset=utf-8` : mime
  const key = exportBlobKey(input.showId, input.id, newId(), ext)
  await blobs.put(key, input.file, contentType)
  try {
    return await db.transaction(async (tx) => {
      await assertCanExport(tx, actor, input.showId)
      const [row] = await tx
        .insert(exportRecords)
        .values({
          id: input.id,
          showId: input.showId,
          kind: input.kind,
          filename,
          layerSelection: selection,
          privateTo: selection.some((l) => l.kind === 'personal') ? actor.userId : null,
          fileKey: key,
          createdBy: actor.userId,
          createdAt: input.createdAt,
          updatedBy: actor.userId,
        })
        .returning()
      return row
    })
  } catch (err) {
    await blobs.delete(key).catch(() => {})
    if (isUniqueViolation(err)) {
      const winner = await loadRow(db, input.id)
      if (winner) return resolveExisting(winner)
      throw new IdTaken('An export with this id already exists')
    }
    throw err
  }
}

/** Any member. A show's export records, newest first; another member's private exports are not included. */
export async function listExportRecords(
  db: Executor,
  actor: Actor,
  input: { showId: string },
): Promise<ExportRecord[]> {
  await requireShowRole(db, actor, input.showId, 'viewer')
  return db
    .select()
    .from(exportRecords)
    .where(
      and(
        eq(exportRecords.showId, input.showId),
        or(isNull(exportRecords.privateTo), eq(exportRecords.privateTo, actor.userId)),
      ),
    )
    .orderBy(desc(exportRecords.createdAt), desc(exportRecords.id))
}

/** `/ \ : * ? " < > |` and control characters cannot be in a file name on every platform. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are the point
const UNSAFE_FILENAME_CHARS = /[/\\:*?"<>|\u0000-\u001f]/g

function exportFilename(parts: string[], ext: 'pdf' | 'xlsx' | 'csv' = 'pdf'): string {
  const base = parts.join(' - ').replace(UNSAFE_FILENAME_CHARS, '-').trim()
  return `${base.slice(0, 196)}.${ext}`
}

/**
 * Viewer or above. Stamps a version's cues and annotations from the chosen layers onto its searchable
 * PDF (so the invisible text layer survives), with the footer of spec 5.3, and records the export.
 * `'all'` is every visible (not hidden) department and no personal layer; `'none'` a clean copy; a
 * list may add the caller's own personal layer, which makes the record private to them. The footer
 * shows `export <last 8 of the id>` because M1 has no Binder versions, and its date is in the
 * server process's local time zone (`TZ`; the API image defaults it to Australia/Sydney).
 */
export async function exportMarkedScript(
  db: Executor,
  blobs: BlobStore,
  actor: Actor,
  input: { documentId: string; versionId?: string; layers: 'all' | 'none' | LayerRef[] },
): Promise<{ record: ExportRecord; uri: string }> {
  if (!hasNoNul(input)) throw invalid('ids must not contain NUL')
  const [document] = await db.select().from(documents).where(eq(documents.id, input.documentId))
  if (!document) throw notFound('Document not found')
  await requireShowRole(db, actor, document.showId, 'viewer')
  const versionId = input.versionId ?? document.currentVersionId
  if (!versionId) throw invalid('the document has no current version')
  const [version] = await db
    .select()
    .from(documentVersions)
    .where(and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, document.id)))
  if (!version) throw notFound('Version not found')
  if (!version.searchableKey) {
    throw invalid(`the version has no searchable PDF yet (status: ${version.status})`)
  }
  const [show] = await db.select().from(shows).where(eq(shows.id, document.showId))
  if (!show) throw notFound('Show not found')

  const departments = await db
    .select()
    .from(departmentsTable)
    .where(eq(departmentsTable.showId, document.showId))
    .orderBy(departmentsTable.sortOrder, departmentsTable.code)
  const selection = dedupe(
    input.layers === 'all'
      ? departments.filter((d) => !d.hidden).map((d) => ({ kind: 'department' as const, id: d.id }))
      : input.layers === 'none'
        ? []
        : parseOrInvalid(selectionSchema, input.layers),
  )
  await assertCanExport(db, actor, document.showId)
  await assertSelection(db, actor, document.showId, selection)

  const picked = new Set(selection.map(layerKey))
  const labelled = departments.filter(
    (d) => !d.hidden || picked.has(layerKey({ kind: 'department', id: d.id })),
  )
  const layerLabel = layerSelectionLabel(selection, labelled)
  const documentLabel = `${document.title} v${version.versionNumber}`

  const [pdf, text, cueRows, annotationRows] = await Promise.all([
    readBlobBytes(blobs, version.searchableKey),
    loadVersionText(db, blobs, version.id),
    db.select().from(cuesTable).where(eq(cuesTable.showId, document.showId)),
    // Another member's personal layer is never read, whatever the selection says.
    db
      .select()
      .from(annotations)
      .where(and(eq(annotations.showId, document.showId), visibleAnnotationsTo(actor))),
  ])
  if (!pdf) throw new Error(`searchable PDF ${version.searchableKey} is missing`)

  const exportId = newId()
  const items = buildStampItems({
    versionId: version.id,
    layers: selection,
    cues: cueRows,
    annotations: annotationRows,
    departments: departments.map((d) => ({
      id: d.id,
      code: d.code,
      colour: d.colour,
      numberFormat: d.numberFormat,
    })),
    wordLayers: text.layers,
  })
  const stamped = await stampScript(new Uint8Array(pdf), items, {
    showTitle: show.title,
    documentLabel,
    layerLabel,
    binderVersion: null,
    exportId,
    date: new Date(),
  })

  const record = await createExportRecord(db, blobs, actor, {
    id: exportId,
    showId: document.showId,
    kind: 'pdf-script',
    filename: exportFilename([show.title, documentLabel, layerLabel]),
    layerSelection: selection,
    file: Readable.from(Buffer.from(stamped)),
  })
  return { record, uri: exportUri(record.showId, record.id) }
}

/**
 * Viewer or above. A department's cue sheet as a PDF (on the show's paper size), an XLSX or a CSV,
 * made from the same rows as the cue list screen and recorded like any export. The layer selection
 * is the department, so the record is public to the show; the filename is
 * `<show> - <CODE> cue sheet.<ext>`. Like the other server-side export it works on archived shows.
 * Clients normally make the file themselves (so it works offline) and upload it; this is for agents.
 */
export async function exportCueList(
  db: Executor,
  blobs: BlobStore,
  actor: Actor,
  input: { departmentId: string; format: SheetFormat },
): Promise<{ record: ExportRecord; uri: string }> {
  if (!Object.hasOwn(SHEET_FORMAT_KIND, input.format))
    throw invalid('format must be pdf, xlsx or csv')
  if (!hasNoNul(input.departmentId)) throw invalid('departmentId must not contain NUL')
  const [department] = await db
    .select()
    .from(departmentsTable)
    .where(eq(departmentsTable.id, input.departmentId))
  if (!department) throw notFound('Department not found')
  try {
    await requireShowRole(db, actor, department.showId, 'viewer')
  } catch (err) {
    // A non-member gets the message a missing id gets; token scope stays forbidden (R27).
    if (err instanceof AppError && err.code === 'not_found') throw notFound('Department not found')
    throw err
  }
  const [show] = await db.select().from(shows).where(eq(shows.id, department.showId))
  if (!show) throw notFound('Show not found')

  const [cueRows, documentRows] = await Promise.all([
    db.select().from(cuesTable).where(eq(cuesTable.departmentId, department.id)),
    db.select().from(documents).where(eq(documents.showId, department.showId)),
  ])
  const rows = toCueSheetRows(cueListRows(cueRows, [department], documentRows))

  const exportId = newId()
  const now = new Date()
  const title = `${department.code} cue sheet`
  const settings = (show.settings ?? {}) as Record<string, unknown>
  const file = await cueSheetFile(input.format, rows, {
    title: `${show.title} ${title}`,
    sheetName: department.code,
    paper: paperSize(settings),
    footer: {
      showTitle: show.title,
      documentLabel: title,
      layerLabel: department.code,
      binderVersion: null,
      exportId,
      date: now,
    },
  })

  const record = await createExportRecord(db, blobs, actor, {
    id: exportId,
    showId: department.showId,
    kind: file.kind,
    filename: exportFilename([show.title, title], file.ext),
    layerSelection: [{ kind: 'department', id: department.id }],
    file: Readable.from(Buffer.from(file.bytes)),
    createdAt: now,
  })
  return { record, uri: exportUri(record.showId, record.id) }
}
