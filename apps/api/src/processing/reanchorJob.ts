import { reanchor, reanchorAll, type VersionText } from '@binder/core'
import { annotations, changeLog, cues, documents, documentVersions, shows } from '@binder/db'
import type { Actor, Anchor, AnchorStatus } from '@binder/shared'
import { and, asc, eq, type SQLWrapper, sql } from 'drizzle-orm'
import { writeAnchorUnchecked } from '../services/anchorWrites'
import { setCurrentVersion } from '../services/documents'
import type { Executor } from '../services/executor'
import { loadVersionText } from '../services/wordLayers'
import type { ProcessingDeps } from './types'

/**
 * The agent every change-log row of a re-anchoring run carries. With `via = 'web'` it cannot come
 * from a client: session actors carry `agent: null`, bearer and MCP actors carry `via: 'mcp'`.
 */
export const REANCHOR_AGENT = 'Binder re-anchoring'

/** The change-log batch of one run. Client batch ids cannot contain `:` (Task 3), so none can collide. */
export const reanchorBatchId = (versionId: string): string => `reanchor:${versionId}`

export interface ReanchorResult {
  moved: number
  byStatus: Record<AnchorStatus, number>
}

export type ReanchorSkip = { skipped: 'already-run' | 'not-needed' }

type Version = typeof documentVersions.$inferSelect
type Document = typeof documents.$inferSelect
type Runnable = { version: Version; document: Document }

/** Whether a run of this version has logged its batch, completed or since reverted. */
async function wasRun(x: Executor, version: Version): Promise<boolean> {
  const [row] = await x
    .select({ seq: changeLog.seq })
    .from(changeLog)
    .where(
      and(eq(changeLog.showId, version.showId), eq(changeLog.batchId, reanchorBatchId(version.id))),
    )
    .limit(1)
  return row !== undefined
}

/**
 * Whether `versionId` still needs its run, optionally under the document's row lock. A version with a
 * `reanchor:<versionId>` batch in the change log was run already (completed or reverted: a reverted
 * run is never repeated). Otherwise the version must be ready, in an open show, not the current
 * version, and not older than the current one.
 */
async function checkRunnable(
  x: Executor,
  versionId: string,
  lock: boolean,
): Promise<Runnable | ReanchorSkip> {
  const [version] = await x
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, versionId))
  if (!version) return { skipped: 'not-needed' }
  if (await wasRun(x, version)) return { skipped: 'already-run' }
  if (version.status !== 'ready') return { skipped: 'not-needed' }

  const documentQuery = x.select().from(documents).where(eq(documents.id, version.documentId))
  const [document] = await (lock ? documentQuery.for('update') : documentQuery)
  if (!document) return { skipped: 'not-needed' }
  // An archived show is read-only (spec 4.1): nothing rewrites its anchors.
  const [show] = await x
    .select({ status: shows.status })
    .from(shows)
    .where(eq(shows.id, version.showId))
  if (!show || show.status === 'archived') return { skipped: 'not-needed' }

  // Under the lock, the check is made again: a concurrent run may have committed since the first one.
  if (lock && (await wasRun(x, version))) return { skipped: 'already-run' }
  if (document.currentVersionId === versionId) return { skipped: 'not-needed' }
  if (document.currentVersionId !== null) {
    const [current] = await x
      .select({ number: documentVersions.versionNumber })
      .from(documentVersions)
      .where(eq(documentVersions.id, document.currentVersionId))
    if (current && current.number > version.versionNumber) return { skipped: 'not-needed' }
  }
  return { version, document }
}

const runActor = (version: Version): Actor => ({
  userId: version.uploadedBy,
  via: 'web',
  agent: REANCHOR_AGENT,
})

interface AnchorRow {
  table: 'cues' | 'annotations'
  id: string
  anchor: Anchor
}

/** The unplaced-safe fallback for an anchor the matcher failed on: same page, x and y, unresolved. */
function unresolvedOn(anchor: Anchor, to: VersionText): Anchor {
  const out: Anchor = {
    ...anchor,
    documentVersionId: to.versionId,
    pageIndex: Math.max(0, Math.min(anchor.pageIndex, to.pageCount - 1)),
    status: 'unresolved',
  }
  if (anchor.text) out.text = { quote: anchor.text.quote, wordStart: -1, wordEnd: -1 }
  return out
}

/** The matcher never throws per anchor; this keeps one bad anchor from failing the run anyway. */
function moveAll(anchors: Anchor[], from: VersionText, to: VersionText): Anchor[] {
  try {
    return reanchorAll(anchors, from, to)
  } catch {
    return anchors.map((a) => {
      try {
        return reanchor(a, from, to)
      } catch {
        return unresolvedOn(a, to)
      }
    })
  }
}

/** The ids of the document's versions numbered below the one being run. */
async function olderVersions(x: Executor, run: Runnable): Promise<Set<string>> {
  const rows = await x
    .select({ id: documentVersions.id, number: documentVersions.versionNumber })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, run.document.id))
  return new Set(rows.filter((r) => r.number < run.version.versionNumber).map((r) => r.id))
}

