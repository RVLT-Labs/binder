import { columnEqual } from '@binder/core'
import {
  type AnnotationFields,
  annotationFieldsSchema,
  type CueFields,
  canEditLayer,
  cueFieldsSchema,
  type LayerKind,
  type MembershipScope,
  newId,
} from '@binder/shared'
import type { AbstractPowerSyncDatabase } from '@powersync/web'
import { parseAnchor, parseJson } from './rows'

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
  /** The user's role and department scope: the layer matrix is checked before any write. */
  scope: MembershipScope
}

/** A mutation the server would refuse, caught before anything is written. */
export class MarkupError extends Error {
  constructor(
    readonly code: 'invalid' | 'forbidden',
    message: string,
  ) {
    super(message)
    this.name = 'MarkupError'
  }
}

function assertValid(fields: CueFields): void {
  const parsed = cueFieldsSchema.safeParse(fields)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new MarkupError(
      'invalid',
      `${issue?.path.join('.') || 'cue'}: ${issue?.message ?? 'invalid'}`,
    )
  }
}

function assertCanEdit(ctx: EditContext, departmentId: string): void {
  if (!canEditLayer(ctx.scope, ctx.userId, { kind: 'department', id: departmentId })) {
    throw new MarkupError('forbidden', "You can't edit cues on that department's layer.")
  }
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

/** Tells listeners about writes made outside these mutations (the undo stack's own). */
export function emitLocalEdits(edits: LocalEdit[], source: EditSource): void {
  emit(edits, source)
}

function emit(edits: LocalEdit[], source: EditSource): void {
  if (edits.length === 0) return
  for (const fn of [...listeners]) {
    try {
      fn(edits, source)
    } catch (e) {
      console.error('local edit listener failed', e)
    }
  }
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

/** The cue fields held by a local `cues` row. */
export function fromCueRow(source: object): CueFields {
  const row = source as Record<string, unknown>
  return {
    departmentId: String(row.department_id),
    major: Number(row.major),
    minor: Number(row.minor),
    label: String(row.label ?? ''),
    type: row.type as CueFields['type'],
    notes: String(row.notes ?? ''),
    colour: (row.colour as string | null) ?? null,
    anchor: parseAnchor(row.anchor),
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
  assertValid(fields)
  assertCanEdit(ctx, fields.departmentId)
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

/** Checks one patch against the stored row; returns the row and the columns to write, or null if gone. */
async function planPatch(
  tx: Pick<AbstractPowerSyncDatabase, 'getOptional'>,
  ctx: EditContext,
  id: string,
  patch: Partial<CueFields>,
): Promise<{
  id: string
  before: Record<string, unknown>
  changed: Array<[string, unknown]>
} | null> {
  const before = await readRow(tx, id)
  if (!before) return null
  const current = fromCueRow(before)
  assertCanEdit(ctx, current.departmentId)
  const merged = { ...current, ...definedOnly(patch) }
  assertValid(merged)
  assertCanEdit(ctx, merged.departmentId)
  const jsonCols = JSON_COLUMNS.cues
  const changed = Object.entries(patchColumns(patch)).filter(([col, value]) =>
    jsonCols.includes(col) ? !columnEqual(before[col], value) : before[col] !== value,
  )
  return { id, before, changed }
}

function definedOnly(patch: Partial<CueFields>): Partial<CueFields> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
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
    // Plan every patch first so a refused one leaves the whole group unwritten.
    const plans = []
    for (const { id, patch } of patches) {
      const plan = await planPatch(tx, ctx, id, patch)
      if (plan && plan.changed.length > 0) plans.push(plan)
    }
    const now = new Date().toISOString()
    const out: LocalEdit[] = []
    for (const { id, before, changed } of plans) {
      const sets = [...changed, ['updated_at', now], ['updated_by', ctx.userId]]
      await tx.execute(`UPDATE cues SET ${sets.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`, [
        ...sets.map(([, v]) => v),
        id,
      ])
      out.push({ table: 'cues', id, op: 'update', before, after: await readRow(tx, id) })
    }
    return out
  })
  emit(edits, opts.source ?? 'user')
}

export async function deleteCue(
  db: Db,
  ctx: EditContext,
  id: string,
  opts: MutationOptions = {},
): Promise<void> {
  const edit = await db.writeTransaction(async (tx) => {
    const before = await readRow(tx, id)
    if (!before) return null
    assertCanEdit(ctx, String(before.department_id))
    await tx.execute('DELETE FROM cues WHERE id = ?', [id])
    return { table: 'cues', id, op: 'delete', before, after: null } satisfies LocalEdit
  })
  if (edit) emit([edit], opts.source ?? 'user')
}

// ---- Annotations ----------------------------------------------------------------------------

function assertValidAnnotation(fields: AnnotationFields, mode: 'create' | 'update'): void {
  const parsed = annotationFieldsSchema(mode).safeParse(fields)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new MarkupError(
      'invalid',
      `${issue?.path.join('.') || 'annotation'}: ${issue?.message ?? 'invalid'}`,
    )
  }
}

