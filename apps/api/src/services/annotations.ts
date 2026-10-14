import { columnEqual } from '@binder/core'
import { annotations } from '@binder/db'
import {
  type Actor,
  type AnnotationFields,
  annotationFieldsSchema,
  annotationPatchSchema,
  type LayerRef,
  layerKey,
  newId,
} from '@binder/shared'
import { and, eq, type InferSelectModel, inArray, or, type SQL, sql } from 'drizzle-orm'
import { AppError, forbidden, IdTaken, invalid, notFound } from '../errors'
import { hasNoNul, parseOrInvalid } from '../validation'
import { logChange } from './changeLog'
import { assertAnchorTarget } from './cues'
import type { Executor } from './executor'
import { requireLayerEdit } from './layers'
import { requireShowRole } from './tenancy'

export type Annotation = InferSelectModel<typeof annotations>

const FIELD_KEYS = [
  'layerKind',
  'layerId',
  'anchor',
  'type',
  'geometry',
  'text',
  'style',
] as const satisfies ReadonlyArray<keyof AnnotationFields>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const fieldsOf = (row: Annotation | AnnotationFields): AnnotationFields =>
  Object.fromEntries(FIELD_KEYS.map((k) => [k, row[k]])) as unknown as AnnotationFields

const layerRef = (row: Pick<Annotation, 'layerKind' | 'layerId'>): LayerRef => ({
  kind: row.layerKind,
  id: row.layerId,
})

const layerOf = (row: Pick<Annotation, 'layerKind' | 'layerId'>) => layerKey(layerRef(row))

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null
  return e?.code === '23505' || e?.cause?.code === '23505'
}

/** Internal (not in the barrel): the raw row, for the sync policy and other services. */
export async function loadAnnotationRow(db: Executor, id: string): Promise<Annotation | null> {
  if (id.includes('\u0000')) return null
  const [row] = await db.select().from(annotations).where(eq(annotations.id, id))
  return row ?? null
}

/**
 * The row as the actor may know it: a member of its show, and, for a personal layer, its owner.
 * Everything else (missing, another show, another user's personal layer, owners included) is the
 * same `not_found`, so an id never reveals that it exists.
 */
async function loadVisible(db: Executor, actor: Actor, id: string): Promise<Annotation> {
  const row = await loadAnnotationRow(db, id)
  if (!row) throw notFound('Annotation not found')
  try {
    await requireShowRole(db, actor, row.showId, 'viewer')
  } catch (err) {
    // A non-member gets the message a missing id gets (not "Show not found"); token scope stays forbidden.
    if (err instanceof AppError && err.code === 'not_found') {
      throw notFound('Annotation not found')
    }
    throw err
  }
  if (row.layerKind === 'personal' && row.layerId !== actor.userId) {
    throw notFound('Annotation not found')
  }
  return row
}

/**
 * Writing onto a layer. Another user's personal layer is `forbidden` (a layer id to write to is the
 * caller's own to give), everything else follows the permission matrix.
 */
async function requireWritableLayer(
  db: Executor,
  actor: Actor,
  showId: string,
  layer: LayerRef,
): Promise<void> {
  if (layer.kind === 'personal' && layer.id !== actor.userId) {
    await requireShowRole(db, actor, showId, 'viewer')
    throw forbidden('a personal annotation goes on your own personal layer')
  }
  await requireLayerEdit(db, actor, showId, layer)
}

export async function createAnnotation(
  db: Executor,
  actor: Actor,
  input: { showId: string; id?: string } & AnnotationFields & { batchId?: string; clientTs?: Date },
): Promise<Annotation> {
  const batchId = input.batchId ?? newId()
  if (input.id !== undefined && !UUID_RE.test(input.id)) throw invalid('id must be a UUID')
  if (input.showId.includes('\u0000')) throw invalid('showId must not contain NUL')
  const fields = parseOrInvalid(annotationFieldsSchema('create'), fieldsOf(input))

  return db.transaction(async (tx) => {
    await requireWritableLayer(tx, actor, input.showId, layerRef(fields))
    await assertAnchorTarget(tx, input.showId, fields.anchor)
    const id = input.id ?? newId()
    if (input.id && (await loadAnnotationRow(tx, id))) {
      throw new IdTaken('An annotation with this id already exists')
    }
    let created: Annotation
    try {
      ;[created] = await tx
        .insert(annotations)
        .values({ ...fields, id, showId: input.showId, updatedBy: actor.userId })
        .returning()
    } catch (err) {
      if (isUniqueViolation(err)) throw new IdTaken('An annotation with this id already exists')
      throw err
    }
    await logChange(tx, {
      showId: input.showId,
      actor,
      batchId,
      table: 'annotations',
      rowId: id,
      op: 'insert',
      before: null,
      after: { ...fieldsOf(created) },
      layer: layerOf(created),
      clientTs: input.clientTs,
    })
    return created
  })
}

