import {
  type Anchor,
  type AnnotationFields,
  type AnnotationType,
  anchorSchema,
  type CueFields,
  type CueType,
  type LayerRef,
  layerKey,
  type NumberFormat,
  newId,
  type WordLayer,
} from '@binder/shared'
import { blobUrl, fetchBlob } from '../blobs/fetchBlob'
import { pushNotice } from '../components/noticeStore'
import type { EditContext } from '../markup/mutations'
import { loadWordLayer } from '../markup/wordLayers'
import { enqueueExport, type PendingExport } from './outbox'

/** The part of the local database an export reads. */
export interface ExportDb {
  getAll<T>(sql: string, parameters?: unknown[]): Promise<T[]>
}

export interface PrintInput {
  documentId: string
  versionId: string
  /** The layers to print: non-hidden departments, and the user's own personal layer. */
  layers: LayerRef[]
}

export interface PrintResult {
  id: string
  filename: string
  bytes: Uint8Array
}

/** What happens to the finished file; replaced in tests. */
export interface PrintEffects {
  download(filename: string, bytes: Uint8Array): void
  enqueue(p: PendingExport): Promise<void>
  loadWords(key: string): Promise<WordLayer | null>
  now(): Date
}

const CUE_TYPES: readonly string[] = ['go', 'standby', 'warn']
const ANNOTATION_TYPES: readonly string[] = [
  'note',
  'rect',
  'ellipse',
  'line',
  'arrow',
  'stamp',
  'highlight',
]

/** `/ \ : * ? " < > |` and control characters cannot be in a file name on every platform. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are the point
const UNSAFE_FILENAME_CHARS = /[/\\:*?"<>|\u0000-\u001f]/g

/** The same name the server gives its own exports: `<show> - <document> v<n> - <layers>.pdf`. */
export function exportFilename(parts: string[]): string {
  const base = parts.join(' - ').replace(UNSAFE_FILENAME_CHARS, '-').trim()
  return `${base.slice(0, 196)}.pdf`
}

/** Saves the bytes through the browser's download, at once, with no network involved. */
export function downloadBytes(filename: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.append(a)
  a.click()
  a.remove()
  // The download has started by the time a task later runs; the URL is not needed after that.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const defaultEffects: PrintEffects = {
  download: downloadBytes,
  enqueue: enqueueExport,
  loadWords: loadWordLayer,
  now: () => new Date(),
}

function parseJson(text: string | null): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function parseAnchor(text: string | null): Anchor | null {
  const parsed = anchorSchema.safeParse(parseJson(text))
  return parsed.success ? (parsed.data as Anchor) : null
}

function parseRecord(text: string | null): Record<string, unknown> {
  const value = parseJson(text)
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function numbers(record: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(record)) if (typeof v === 'number') out[k] = v
  return out
}

interface DepartmentRow {
  id: string
  code: string
  colour: string
  number_format: string | null
  hidden: number | null
}
interface CueRow {
  id: string
  department_id: string | null
  major: number | null
  minor: number | null
  label: string | null
  type: string | null
  notes: string | null
  colour: string | null
  anchor: string | null
}
interface AnnotationRow {
  id: string
  layer_kind: string | null
  layer_id: string | null
  anchor: string | null
  type: string | null
  geometry: string | null
  text: string | null
  style: string | null
}

