import { columnEqual } from '@binder/core'
import { annotations, changeLog, cues, departments, documents, shows } from '@binder/db'
import {
  type Actor,
  type Anchor,
  type AnnotationFields,
  type CueFields,
  isLayerVisibleTo,
  newId,
  type RevertResult,
} from '@binder/shared'
import { and, desc, eq } from 'drizzle-orm'
import { AppError, conflict, IdTaken, invalid, notFound } from '../errors'
import { REANCHOR_AGENT } from '../processing/reanchorJob'
import { hasNoNul } from '../validation'
import { writeAnchorUnchecked } from './anchorWrites'
import { createAnnotation, deleteAnnotations, updateAnnotation } from './annotations'
import { createCue, deleteCues, updateCue } from './cues'
import { updateDepartment } from './departments'
import { setCurrentVersion, updateDocument } from './documents'
import type { Executor } from './executor'
import { assertShowWritable, requireShowRole, updateShow } from './tenancy'

type LogRow = typeof changeLog.$inferSelect
type Columns = Record<string, unknown>

/** Every op on these tables can be reverted. */
const FULL = new Set(['cues', 'annotations'])
/** Only updates on these tables can be reverted (their inserts and deletes are lifecycle events). */
const UPDATE_ONLY = new Set(['departments', 'documents', 'shows'])

interface Outcome extends RevertResult {
  rows: number
  deletes: number
}

/** Thrown to roll a dry run back; carries what the real run would have done. */
class DryRunComplete extends Error {
  constructor(readonly outcome: Outcome) {
    super('dry run')
  }
}

/**
 * The user whose personal layer an annotation move names (a personal-to-department move is logged
 * on the destination layer, with the former personal layer in `before`), or null.
 */
function columnOwner(row: LogRow): string | null {
  if (row.tableName !== 'annotations') return null
  for (const cols of [row.before, row.after] as Array<Columns | null>) {
    if (cols?.layerKind === 'personal' && typeof cols.layerId === 'string') return cols.layerId
  }
  return null
}

/** Rows on another user's personal layer are not part of what this reader can see (fails closed). */
const visibleRow = (row: LogRow, actor: Actor): boolean => isLayerVisibleTo(row.layer, actor.userId)

/** A visible row whose revert would land on another user's personal layer is not_found. */
function assertNotOthersPersonal(row: LogRow, actor: Actor): void {
  const owner = columnOwner(row)
  if (owner !== null && owner !== actor.userId) throw notFound('Change not found')
}

function assertRevertable(row: LogRow, single: boolean): void {
  const ok = FULL.has(row.tableName) || (UPDATE_ONLY.has(row.tableName) && row.op === 'update')
  if (!ok) throw invalid(`a ${row.op} on ${row.tableName} cannot be reverted`)
  if (row.op === 'update' && (!row.before || Object.keys(row.before).length === 0)) {
    throw invalid('this change recorded no values to restore')
  }
  // Switching the current version without the anchors that moved with it would strand them.
  if (single && row.tableName === 'documents' && row.before && 'currentVersionId' in row.before) {
    throw invalid('the current version can only be reverted together with its whole batch')
  }
}

/**
 * The row as it is now, locked (`FOR UPDATE`) until the revert transaction ends: a concurrent
 * commit to a column between this read and the service's write would otherwise be overwritten
 * without a conflict. Under READ COMMITTED a locked read returns the latest committed version.
 */
async function loadCurrent(tx: Executor, row: LogRow): Promise<Columns | null> {
  const first = async (query: PromiseLike<unknown[]>) =>
    ((await query)[0] ?? null) as Columns | null
  switch (row.tableName) {
    case 'cues':
      return first(tx.select().from(cues).where(eq(cues.id, row.rowId)).for('update'))
    case 'annotations':
      return first(tx.select().from(annotations).where(eq(annotations.id, row.rowId)).for('update'))
    case 'departments':
      return first(tx.select().from(departments).where(eq(departments.id, row.rowId)).for('update'))
    case 'documents':
      return first(tx.select().from(documents).where(eq(documents.id, row.rowId)).for('update'))
    case 'shows':
      return first(tx.select().from(shows).where(eq(shows.id, row.rowId)).for('update'))
    default:
      return null
  }
}

