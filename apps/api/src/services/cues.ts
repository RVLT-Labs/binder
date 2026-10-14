import { columnEqual, compareReadingOrder, formatCueNumber, suggestCueNumber } from '@binder/core'
import { cues, departments, documents, documentVersions } from '@binder/db'
import {
  type Actor,
  type Anchor,
  type CueFields,
  type CueNumber,
  type CueType,
  cueFieldsSchema,
  layerKey,
  newId,
} from '@binder/shared'
import { and, eq, type InferSelectModel, inArray } from 'drizzle-orm'
import { conflict, invalid, notFound } from '../errors'
import { hasNoNul, parseOrInvalid } from '../validation'
import { logChange } from './changeLog'
import type { Executor } from './executor'
import { requireLayerEdit } from './layers'
import { requireShowRole } from './tenancy'

export type Cue = InferSelectModel<typeof cues>
export type CueView = Cue & { departmentCode: string; display: string; duplicate: boolean }

const FIELD_KEYS = [
  'departmentId',
  'major',
  'minor',
  'label',
  'type',
  'notes',
  'colour',
  'anchor',
] as const satisfies ReadonlyArray<keyof CueFields>

const patchSchema = cueFieldsSchema.partial()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const fieldsOf = (cue: Cue): CueFields =>
  Object.fromEntries(FIELD_KEYS.map((k) => [k, cue[k]])) as unknown as CueFields

const layerOf = (departmentId: string) => layerKey({ kind: 'department', id: departmentId })

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null
  return e?.code === '23505' || e?.cause?.code === '23505'
}

/** Internal (not in the barrel): the raw row, for the sync policy and other services. */
export async function loadCueRow(db: Executor, id: string): Promise<Cue | null> {
  if (id.includes('\u0000')) return null
  const [row] = await db.select().from(cues).where(eq(cues.id, id))
  return row ?? null
}

/**
 * Internal: the anchor's version must exist, belong to `anchor.documentId`, and that document to
 * the show; once the version is ready the page must exist. Anything else is `invalid`.
 */
export async function assertAnchorTarget(
  db: Executor,
  showId: string,
  anchor: Anchor,
): Promise<void> {
  const [version] = await db
    .select({
      documentId: documentVersions.documentId,
      showId: documentVersions.showId,
      status: documentVersions.status,
      pageCount: documentVersions.pageCount,
    })
    .from(documentVersions)
    .where(eq(documentVersions.id, anchor.documentVersionId))
  if (!version || version.documentId !== anchor.documentId || version.showId !== showId) {
    throw invalid('anchor does not point at a version of a document in this show')
  }
  const [doc] = await db
    .select({ showId: documents.showId })
    .from(documents)
    .where(eq(documents.id, anchor.documentId))
  if (!doc || doc.showId !== showId) throw invalid('anchor document is not in this show')
  if (
    version.status === 'ready' &&
    version.pageCount !== null &&
    anchor.pageIndex >= version.pageCount
  ) {
    throw invalid(`anchor pageIndex ${anchor.pageIndex} is beyond the ${version.pageCount} pages`)
  }
}

/** The number for a new cue from its department's neighbours on the same version, in reading order. */
async function numberForNewCue(
  tx: Executor,
  showId: string,
  departmentId: string,
  anchor: Anchor | null,
): Promise<CueNumber> {
  const peers = await tx
    .select({ major: cues.major, minor: cues.minor, anchor: cues.anchor })
    .from(cues)
    .where(and(eq(cues.showId, showId), eq(cues.departmentId, departmentId)))
  if (!anchor) {
    const highest = peers.reduce<CueNumber | null>(
      (max, c) => (!max || c.major * 100 + c.minor > max.major * 100 + max.minor ? c : max),
      null,
    )
    return suggestCueNumber(highest && { major: highest.major, minor: highest.minor }, null)
  }
  const onVersion = peers
    .filter((c) => c.anchor?.documentVersionId === anchor.documentVersionId)
    .sort((a, b) => compareReadingOrder(a.anchor as Anchor, b.anchor as Anchor))
  const prev = onVersion.filter((c) => compareReadingOrder(c.anchor as Anchor, anchor) <= 0).at(-1)
  const next = onVersion.find((c) => compareReadingOrder(c.anchor as Anchor, anchor) > 0)
  return suggestCueNumber(
    prev ? { major: prev.major, minor: prev.minor } : null,
    next ? { major: next.major, minor: next.minor } : null,
  )
}

