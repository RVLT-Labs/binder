import { changeLog } from '@binder/db'
import {
  type Actor,
  annotationObjectSchema,
  canSeeLayer,
  cueFieldsSchema,
  type LayerRef,
  type SyncCrudOp,
} from '@binder/shared'
import { and, eq, ne, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import { AppError, invalid, notFound } from '../errors'
import {
  createAnnotation,
  createCue,
  deleteAnnotations,
  deleteCues,
  requireShowRole,
  updateAnnotation,
  updateCue,
  updateDocument,
  updateShow,
} from '../services'
import { loadAnnotationRow } from '../services/annotations'
import { loadCueRow } from '../services/cues'
import type { Executor } from '../services/executor'
import { hasNoNul, int32, noNul, parseOrInvalid, title } from '../validation'

export interface WriteInput {
  id: string
  /** Wire columns as replicated: snake_case keys, SQLite encodings. Anything non-writable is ignored. */
  data: Record<string, unknown>
  /** The logged batch id, `<userId>:<clientBatchId>`. */
  batchId: string
  clientTs?: Date
}

export interface SyncTablePolicy {
  ops: readonly SyncCrudOp[]
  writable: readonly string[]
  /** Validate the writable columns and hand them to the owning service. Throws AppError on rejection. */
  patch?(db: Executor, actor: Actor, input: WriteInput): Promise<void>
  /** Create the row with the client's id, or, when it exists, treat the PUT as a replay of its create. */
  put?(db: Executor, actor: Actor, input: WriteInput): Promise<void>
  remove?(db: Executor, actor: Actor, input: Omit<WriteInput, 'data'>): Promise<void>
}

/** SQLite stores jsonb as JSON text; text that is not JSON is passed on for the schema to refuse. */
const fromJsonText = (v: unknown) => {
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

const jsonObject = z.preprocess(
  fromJsonText,
  z.record(z.string(), z.unknown()).refine(hasNoNul, 'must not contain NUL'),
)

/** SQLite stores booleans as 0/1. The column is nullable, so null clears it. */
const sqliteBoolean = z.union([
  z.boolean(),
  z.literal(0).transform(() => false),
  z.literal(1).transform(() => true),
  z.null(),
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `department_id` -> `departmentId`: the change log records service field names. */
const camel = (column: string) => column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

function pickWritable(writable: readonly string[], data: Record<string, unknown>) {
  return Object.fromEntries(writable.filter((k) => Object.hasOwn(data, k)).map((k) => [k, data[k]]))
}

/** A table clients may only patch (column-level, last writer wins by arrival). */
function tablePolicy<S extends z.ZodRawShape>(
  ops: readonly SyncCrudOp[],
  shape: S,
  apply: (
    db: Executor,
    actor: Actor,
    input: Omit<WriteInput, 'data'> & { data: Partial<z.output<z.ZodObject<S>>> },
  ) => Promise<unknown>,
): SyncTablePolicy {
  const writable = Object.keys(shape)
  const schema = z.object(shape).partial()
  return {
    ops,
    writable,
    async patch(db, actor, input) {
      const picked = pickWritable(writable, input.data)
      if (Object.keys(picked).length === 0) throw invalid('no writable columns in patch')
      const data = parseOrInvalid(schema, picked) as Partial<z.output<z.ZodObject<S>>>
      await apply(db, actor, { ...input, data })
    },
  }
}

/**
 * The service field names (camelCase keys of `after`) that other users changed on this row since
 * `since` (by client time, falling back to server time; `since` itself is clamped to server time, see
 * below), or, without `since`, since the actor's own newest change to it. A PUT that replays a create skips these, so it never regresses a newer edit.
 * `showId` scopes the lookup to the change log's (show_id, row_id, seq) index.
 */
export async function foreignColumnsSince(
  db: Executor,
  table: string,
  rowId: string,
  actorUserId: string,
  since: Date | null,
  showId: string,
): Promise<Set<string>> {
  const row = and(
    eq(changeLog.showId, showId),
    eq(changeLog.rowId, rowId),
    eq(changeLog.tableName, table),
  )
  const own = (column: SQL) => sql`(
    SELECT ${column} FROM ${changeLog} own
    WHERE own.show_id = ${showId} AND own.row_id = ${rowId}
      AND own.table_name = ${table} AND own.user_id = ${actorUserId}
  )`
  // The client's clock is not trusted to run ahead: `since` is clamped to the server's now and to
  // when the server logged this actor's newest change to the row (least() skips the NULL when there
  // is none). A replayed create whose clientTs is a day fast cannot claim to be newer than an edit a
  // collaborator made after the create arrived.
  const after = since
    ? sql`coalesce(${changeLog.clientTs}, ${changeLog.serverTs}) > least(
        ${since.toISOString()}::timestamptz, now(), ${own(sql`max(own.server_ts)`)})`
    : sql`${changeLog.seq} > coalesce(${own(sql`max(own.seq)`)}, 0)`
  const rows = await db
    .select({ after: changeLog.after })
    .from(changeLog)
    .where(and(row, ne(changeLog.userId, actorUserId), after))
  return new Set(rows.flatMap((r) => Object.keys(r.after ?? {})))
}

type Meta = { batchId: string; clientTs?: Date }

/** What `rowPolicy` needs of an existing row: its show and, for layered rows, its layer. */
export interface LoadedRow {
  showId: string
  layer?: LayerRef
}

/**
 * Whether the actor may know the row exists: a member of its show (within any token scope) and, for
 * a layered row, able to see that layer (another user's personal layer is invisible).
 */
async function canSeeRow(db: Executor, actor: Actor, row: LoadedRow): Promise<boolean> {
  try {
    await requireShowRole(db, actor, row.showId, 'viewer')
  } catch (err) {
    if (err instanceof AppError && (err.code === 'not_found' || err.code === 'forbidden')) {
      return false
    }
    throw err
  }
  return !row.layer || canSeeLayer(actor.userId, row.layer)
}

/**
 * A table whose rows clients create, patch and delete. PUT is create-or-replay: a PUT for an id that
 * exists is the same create sent again (a lost response, a re-created device queue), so it updates
 * only the columns no one else has changed since. PATCH is last writer wins by arrival (spec 8);
 * DELETE of a row that is already gone is applied with nothing logged.
 */
export function rowPolicy<S extends z.ZodRawShape>(def: {
  /** change_log table name, for the foreign-change lookup */
  table: string
  ops: readonly SyncCrudOp[]
  /** writable wire columns with coercion */
  shape: S
  load(db: Executor, id: string): Promise<LoadedRow | null>
  create(
    db: Executor,
    actor: Actor,
    id: string,
    showId: string,
    data: z.output<z.ZodObject<S>>,
    meta: Meta,
  ): Promise<unknown>
  update(
    db: Executor,
    actor: Actor,
    id: string,
    data: Partial<z.output<z.ZodObject<S>>>,
    meta: Meta,
  ): Promise<unknown>
  remove(db: Executor, actor: Actor, id: string, meta: Meta): Promise<unknown>
}): SyncTablePolicy {
  const writable = Object.keys(def.shape)
  const full = z.object(def.shape)
  const partial = full.partial()
  type Full = z.output<z.ZodObject<S>>
  const meta = (input: Omit<WriteInput, 'data'>): Meta => ({
    batchId: input.batchId,
    clientTs: input.clientTs,
  })

  return {
    ops: def.ops,
    writable,

    async put(db, actor, input) {
      if (!UUID_RE.test(input.id)) throw invalid('id must be a UUID')
      const showId = input.data.show_id
      const existing = await def.load(db, input.id)
      if (!existing) {
        if (showId === undefined || showId === null) throw invalid('show_id is required')
        if (typeof showId !== 'string' || showId.length > 200 || !noNul(showId)) {
          throw invalid('show_id must be an id')
        }
        const data = parseOrInvalid(full, pickWritable(writable, input.data)) as Full
        await def.create(db, actor, input.id, showId, data, meta(input))
        return
      }
      // A replay of a create, never a new row. Members only, and only of rows they can see: anyone
      // else gets what an id that does not exist gets.
      if (!(await canSeeRow(db, actor, existing))) throw notFound(`${def.table} row not found`)
      if (showId !== undefined && showId !== existing.showId) {
        throw invalid('id belongs to another show')
      }
      const data = parseOrInvalid(partial, pickWritable(writable, input.data)) as Partial<Full>
      const skip = await foreignColumnsSince(
        db,
        def.table,
        input.id,
        actor.userId,
        input.clientTs ?? null,
        existing.showId,
      )
      const kept = Object.fromEntries(
        Object.entries(data).filter(([column]) => !skip.has(camel(column))),
      ) as Partial<Full>
      await def.update(db, actor, input.id, kept, meta(input))
    },

    async patch(db, actor, input) {
      // A row the actor cannot see answers exactly like a missing one, as DELETE does.
      const existing = await def.load(db, input.id)
      if (!existing || !(await canSeeRow(db, actor, existing))) {
        throw notFound(`${def.table} row not found`)
      }
      const picked = pickWritable(writable, input.data)
      if (Object.keys(picked).length === 0) throw invalid('no writable columns in patch')
      const data = parseOrInvalid(partial, picked) as Partial<Full>
      await def.update(db, actor, input.id, data, meta(input))
    },

    async remove(db, actor, input) {
      // Already gone: done, and nothing to log, so a replayed DELETE never raises a notice. A row the
      // actor cannot see answers exactly the same, so DELETE never reveals that an id exists.
      const existing = await def.load(db, input.id)
      if (!existing || !(await canSeeRow(db, actor, existing))) return
      await def.remove(db, actor, input.id, meta(input))
    },
  }
}

const cue = cueFieldsSchema.shape

/** The writable cue columns. `show_id` is read by PUT only; `payload` is not writable in M1. */
const cueShape = {
  department_id: cue.departmentId,
  major: cue.major,
  minor: cue.minor,
  label: cue.label.optional(),
  // JSON text from SQLite, an object, or null; then the anchor schema.
  anchor: z.preprocess(fromJsonText, cue.anchor).optional(),
  type: cue.type.optional(),
  notes: cue.notes.optional(),
  colour: cue.colour.optional(),
}
type CueWire = Partial<z.output<z.ZodObject<typeof cueShape>>>

const cueFields = (d: CueWire) => ({
  departmentId: d.department_id,
  major: d.major,
  minor: d.minor,
  label: d.label,
  anchor: d.anchor,
  type: d.type,
  notes: d.notes,
  colour: d.colour,
})

const ann = annotationObjectSchema.shape

/** The writable annotation columns. `show_id` is read by PUT only. JSON columns arrive as text. */
const annotationShape = {
  layer_kind: ann.layerKind,
  layer_id: ann.layerId,
  anchor: z.preprocess(fromJsonText, ann.anchor),
  type: ann.type,
  geometry: z.preprocess(fromJsonText, ann.geometry).optional(),
  text: ann.text.optional(),
  style: z.preprocess(fromJsonText, ann.style).optional(),
}
type AnnotationWire = Partial<z.output<z.ZodObject<typeof annotationShape>>>

const annotationFields = (d: AnnotationWire) => ({
  layerKind: d.layer_kind,
  layerId: d.layer_id,
  anchor: d.anchor,
  type: d.type,
  geometry: d.geometry,
  text: d.text,
  style: d.style,
})

/** The tables a PowerSync client may write, keyed by Postgres table name. */
export const SYNC_TABLES: Record<string, SyncTablePolicy> = {
  shows: tablePolicy(
    ['PATCH'],
    {
      title,
      status: z.enum(['prep', 'rehearsal', 'running', 'archived']),
      settings: jsonObject,
    },
    (db, actor, { id, data, batchId, clientTs }) =>
      updateShow(db, actor, { showId: id, patch: data, batchId, clientTs }),
  ),
  documents: tablePolicy(
    ['PATCH'],
    {
      title,
      kind: z.enum(['libretto', 'score', 'blocking', 'other']),
      ocr_mode: z.enum(['auto', 'never']),
      snap_to_text: sqliteBoolean,
      sort_order: int32,
    },
    (db, actor, { id, data, batchId, clientTs }) =>
      updateDocument(db, actor, {
        documentId: id,
        patch: {
          title: data.title,
          kind: data.kind,
          ocrMode: data.ocr_mode,
          snapToText: data.snap_to_text,
          sortOrder: data.sort_order,
        },
        batchId,
        clientTs,
      }),
  ),
  cues: rowPolicy({
    table: 'cues',
    ops: ['PUT', 'PATCH', 'DELETE'],
    shape: cueShape,
    load: async (db, id) => {
      const row = await loadCueRow(db, id)
      return row && { showId: row.showId, layer: { kind: 'department', id: row.departmentId } }
    },
    create: (db, actor, id, showId, d, meta) =>
      createCue(db, actor, {
        showId,
        id,
        departmentId: d.department_id,
        number: { major: d.major, minor: d.minor },
        label: d.label,
        anchor: d.anchor,
        type: d.type,
        notes: d.notes,
        colour: d.colour,
        ...meta,
      }),
    update: (db, actor, id, data, meta) =>
      updateCue(db, actor, { cueId: id, patch: cueFields(data), ...meta }),
    remove: (db, actor, id, meta) => deleteCues(db, actor, { cueIds: [id], ...meta }),
  }),
  annotations: rowPolicy({
    table: 'annotations',
    ops: ['PUT', 'PATCH', 'DELETE'],
    shape: annotationShape,
    load: async (db, id) => {
      const row = await loadAnnotationRow(db, id)
      return row && { showId: row.showId, layer: { kind: row.layerKind, id: row.layerId } }
    },
    create: (db, actor, id, showId, d, meta) =>
      createAnnotation(db, actor, {
        showId,
        id,
        layerKind: d.layer_kind,
        layerId: d.layer_id,
        anchor: d.anchor,
        type: d.type,
        geometry: d.geometry ?? {},
        text: d.text ?? '',
        style: d.style ?? {},
        ...meta,
      }),
    update: (db, actor, id, data, meta) =>
      updateAnnotation(db, actor, { annotationId: id, patch: annotationFields(data), ...meta }),
    remove: (db, actor, id, meta) => deleteAnnotations(db, actor, { annotationIds: [id], ...meta }),
  }),
}
