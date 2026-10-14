import { columnEqual } from '@binder/core'
import { type CueFields, newId } from '@binder/shared'
import type { AbstractPowerSyncDatabase } from '@powersync/web'

export type MarkupTable = 'cues' | 'annotations'
export type EditSource = 'user' | 'undo' | 'redo'

/** One local change to a markup row. `before` and `after` are snake_case wire rows (JSON columns as text). */
export interface LocalEdit {
  table: MarkupTable
  id: string
  op: 'insert' | 'update' | 'delete'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

export interface EditContext {
  showId: string
  userId: string
}

export interface MutationOptions {
  source?: EditSource
}

/** Columns holding JSON text, which compare structurally rather than as strings. */
export const JSON_COLUMNS: Record<MarkupTable, readonly string[]> = {
  cues: ['anchor', 'payload'],
  annotations: ['anchor', 'geometry', 'style'],
}

type Db = Pick<AbstractPowerSyncDatabase, 'writeTransaction'>
type Listener = (edits: LocalEdit[], source: EditSource) => void

const listeners = new Set<Listener>()

/** Hears every local markup write, grouped as the mutation made it. The undo stack listens here. */
export function subscribeLocalEdits(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function emit(edits: LocalEdit[], source: EditSource): void {
  if (edits.length === 0) return
  for (const fn of [...listeners]) fn(edits, source)
}

/** The writable cue columns for `fields`; the anchor is JSON text. */
export function toCueRow(fields: CueFields): Record<string, string | number | null> {
  return {
    department_id: fields.departmentId,
    major: fields.major,
    minor: fields.minor,
    label: fields.label,
    anchor: fields.anchor ? JSON.stringify(fields.anchor) : null,
    type: fields.type,
    notes: fields.notes,
    colour: fields.colour,
  }
}

const CUE_PATCH_COLUMN: Record<keyof CueFields, string> = {
  departmentId: 'department_id',
  major: 'major',
  minor: 'minor',
  label: 'label',
  type: 'type',
  notes: 'notes',
  colour: 'colour',
  anchor: 'anchor',
}

function patchColumns(patch: Partial<CueFields>): Record<string, string | number | null> {
  const row = toCueRow({ ...EMPTY_FIELDS, ...patch })
  const out: Record<string, string | number | null> = {}
  for (const key of Object.keys(patch) as Array<keyof CueFields>) {
    const col = CUE_PATCH_COLUMN[key]
    if (col && patch[key] !== undefined) out[col] = row[col] ?? null
  }
  return out
}

const EMPTY_FIELDS: CueFields = {
  departmentId: '',
  major: 0,
  minor: 0,
  label: '',
  type: 'go',
  notes: '',
  colour: null,
  anchor: null,
}

function parseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v ?? null
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}

/** The cue fields held by a local `cues` row. */
export function fromCueRow(row: Record<string, unknown>): CueFields {
  return {
    departmentId: String(row.department_id),
    major: Number(row.major),
    minor: Number(row.minor),
    label: String(row.label ?? ''),
    type: row.type as CueFields['type'],
    notes: String(row.notes ?? ''),
    colour: (row.colour as string | null) ?? null,
    anchor: parseJson(row.anchor) as CueFields['anchor'],
  }
}

async function readRow(
  tx: Pick<AbstractPowerSyncDatabase, 'getOptional'>,
  id: string,
): Promise<Record<string, unknown> | null> {
  return tx.getOptional<Record<string, unknown>>('SELECT * FROM cues WHERE id = ?', [id])
}

/** Places a new cue; resolves to its id. */
export async function insertCue(
  db: Db,
  ctx: EditContext,
  fields: CueFields,
  opts: MutationOptions = {},
): Promise<string> {
  const id = newId()
  const now = new Date().toISOString()
  const row: Record<string, string | number | null> = {
    id,
    show_id: ctx.showId,
    ...toCueRow(fields),
    payload: '{}',
    created_at: now,
    updated_at: now,
    updated_by: ctx.userId,
  }
  const cols = Object.keys(row)
  const edit = await db.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO cues (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => row[c]),
    )
    const after = await readRow(tx, id)
    return { table: 'cues', id, op: 'insert', before: null, after } satisfies LocalEdit
  })
  emit([edit], opts.source ?? 'user')
  return id
}

/** Writes the changed columns of one cue inside `tx`; null when the row is gone or nothing changed. */
async function patchInTx(
  tx: Pick<AbstractPowerSyncDatabase, 'getOptional' | 'execute'>,
  ctx: EditContext,
  id: string,
  patch: Partial<CueFields>,
): Promise<LocalEdit | null> {
  const before = await readRow(tx, id)
  if (!before) return null
  const changed = Object.entries(patchColumns(patch)).filter(
    ([col, value]) => !columnEqual(before[col], value),
  )
  if (changed.length === 0) return null
  const sets = [...changed, ['updated_at', new Date().toISOString()], ['updated_by', ctx.userId]]
  await tx.execute(`UPDATE cues SET ${sets.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`, [
    ...sets.map(([, v]) => v),
    id,
  ])
  return { table: 'cues', id, op: 'update', before, after: await readRow(tx, id) }
}

export async function updateCue(
  db: Db,
  ctx: EditContext,
  id: string,
  patch: Partial<CueFields>,
  opts: MutationOptions = {},
): Promise<void> {
  await updateCues(db, ctx, [{ id, patch }], opts)
}

/** Several cue patches as one transaction and one edit group (one undo step). */
export async function updateCues(
  db: Db,
  ctx: EditContext,
  patches: Array<{ id: string; patch: Partial<CueFields> }>,
  opts: MutationOptions = {},
): Promise<void> {
  const edits = await db.writeTransaction(async (tx) => {
    const out: LocalEdit[] = []
    for (const { id, patch } of patches) {
      const edit = await patchInTx(tx, ctx, id, patch)
      if (edit) out.push(edit)
    }
    return out
  })
  emit(edits, opts.source ?? 'user')
}

export async function deleteCue(
  db: Db,
  _ctx: EditContext,
  id: string,
  opts: MutationOptions = {},
): Promise<void> {
  const edit = await db.writeTransaction(async (tx) => {
    const before = await readRow(tx, id)
    if (!before) return null
    await tx.execute('DELETE FROM cues WHERE id = ?', [id])
    return { table: 'cues', id, op: 'delete', before, after: null } satisfies LocalEdit
  })
  if (edit) emit([edit], opts.source ?? 'user')
}