export async function createCue(
  db: Executor,
  actor: Actor,
  input: {
    showId: string
    id?: string
    departmentId: string
    number?: CueNumber
    label?: string
    type?: CueType
    notes?: string
    colour?: string | null
    anchor?: Anchor | null
    batchId?: string
    clientTs?: Date
  },
): Promise<Cue> {
  const batchId = input.batchId ?? newId()
  if (input.id !== undefined && !UUID_RE.test(input.id)) throw invalid('id must be a UUID')
  if (input.showId.includes('\u0000')) throw invalid('showId must not contain NUL')
  const draft = {
    departmentId: input.departmentId,
    major: input.number?.major ?? 0,
    minor: input.number?.minor ?? 0,
    label: input.label ?? '',
    type: input.type ?? 'go',
    notes: input.notes ?? '',
    colour: input.colour ?? null,
    anchor: input.anchor ?? null,
  }
  const fields = parseOrInvalid(cueFieldsSchema, draft)

  return db.transaction(async (tx) => {
    await requireLayerEdit(tx, actor, input.showId, { kind: 'department', id: fields.departmentId })
    if (fields.anchor) await assertAnchorTarget(tx, input.showId, fields.anchor)
    const id = input.id ?? newId()
    if (input.id && (await loadCueRow(tx, id))) throw conflict('A cue with this id already exists')
    if (!input.number) {
      const n = await numberForNewCue(tx, input.showId, fields.departmentId, fields.anchor)
      fields.major = n.major
      fields.minor = n.minor
    }
    let created: Cue
    try {
      ;[created] = await tx
        .insert(cues)
        .values({ ...fields, id, showId: input.showId, updatedBy: actor.userId })
        .returning()
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('A cue with this id already exists')
      throw err
    }
    await logChange(tx, {
      showId: input.showId,
      actor,
      batchId,
      table: 'cues',
      rowId: id,
      op: 'insert',
      before: null,
      after: { ...fieldsOf(created) },
      layer: layerOf(created.departmentId),
      clientTs: input.clientTs,
    })
    return created
  })
}

export async function updateCue(
  db: Executor,
  actor: Actor,
  input: { cueId: string; patch: Partial<CueFields>; batchId?: string; clientTs?: Date },
): Promise<Cue> {
  const batchId = input.batchId ?? newId()
  const patch = parseOrInvalid(patchSchema, input.patch)
  return db.transaction(async (tx) => {
    const current = await loadCueRow(tx, input.cueId)
    if (!current) throw notFound('Cue not found')
    await requireLayerEdit(tx, actor, current.showId, layerRef(current.departmentId))

    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const key of FIELD_KEYS) {
      const next = patch[key]
      if (next === undefined) continue
      const was = current[key]
      const same = key === 'anchor' ? columnEqual(was, next) : was === next
      if (same) continue
      before[key] = was
      after[key] = next
    }
    if (Object.keys(after).length === 0) return current

    if (typeof after.departmentId === 'string') {
      await requireLayerEdit(tx, actor, current.showId, layerRef(after.departmentId))
    }
    if (after.anchor) await assertAnchorTarget(tx, current.showId, after.anchor as Anchor)

    const [updated] = await tx
      .update(cues)
      .set({ ...after, updatedBy: actor.userId })
      .where(eq(cues.id, current.id))
      .returning()
    await logChange(tx, {
      showId: current.showId,
      actor,
      batchId,
      table: 'cues',
      rowId: current.id,
      op: 'update',
      before,
      after,
      layer: layerOf(updated.departmentId),
      clientTs: input.clientTs,
    })
    return updated
  })
}