/**
 * Locks every row the revert will touch in a fixed order, so concurrent reverts cannot deadlock: the
 * document rows first (the re-anchoring job takes a document's lock before its cues and annotations),
 * then (table, id).
 */
async function lockRows(tx: Executor, rows: LogRow[]): Promise<void> {
  const rank = (r: LogRow) => (r.tableName === 'documents' ? '0' : '1')
  const keys = new Map(rows.map((r) => [`${rank(r)}${r.tableName}\u0000${r.rowId}`, r]))
  for (const key of [...keys.keys()].sort()) await loadCurrent(tx, keys.get(key) as LogRow)
}

const driftOf = (current: Columns, values: Columns | null): string[] =>
  Object.keys(values ?? {}).filter((k) => !columnEqual(current[k], (values as Columns)[k]))

async function writeUpdate(
  tx: Executor,
  actor: Actor,
  row: LogRow,
  patch: Columns,
  batchId: string,
): Promise<void> {
  switch (row.tableName) {
    case 'cues':
      await updateCue(tx, actor, { cueId: row.rowId, patch: patch as Partial<CueFields>, batchId })
      return
    case 'annotations':
      await updateAnnotation(tx, actor, {
        annotationId: row.rowId,
        patch: patch as Partial<AnnotationFields>,
        batchId,
      })
      return
    case 'departments':
      await updateDepartment(tx, actor, {
        departmentId: row.rowId,
        patch: patch as Parameters<typeof updateDepartment>[2]['patch'],
        batchId,
      })
      return
    case 'documents': {
      const { currentVersionId, ...rest } = patch
      if (currentVersionId !== undefined) {
        // Only a batch revert gets here (assertRevertable): an editor's document operation.
        await requireShowRole(tx, actor, row.showId, 'editor')
        await setCurrentVersion(tx, actor, row.rowId, currentVersionId as string | null, batchId)
      }
      if (Object.keys(rest).length > 0) {
        await updateDocument(tx, actor, {
          documentId: row.rowId,
          patch: rest as Parameters<typeof updateDocument>[2]['patch'],
          batchId,
        })
      }
      return
    }
    case 'shows':
      await updateShow(tx, actor, {
        showId: row.rowId,
        patch: patch as Parameters<typeof updateShow>[2]['patch'],
        batchId,
      })
      return
  }
}

async function writeDelete(tx: Executor, actor: Actor, row: LogRow, batchId: string) {
  if (row.tableName === 'cues') await deleteCues(tx, actor, { cueIds: [row.rowId], batchId })
  else await deleteAnnotations(tx, actor, { annotationIds: [row.rowId], batchId })
}

async function writeCreate(tx: Executor, actor: Actor, row: LogRow, batchId: string) {
  const before = (row.before ?? {}) as Columns
  if (row.tableName === 'cues') {
    const f = before as unknown as CueFields
    await createCue(tx, actor, {
      showId: row.showId,
      id: row.rowId,
      departmentId: f.departmentId,
      number: { major: f.major, minor: f.minor },
      label: f.label,
      type: f.type,
      notes: f.notes,
      colour: f.colour,
      anchor: f.anchor,
      batchId,
    })
  } else {
    await createAnnotation(tx, actor, {
      showId: row.showId,
      id: row.rowId,
      ...(before as unknown as AnnotationFields),
      batchId,
    })
  }
}

/** Archived shows are read-only (spec 4.1): refused before any row is looked at. */
async function assertWritable(tx: Executor, showId: string): Promise<void> {
  const [show] = await tx.select({ status: shows.status }).from(shows).where(eq(shows.id, showId))
  if (!show) throw notFound('Show not found')
  assertShowWritable(show)
}

/**
 * Reverts `rows` (newest first) through the owning services in the caller's transaction. Any throw
 * rolls the whole call back, so a conflict or a refused row writes nothing.
 */