/** A blob through the cache the viewer filled, or a clear reason it is not here. */
async function blobBytes(key: string, what: string): Promise<Uint8Array> {
  let res: Response
  try {
    res = await fetchBlob(blobUrl(key))
  } catch {
    throw new Error(
      `${what} is not on this device and there is no network. Open the document once online, or use "Make available offline".`,
    )
  }
  if (!res.ok) throw new Error(`${what} could not be loaded (the server answered ${res.status}).`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Prints a document version with the chosen layers stamped on, entirely from this device: local
 * rows, the cached searchable PDF and word layers, then the browser download. The finished file is
 * also queued for upload (the export outbox), which gives the show its ExportRecord whenever there
 * is a network. Stamping (and so pdf-lib) is loaded only here, never with the main bundle.
 */
export async function runPrintExport(
  db: ExportDb,
  ctx: EditContext,
  input: PrintInput,
  effects: Partial<PrintEffects> = {},
): Promise<PrintResult> {
  const fx = { ...defaultEffects, ...effects }
  const [show] = await db.getAll<{ title: string }>('SELECT title FROM shows WHERE id = ?', [
    ctx.showId,
  ])
  const [document] = await db.getAll<{ title: string }>(
    'SELECT title FROM documents WHERE id = ? AND show_id = ?',
    [input.documentId, ctx.showId],
  )
  const [version] = await db.getAll<{ version_number: number; searchable_key: string | null }>(
    'SELECT version_number, searchable_key FROM document_versions WHERE id = ? AND document_id = ?',
    [input.versionId, input.documentId],
  )
  if (!show || !document || !version) throw new Error('This document is not on this device yet.')
  if (!version.searchable_key) throw new Error('This version has not finished processing yet.')

  const departments = await db.getAll<DepartmentRow>(
    'SELECT id, code, colour, number_format, hidden FROM departments WHERE show_id = ? ORDER BY sort_order, code',
    [ctx.showId],
  )

  // Only layers the user is shown: visible departments, and nobody's personal layer but their own.
  const known = new Map(departments.map((d) => [d.id, d]))
  const seen = new Set<string>()
  const layers: LayerRef[] = []
  for (const layer of input.layers) {
    const key = layerKey(layer)
    if (seen.has(key)) continue
    seen.add(key)
    if (layer.kind === 'personal') {
      if (layer.id !== ctx.userId) throw new Error('You can only print your own personal layer.')
    } else {
      const department = known.get(layer.id)
      if (!department) throw new Error('That department is not part of this show.')
      // The dialog never offers a hidden department; refuse it here too rather than print it.
      if (department.hidden) throw new Error(`The ${department.code} layer is hidden.`)
    }
    layers.push(layer)
  }

  const [cueRows, annotationRows, pageRows] = await Promise.all([
    db.getAll<CueRow>(
      'SELECT id, department_id, major, minor, label, type, notes, colour, anchor FROM cues WHERE show_id = ?',
      [ctx.showId],
    ),
    // Another member's personal layer is never read, whatever the selection says.
    db.getAll<AnnotationRow>(
      `SELECT id, layer_kind, layer_id, anchor, type, geometry, text, style FROM annotations
       WHERE show_id = ? AND (layer_kind = 'department' OR (layer_kind = 'personal' AND layer_id = ?))`,
      [ctx.showId, ctx.userId],
    ),
    db.getAll<{ index: number; words_key: string | null }>(
      'SELECT "index", words_key FROM pages WHERE document_version_id = ?',
      [input.versionId],
    ),
  ])

  const cues: Array<CueFields & { id: string }> = []
  for (const r of cueRows) {
    if (!r.department_id || !CUE_TYPES.includes(r.type ?? '')) continue
    cues.push({
      id: r.id,
      departmentId: r.department_id,
      major: r.major ?? 0,
      minor: r.minor ?? 0,
      label: r.label ?? '',
      type: r.type as CueType,
      notes: r.notes ?? '',
      colour: r.colour,
      anchor: parseAnchor(r.anchor),
    })
  }
  const annotations: Array<AnnotationFields & { id: string }> = []
  for (const r of annotationRows) {
    const anchor = parseAnchor(r.anchor)
    if (!anchor || !r.layer_id || !ANNOTATION_TYPES.includes(r.type ?? '')) continue
    annotations.push({
      id: r.id,
      layerKind: r.layer_kind === 'personal' ? 'personal' : 'department',
      layerId: r.layer_id,
      anchor,
      type: r.type as AnnotationType,
      geometry: numbers(parseRecord(r.geometry)),
      text: r.text ?? '',
      style: parseRecord(r.style),
    })
  }

  // Word layers matter only for highlights (their rectangles come from the words), so only the
  // pages with a selected highlight need theirs. Without them a highlight prints as its quote.
  const picked = new Set(layers.map(layerKey))
  const highlightPages = new Set(
    annotations
      .filter(
        (a) =>
          a.type === 'highlight' &&
          a.anchor.documentVersionId === input.versionId &&
          picked.has(layerKey({ kind: a.layerKind, id: a.layerId })),
      )
      .map((a) => a.anchor.pageIndex),
  )
  const wordKeys = new Map(pageRows.map((p) => [p.index, p.words_key]))

  const pdf = await blobBytes(version.searchable_key, 'The script PDF')
  const wordLayers = new Map<number, WordLayer>()
  await Promise.all(
    [...highlightPages].map(async (pageIndex) => {
      const key = wordKeys.get(pageIndex)
      const layer = key ? await fx.loadWords(key) : null
      if (layer) wordLayers.set(pageIndex, layer)
    }),
  )

  // Loaded here, at print time: pdf-lib is large and nothing else in the app needs it.
  const { buildStampItems, layerSelectionLabel, stampScript } = await import('./printCore')

  const id = newId()
  // Hidden departments are refused above, so the footer's "all layers" is over the visible ones.
  const labelled = departments.filter((d) => !d.hidden)
  const layerLabel = layerSelectionLabel(layers, labelled)
  const documentLabel = `${document.title} v${version.version_number}`
  const items = buildStampItems({
    versionId: input.versionId,
    layers,
    cues,
    annotations,
    departments: departments.map((d) => ({
      id: d.id,
      code: d.code,
      colour: d.colour,
      numberFormat: (d.number_format === 'point' ? 'point' : 'decimal') as NumberFormat,
    })),
    wordLayers,
  })
  const createdAt = fx.now()
  const bytes = await stampScript(pdf, items, {
    showTitle: show.title,
    documentLabel,
    layerLabel,
    binderVersion: null,
    exportId: id,
    date: createdAt,
  })
  const filename = exportFilename([show.title, documentLabel, layerLabel])

  // The file is the user's the moment it exists, online or not.
  fx.download(filename, bytes)
  try {
    await fx.enqueue({
      id,
      showId: ctx.showId,
      userId: ctx.userId,
      meta: {
        id,
        kind: 'pdf-script',
        filename,
        layerSelection: layers,
        createdAt: createdAt.toISOString(),
      },
      bytes,
      contentType: 'application/pdf',
    })
  } catch (err) {
    pushNotice({
      kind: 'error',
      message: `${filename} was downloaded, but Binder could not keep a copy to record it: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
  return { id, filename, bytes }
}