const layerRef = (departmentId: string) => ({ kind: 'department' as const, id: departmentId })

/** All or nothing: one missing or refused cue refuses the call and nothing is deleted. */
export async function deleteCues(
  db: Executor,
  actor: Actor,
  input: { cueIds: string[]; batchId?: string; clientTs?: Date },
): Promise<{ deleted: string[] }> {
  const batchId = input.batchId ?? newId()
  if (!hasNoNul(input.cueIds)) throw invalid('cueIds must not contain NUL')
  const ids = [...new Set(input.cueIds)]
  if (ids.length === 0) throw invalid('cueIds must not be empty')
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(cues).where(inArray(cues.id, ids))
    const byId = new Map(rows.map((r) => [r.id, r]))
    for (const id of ids) {
      const row = byId.get(id)
      if (!row) throw notFound('Cue not found')
      await requireLayerEdit(tx, actor, row.showId, layerRef(row.departmentId))
    }
    for (const id of ids) {
      const row = byId.get(id) as Cue
      await tx.delete(cues).where(eq(cues.id, id))
      await logChange(tx, {
        showId: row.showId,
        actor,
        batchId,
        table: 'cues',
        rowId: id,
        op: 'delete',
        before: { ...fieldsOf(row) },
        after: null,
        layer: layerOf(row.departmentId),
        clientTs: input.clientTs,
      })
    }
    return { deleted: ids }
  })
}

interface DepartmentInfo {
  id: string
  code: string
  numberFormat: 'decimal' | 'point'
  sortOrder: number
}

async function viewsFor(db: Executor, showId: string): Promise<CueView[]> {
  const depts: DepartmentInfo[] = await db
    .select({
      id: departments.id,
      code: departments.code,
      numberFormat: departments.numberFormat,
      sortOrder: departments.sortOrder,
    })
    .from(departments)
    .where(eq(departments.showId, showId))
  const byId = new Map(depts.map((d) => [d.id, d]))
  const rows = await db.select().from(cues).where(eq(cues.showId, showId))
  const counts = new Map<string, number>()
  const key = (c: Cue) => `${c.departmentId}\u0000${c.major}\u0000${c.minor}`
  for (const c of rows) counts.set(key(c), (counts.get(key(c)) ?? 0) + 1)
  return rows
    .map((c) => {
      const dept = byId.get(c.departmentId) as DepartmentInfo
      return {
        ...c,
        departmentCode: dept.code,
        display: formatCueNumber(c.major, c.minor, dept.numberFormat),
        duplicate: (counts.get(key(c)) ?? 0) > 1,
      }
    })
    .sort(
      (a, b) =>
        (byId.get(a.departmentId)?.sortOrder ?? 0) - (byId.get(b.departmentId)?.sortOrder ?? 0) ||
        a.departmentCode.localeCompare(b.departmentCode) ||
        a.major - b.major ||
        a.minor - b.minor ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    )
}

/** Any member. */
export async function getCue(
  db: Executor,
  actor: Actor,
  input: { cueId: string },
): Promise<CueView> {
  const row = await loadCueRow(db, input.cueId)
  if (!row) throw notFound('Cue not found')
  await requireShowRole(db, actor, row.showId, 'viewer')
  const view = (await viewsFor(db, row.showId)).find((c) => c.id === row.id)
  if (!view) throw notFound('Cue not found')
  return view
}

/** Any member. Sorted by department sort order, then (major, minor); duplicates are per show. */
export async function listCues(
  db: Executor,
  actor: Actor,
  input: { showId: string; departmentId?: string; documentId?: string; placed?: boolean },
): Promise<CueView[]> {
  await requireShowRole(db, actor, input.showId, 'viewer')
  return (await viewsFor(db, input.showId)).filter(
    (c) =>
      (input.departmentId === undefined || c.departmentId === input.departmentId) &&
      (input.documentId === undefined || c.anchor?.documentId === input.documentId) &&
      (input.placed === undefined || (c.anchor !== null) === input.placed),
  )
}