async function revertRows(
  tx: Executor,
  actor: Actor,
  rows: LogRow[],
  opts: { force: boolean; single: boolean },
): Promise<Outcome> {
  for (const row of rows) {
    assertRevertable(row, opts.single)
    assertNotOthersPersonal(row, actor)
  }
  await lockRows(tx, rows)
  const batchId = newId()
  const skipped: RevertResult['skipped'] = []
  let reverted = 0
  let deletes = 0
  for (const row of rows) {
    const current = await loadCurrent(tx, row)
    // A row that now sits on another user's personal layer does not exist for this actor, so a
    // conflict message must not hint that it moved there.
    if (
      current?.layerKind === 'personal' &&
      typeof current.layerId === 'string' &&
      current.layerId !== actor.userId
    ) {
      throw notFound('Change not found')
    }
    if (row.op === 'update') {
      if (!current) {
        if (opts.single) throw conflict(`${row.tableName} ${row.rowId} no longer exists`)
        skipped.push({ seq: row.seq, reason: 'row-gone' })
        continue
      }
      const drift = driftOf(current, row.after)
      if (drift.length > 0 && !opts.force) {
        throw conflict(
          `${row.tableName} ${row.rowId} has changed since (${drift.join(', ')}); revert with force to overwrite`,
        )
      }
      const before = row.before as Columns
      if (driftOf(current, before).length === 0) {
        skipped.push({ seq: row.seq, reason: 'already-reverted' })
        continue
      }
      await writeUpdate(tx, actor, row, before, batchId)
      reverted++
    } else if (row.op === 'insert') {
      if (!current) {
        skipped.push({ seq: row.seq, reason: 'already-reverted' })
        continue
      }
      const drift = driftOf(current, row.after)
      if (drift.length > 0 && !opts.force) {
        throw conflict(
          `${row.tableName} ${row.rowId} has changed since (${drift.join(', ')}); revert with force to delete it anyway`,
        )
      }
      await writeDelete(tx, actor, row, batchId)
      reverted++
      deletes++
    } else {
      if (current) {
        if (!opts.force) throw conflict(`${row.tableName} ${row.rowId}: row exists again`)
        skipped.push({ seq: row.seq, reason: 'already-reverted' })
        continue
      }
      try {
        await writeCreate(tx, actor, row, batchId)
      } catch (err) {
        // Someone created this id after the read above: it exists again.
        if (!(err instanceof IdTaken)) throw err
        if (!opts.force) throw conflict(`${row.tableName} ${row.rowId}: row exists again`)
        skipped.push({ seq: row.seq, reason: 'already-reverted' })
        continue
      }
      reverted++
    }
  }
  return { batchId, reverted, skipped, rows: reverted, deletes }
}

/**
 * A batch is the server-authored re-anchoring run when every one of its rows has `via = 'web'` and
 * `agent = REANCHOR_AGENT`, a combination no client can produce: session actors carry `agent: null`,
 * bearer and MCP actors carry `via: 'mcp'`. The batch id is never consulted, and one row that does
 * not match makes the whole batch an ordinary one.
 */
function isServerAuthoredRun(rows: LogRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.via === 'web' && r.agent === REANCHOR_AGENT)
}

/**
 * Reverts the re-anchoring run as one document operation (spec 5.4): `editor` on the show instead
 * of per-row layer rights, the unchecked writers under the reverter as actor, a new batch id, and
 * every row the run wrote, including other members' personal annotations (the run wrote them, and
 * leaving them behind would strand personal notes on a version that is no longer current). Drift
 * still counts: a row changed since the run is a `conflict` unless `force`. What the reverter cannot
 * see (another member's personal rows) is only ever counted: it is never named in the result, in the
 * skipped list or in a conflict message.
 */
async function revertServerRun(
  tx: Executor,
  actor: Actor,
  showId: string,
  rows: LogRow[],
  opts: { force: boolean },
): Promise<Outcome> {
  await requireShowRole(tx, actor, showId, 'editor')
  for (const row of rows) {
    const known =
      row.tableName === 'cues' || row.tableName === 'annotations' || row.tableName === 'documents'
    if (!known || row.op !== 'update' || !row.before || !row.after) {
      throw invalid('this re-anchoring batch cannot be reverted')
    }
  }
  await lockRows(tx, rows)
  const current = new Map<LogRow, Columns | null>()
  let drifted = 0
  for (const row of rows) {
    const now = await loadCurrent(tx, row)
    current.set(row, now)
    if (now && driftOf(now, row.after).length > 0) drifted++
  }
  if (drifted > 0 && !opts.force) {
    throw conflict(
      `${drifted} ${drifted === 1 ? 'row has' : 'rows have'} changed since this re-anchoring run; revert with force to overwrite`,
    )
  }

  const batchId = newId()
  const skipped: RevertResult['skipped'] = []
  let reverted = 0
  for (const row of rows) {
    const now = current.get(row)
    const visible = visibleRow(row, actor)
    const before = row.before as Columns
    if (!now) {
      if (visible) skipped.push({ seq: row.seq, reason: 'row-gone' })
      continue
    }
    if (driftOf(now, before).length === 0) {
      if (visible) skipped.push({ seq: row.seq, reason: 'already-reverted' })
      continue
    }
    if (row.tableName === 'documents') {
      await setCurrentVersion(
        tx,
        actor,
        row.rowId,
        before.currentVersionId as string | null,
        batchId,
      )
    } else {
      await writeAnchorUnchecked(
        tx,
        actor,
        row.tableName as 'cues' | 'annotations',
        row.rowId,
        before.anchor as Anchor,
        batchId,
      )
    }
    reverted++
  }
  return { batchId, reverted, skipped, rows: reverted, deletes: 0 }
}