/** Cue and annotation rows of the document on an older version, locked, in (table, id) order. */
async function lockAnchorRows(
  tx: Executor,
  run: Runnable,
  older: Set<string>,
): Promise<AnchorRow[]> {
  const { version, document } = run
  const onDocument = (column: SQLWrapper) =>
    and(
      sql`${column}->>'documentId' = ${document.id}`,
      sql`${column}->>'documentVersionId' <> ${version.id}`,
    )
  const noteRows = await tx
    .select({ id: annotations.id, anchor: annotations.anchor })
    .from(annotations)
    .where(and(eq(annotations.showId, version.showId), onDocument(annotations.anchor)))
    .orderBy(asc(annotations.id))
    .for('update')
  const cueRows = await tx
    .select({ id: cues.id, anchor: cues.anchor })
    .from(cues)
    .where(and(eq(cues.showId, version.showId), onDocument(cues.anchor)))
    .orderBy(asc(cues.id))
    .for('update')
  const rows: AnchorRow[] = [
    ...noteRows.map((r) => ({ table: 'annotations' as const, id: r.id, anchor: r.anchor })),
    ...cueRows.flatMap((r) =>
      r.anchor ? [{ table: 'cues' as const, id: r.id, anchor: r.anchor }] : [],
    ),
  ]
  // Only anchors on older versions move; one already on a newer version is not pulled back.
  return rows.filter((r) => older.has(r.anchor.documentVersionId))
}

/**
 * Spec 5.4: moves every cue and annotation anchor of the revised document onto the new version, then
 * makes it current, all in one transaction (one revertable change-log batch, `reanchor:<versionId>`).
 * Never fails as a whole because of one anchor: each ends `ok`, `approximate` or `unresolved`, and no
 * cue is deleted. Safe to repeat and to run twice at once: a version that already has its batch (even
 * a reverted one) is skipped, and the check is made again under the document's row lock.
 */
export async function reanchorVersion(
  deps: ProcessingDeps,
  versionId: string,
): Promise<ReanchorResult | ReanchorSkip> {
  const { db, blobs } = deps
  const first = await checkRunnable(db, versionId, false)
  if ('skipped' in first) return first

  // Word layers are read before the transaction opens, so it does not hold the lock over blob reads.
  const texts = new Map<string, VersionText>()
  const textOf = async (id: string): Promise<VersionText> => {
    const known = texts.get(id)
    if (known) return known
    const loaded = await loadVersionText(db, blobs, id)
    texts.set(id, loaded)
    return loaded
  }
  await textOf(versionId)
  const older = await olderVersions(db, first)
  const used = await db
    .selectDistinct({ id: sql<string>`${cues.anchor}->>'documentVersionId'` })
    .from(cues)
    .where(
      and(
        eq(cues.showId, first.version.showId),
        sql`${cues.anchor}->>'documentId' = ${first.document.id}`,
      ),
    )
  const usedByNotes = await db
    .selectDistinct({ id: sql<string>`${annotations.anchor}->>'documentVersionId'` })
    .from(annotations)
    .where(
      and(
        eq(annotations.showId, first.version.showId),
        sql`${annotations.anchor}->>'documentId' = ${first.document.id}`,
      ),
    )
  for (const { id } of [...used, ...usedByNotes]) {
    if (older.has(id)) await textOf(id)
  }

  return db.transaction(async (tx) => {
    const run = await checkRunnable(tx, versionId, true)
    if ('skipped' in run) return run
    const { version, document } = run
    const actor = runActor(version)
    const batchId = reanchorBatchId(versionId)

    const rows = await lockAnchorRows(tx, run, await olderVersions(tx, run))

    const to = await textOf(versionId)
    const byVersion = new Map<string, AnchorRow[]>()
    for (const row of rows) {
      const group = byVersion.get(row.anchor.documentVersionId)
      if (group) group.push(row)
      else byVersion.set(row.anchor.documentVersionId, [row])
    }

    const byStatus: Record<AnchorStatus, number> = { ok: 0, approximate: 0, unresolved: 0 }
    const moved = new Map<AnchorRow, Anchor>()
    for (const [fromId, group] of byVersion) {
      const from = await textOf(fromId)
      const next = moveAll(
        group.map((r) => r.anchor),
        from,
        to,
      )
      for (const [i, row] of group.entries()) moved.set(row, next[i] as Anchor)
    }
    let count = 0
    for (const row of rows) {
      const next = moved.get(row) as Anchor
      await writeAnchorUnchecked(tx, actor, row.table, row.id, next, batchId)
      byStatus[next.status]++
      count++
    }
    await setCurrentVersion(tx, actor, document.id, versionId, batchId)
    return { moved: count, byStatus }
  })
}

/**
 * The re-anchoring queue's dead-letter action (R45): pg-boss gave up after retries or expiry. Under
 * the same guards and lock as the run, makes the version current without moving any anchor, so a
 * version never stays ready but not current. Anchors left on older versions surface in the review
 * list. Logged under the run's batch id, so the sweep and a replayed job never run it afterwards.
 */
export async function adoptVersionWithoutReanchoring(
  deps: Pick<ProcessingDeps, 'db'>,
  versionId: string,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const run = await checkRunnable(tx, versionId, true)
    if ('skipped' in run) return
    await setCurrentVersion(
      tx,
      runActor(run.version),
      run.document.id,
      versionId,
      reanchorBatchId(versionId),
    )
  })
}