function assertCanEditAnnotationLayer(ctx: EditContext, kind: LayerKind, id: string): void {
  if (!canEditLayer(ctx.scope, ctx.userId, { kind, id })) {
    throw new MarkupError('forbidden', "You can't edit annotations on that layer.")
  }
}

/** The writable annotation columns for `fields`; anchor, geometry and style are JSON text. */
export function toAnnotationRow(fields: AnnotationFields): Record<string, string> {
  return {
    layer_kind: fields.layerKind,
    layer_id: fields.layerId,
    anchor: JSON.stringify(fields.anchor),
    type: fields.type,
    geometry: JSON.stringify(fields.geometry),
    text: fields.text,
    style: JSON.stringify(fields.style),
  }
}

const ANNOTATION_COLUMN: Record<keyof AnnotationFields, string> = {
  layerKind: 'layer_kind',
  layerId: 'layer_id',
  anchor: 'anchor',
  type: 'type',
  geometry: 'geometry',
  text: 'text',
  style: 'style',
}

/** The annotation fields held by a local `annotations` row. */
export function fromAnnotationRow(row: Record<string, unknown>): AnnotationFields {
  return {
    layerKind: row.layer_kind === 'personal' ? 'personal' : 'department',
    layerId: String(row.layer_id),
    anchor: parseJson(row.anchor) as AnnotationFields['anchor'],
    type: row.type as AnnotationFields['type'],
    geometry: (parseJson(row.geometry) ?? {}) as AnnotationFields['geometry'],
    text: String(row.text ?? ''),
    style: (parseJson(row.style) ?? {}) as AnnotationFields['style'],
  }
}

async function readAnnotation(
  tx: Pick<AbstractPowerSyncDatabase, 'getOptional'>,
  id: string,
): Promise<Record<string, unknown> | null> {
  return tx.getOptional<Record<string, unknown>>('SELECT * FROM annotations WHERE id = ?', [id])
}

/** Places a new annotation; resolves to its id. */
export async function insertAnnotation(
  db: Db,
  ctx: EditContext,
  fields: AnnotationFields,
  opts: MutationOptions = {},
): Promise<string> {
  assertValidAnnotation(fields, 'create')
  assertCanEditAnnotationLayer(ctx, fields.layerKind, fields.layerId)
  const id = newId()
  const now = new Date().toISOString()
  const row: Record<string, string> = {
    id,
    show_id: ctx.showId,
    ...toAnnotationRow(fields),
    created_at: now,
    updated_at: now,
    updated_by: ctx.userId,
  }
  const cols = Object.keys(row)
  const edit = await db.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO annotations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => row[c]),
    )
    const after = await readAnnotation(tx, id)
    return { table: 'annotations', id, op: 'insert', before: null, after } satisfies LocalEdit
  })
  emit([edit], opts.source ?? 'user')
  return id
}

/** Changes some fields of an annotation; the merged row is validated and both layers must be editable. */
export async function updateAnnotation(
  db: Db,
  ctx: EditContext,
  id: string,
  patch: Partial<AnnotationFields>,
  opts: MutationOptions = {},
): Promise<void> {
  const edit = await db.writeTransaction(async (tx) => {
    const before = await readAnnotation(tx, id)
    if (!before) return null
    const current = fromAnnotationRow(before)
    assertCanEditAnnotationLayer(ctx, current.layerKind, current.layerId)
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    ) as Partial<AnnotationFields>
    const merged = { ...current, ...defined }
    // Re-anchoring can leave a highlight unbound, so a stored row is held to the update rules.
    assertValidAnnotation(merged, 'update')
    assertCanEditAnnotationLayer(ctx, merged.layerKind, merged.layerId)
    const next = toAnnotationRow(merged)
    const jsonCols = JSON_COLUMNS.annotations
    const changed = (Object.keys(defined) as Array<keyof AnnotationFields>)
      .map((key) => [ANNOTATION_COLUMN[key], next[ANNOTATION_COLUMN[key]]] as const)
      .filter(([col, value]) =>
        jsonCols.includes(col) ? !columnEqual(before[col], value) : before[col] !== value,
      )
    if (changed.length === 0) return null
    const sets = [...changed, ['updated_at', new Date().toISOString()], ['updated_by', ctx.userId]]
    await tx.execute(
      `UPDATE annotations SET ${sets.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...sets.map(([, v]) => v), id],
    )
    return {
      table: 'annotations',
      id,
      op: 'update',
      before,
      after: await readAnnotation(tx, id),
    } satisfies LocalEdit
  })
  if (edit) emit([edit], opts.source ?? 'user')
}

export async function deleteAnnotation(
  db: Db,
  ctx: EditContext,
  id: string,
  opts: MutationOptions = {},
): Promise<void> {
  const edit = await db.writeTransaction(async (tx) => {
    const before = await readAnnotation(tx, id)
    if (!before) return null
    const { layerKind, layerId } = fromAnnotationRow(before)
    assertCanEditAnnotationLayer(ctx, layerKind, layerId)
    await tx.execute('DELETE FROM annotations WHERE id = ?', [id])
    return { table: 'annotations', id, op: 'delete', before, after: null } satisfies LocalEdit
  })
  if (edit) emit([edit], opts.source ?? 'user')
}