/** Runs `work` in a transaction; with `dryRun` everything it wrote is rolled back and its outcome returned. */
async function transact(
  db: Executor,
  dryRun: boolean,
  work: (tx: Executor) => Promise<Outcome>,
): Promise<Outcome> {
  try {
    return await db.transaction(async (tx) => {
      const outcome = await work(tx)
      if (dryRun) throw new DryRunComplete(outcome)
      return outcome
    })
  } catch (err) {
    if (err instanceof DryRunComplete) return err.outcome
    throw err
  }
}

/**
 * Reverts one change log row by writing its before values back (spec 4.12): an ordinary logged,
 * revertable write in a new batch, which needs edit rights on the row's layer or table. A column
 * changed since is `conflict` unless `force`. `showId`, when given, must be the row's show.
 */
export async function revertChange(
  db: Executor,
  actor: Actor,
  input: { seq: number; force?: boolean; showId?: string },
): Promise<RevertResult> {
  if (!Number.isSafeInteger(input.seq) || input.seq < 1)
    throw invalid('seq must be a positive integer')
  const {
    rows: _rows,
    deletes: _deletes,
    ...result
  } = await transact(db, false, async (tx) => {
    const [row] = await tx.select().from(changeLog).where(eq(changeLog.seq, input.seq))
    if (!row || (input.showId !== undefined && row.showId !== input.showId)) {
      throw notFound('Change not found')
    }
    try {
      await requireShowRole(tx, actor, row.showId, 'viewer')
    } catch (err) {
      if (err instanceof AppError && err.code === 'not_found') throw notFound('Change not found')
      throw err
    }
    if (!visibleRow(row, actor)) throw notFound('Change not found')
    await assertWritable(tx, row.showId)
    return revertRows(tx, actor, [row], { force: input.force === true, single: true })
  })
  return result
}

/**
 * Reverts every change log row of one batch written by one user, newest first, in one new batch
 * and one transaction. The user id is part of the key because clients choose batch ids, so two
 * users can share one. Rows on another user's personal layer are not part of the batch for this
 * reader. `dryRun` does all the work, rights and conflicts included, and rolls it back, returning
 * how many rows it would change and how many it would delete. The one exception to the per-row
 * rules is the server-authored re-anchoring run (`revertServerRun`).
 */
export async function revertBatch(
  db: Executor,
  actor: Actor,
  input: { showId: string; batchId: string; userId: string; force?: boolean; dryRun?: boolean },
): Promise<RevertResult & { rows: number; deletes: number }> {
  if (!hasNoNul([input.showId, input.batchId, input.userId]))
    throw invalid('ids must not contain NUL')
  return transact(db, input.dryRun === true, async (tx) => {
    await requireShowRole(tx, actor, input.showId, 'viewer')
    await assertWritable(tx, input.showId)
    const all = await tx
      .select()
      .from(changeLog)
      .where(
        and(
          eq(changeLog.showId, input.showId),
          eq(changeLog.batchId, input.batchId),
          eq(changeLog.userId, input.userId),
        ),
      )
      .orderBy(desc(changeLog.seq))
    if (isServerAuthoredRun(all)) {
      return revertServerRun(tx, actor, input.showId, all, { force: input.force === true })
    }
    const rows = all.filter((r) => visibleRow(r, actor))
    if (rows.length === 0) throw notFound('Batch not found')
    return revertRows(tx, actor, rows, { force: input.force === true, single: false })
  })
}