export async function updateAnnotation(
  db: Executor,
  actor: Actor,
  input: {
    annotationId: string
    patch: Partial<AnnotationFields>
    batchId?: string
    clientTs?: Date
  },
): Promise<Annotation> {
  const batchId = input.batchId ?? newId()
  const patch = parseOrInvalid(annotationPatchSchema, input.patch)
  return db.transaction(async (tx) => {
    const current = await loadVisible(tx, actor, input.annotationId)
    await requireLayerEdit(tx, actor, current.showId, layerRef(current))

    // The cross-field rules (geometry fits the type, a note has text) apply to the row as a whole.
    const merged = parseOrInvalid(annotationFieldsSchema('update'), {
      ...fieldsOf(current),
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    })
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const key of FIELD_KEYS) {
      if (patch[key] === undefined) continue
      const was = current[key]
      const next = merged[key]
      const same =
        key === 'anchor' || key === 'geometry' || key === 'style'
          ? columnEqual(was, next)
          : was === next
      if (same) continue
      before[key] = was
      after[key] = next
    }
    if (Object.keys(after).length === 0) return current

    if (after.layerKind !== undefined || after.layerId !== undefined) {
      await requireWritableLayer(tx, actor, current.showId, layerRef(merged))
    }
    if (after.anchor) await assertAnchorTarget(tx, current.showId, merged.anchor)

    const [updated] = await tx
      .update(annotations)
      .set({ ...after, updatedBy: actor.userId })
      .where(eq(annotations.id, current.id))
      .returning()
    await logChange(tx, {
      showId: current.showId,
      actor,
      batchId,
      table: 'annotations',
      rowId: current.id,
      op: 'update',
      before,
      after,
      layer: layerOf(updated),
      clientTs: input.clientTs,
    })
    return updated
  })
}

/** All or nothing: one missing, invisible or refused annotation refuses the call and nothing is deleted. */
export async function deleteAnnotations(
  db: Executor,
  actor: Actor,
  input: { annotationIds: string[]; batchId?: string; clientTs?: Date },
): Promise<{ deleted: string[] }> {
  const batchId = input.batchId ?? newId()
  if (!hasNoNul(input.annotationIds)) throw invalid('annotationIds must not contain NUL')
  const ids = [...new Set(input.annotationIds)]
  if (ids.length === 0) throw invalid('annotationIds must not be empty')
  return db.transaction(async (tx) => {
    const rows: Annotation[] = []
    for (const id of ids) {
      const row = await loadVisible(tx, actor, id)
      await requireLayerEdit(tx, actor, row.showId, layerRef(row))
      rows.push(row)
    }
    await tx.delete(annotations).where(
      inArray(
        annotations.id,
        rows.map((r) => r.id),
      ),
    )
    for (const row of rows) {
      await logChange(tx, {
        showId: row.showId,
        actor,
        batchId,
        table: 'annotations',
        rowId: row.id,
        op: 'delete',
        before: { ...fieldsOf(row) },
        after: null,
        layer: layerOf(row),
        clientTs: input.clientTs,
      })
    }
    return { deleted: ids }
  })
}

/** Any member, for department layers and their own personal layer; anything else is `not_found`. */
export async function getAnnotation(
  db: Executor,
  actor: Actor,
  input: { annotationId: string },
): Promise<Annotation> {
  return loadVisible(db, actor, input.annotationId)
}

/**
 * Any member. Every department layer plus the actor's own personal layer, oldest first; `layer`
 * narrows to one, and another user's personal layer is `not_found` like the rows in it.
 */
export async function listAnnotations(
  db: Executor,
  actor: Actor,
  input: { showId: string; layer?: LayerRef; documentId?: string },
): Promise<Annotation[]> {
  if (input.showId.includes('\u0000')) throw invalid('showId must not contain NUL')
  if (input.documentId?.includes('\u0000')) {
    throw invalid('documentId must not contain NUL')
  }
  await requireShowRole(db, actor, input.showId, 'viewer')
  if (input.layer?.kind === 'personal' && input.layer.id !== actor.userId) {
    throw notFound('Layer not found')
  }
  const visible = or(
    eq(annotations.layerKind, 'department'),
    and(eq(annotations.layerKind, 'personal'), eq(annotations.layerId, actor.userId)),
  )
  const filters: (SQL | undefined)[] = [eq(annotations.showId, input.showId), visible]
  if (input.layer) {
    filters.push(
      eq(annotations.layerKind, input.layer.kind),
      eq(annotations.layerId, input.layer.id),
    )
  }
  if (input.documentId !== undefined) {
    filters.push(sql`${annotations.anchor}->>'documentId' = ${input.documentId}`)
  }
  return db
    .select()
    .from(annotations)
    .where(and(...filters))
    .orderBy(annotations.createdAt, annotations.id)
}
