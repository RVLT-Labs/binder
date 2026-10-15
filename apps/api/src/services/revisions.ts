import {
  columnEqual,
  compareReadingOrder,
  diffVersionLines,
  formatCueNumber,
  type LineDiffEntry,
  reanchor,
  type VersionText,
} from '@binder/core'
import { annotations, changeLog, cues, departments, documents, documentVersions } from '@binder/db'
import {
  type Actor,
  type Anchor,
  isLayerVisibleTo,
  type LayerRef,
  layerKey,
  type ReviewItem,
} from '@binder/shared'
import { and, desc, eq, inArray, or, type SQL, sql } from 'drizzle-orm'
import type { BlobStore } from '../blob/BlobStore'
import { AppError, conflict, invalid, notFound } from '../errors'
import { reanchorRowCondition } from '../processing/reanchorJob'
import { hasNoNul } from '../validation'
import { type Annotation, loadAnnotationRow, updateAnnotation } from './annotations'
import { type Cue, loadCueRow, updateCue } from './cues'
import type { Executor } from './executor'
import { visibleTo } from './history'
import { requireLayerEdit } from './layers'
import { requireShowRole } from './tenancy'
import { loadVersionText } from './wordLayers'

type Table = 'cues' | 'annotations'

const TABLES: readonly Table[] = ['cues', 'annotations']
const ACTIONS = ['accept', 'revert', 'reanchor'] as const
export type ReanchorAction = (typeof ACTIONS)[number]

export const COMPARE_DEFAULT_LIMIT = 2000
export const COMPARE_MAX_LIMIT = 10000

/** How many words of an annotation's text or highlight quote a review title carries. */
const TITLE_WORDS = 6

/** A cue or annotation of the document that the actor may see, with what the review needs of it. */
interface Candidate {
  table: Table
  rowId: string
  layer: string
  anchor: Anchor
  title: string
}

/** Viewer on the show, answering a non-member with the message a missing id gets (R41). */
async function requireViewer(
  db: Executor,
  actor: Actor,
  showId: string,
  missing: string,
): Promise<void> {
  try {
    await requireShowRole(db, actor, showId, 'viewer')
  } catch (err) {
    if (err instanceof AppError && err.code === 'not_found') throw notFound(missing)
    throw err
  }
}

async function loadDocument(db: Executor, actor: Actor, documentId: string) {
  if (!hasNoNul([documentId])) throw invalid('documentId must not contain NUL')
  const [document] = await db.select().from(documents).where(eq(documents.id, documentId))
  if (!document) throw notFound('Document not found')
  await requireViewer(db, actor, document.showId, 'Document not found')
  return document
}

async function loadVersion(db: Executor, actor: Actor, versionId: string) {
  if (!hasNoNul([versionId])) throw invalid('versionId must not contain NUL')
  const [version] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, versionId))
  if (!version) throw notFound('Version not found')
  await requireViewer(db, actor, version.showId, 'Version not found')
  return version
}

const firstWords = (text: string): string => {
  const words = text.trim().split(/\s+/).filter(Boolean)
  return words.slice(0, TITLE_WORDS).join(' ') + (words.length > TITLE_WORDS ? '…' : '')
}

/** `note · Fly out early please`: the type, then the first words of the text (a highlight's quote). */
function annotationTitle(row: Annotation): string {
  const source = row.type === 'highlight' ? (row.anchor.text?.quote ?? row.text) : row.text
  const words = firstWords(source)
  return words === '' ? row.type : `${row.type} · ${words}`
}

/**
 * The document's cues and annotations the actor may see, in no particular order: every department
 * layer, and the actor's own personal layer. Another member's personal annotation is excluded in the
 * query, so neither it nor its id is ever read into a result.
 */
async function candidates(db: Executor, actor: Actor, documentId: string, showId: string) {
  const depts = await db
    .select({
      id: departments.id,
      code: departments.code,
      numberFormat: departments.numberFormat,
      sortOrder: departments.sortOrder,
    })
    .from(departments)
    .where(eq(departments.showId, showId))
  const byId = new Map(depts.map((d) => [d.id, d]))

  const cueRows: Cue[] = await db
    .select()
    .from(cues)
    .where(and(eq(cues.showId, showId), sql`${cues.anchor}->>'documentId' = ${documentId}`))
  const noteRows: Annotation[] = await db
    .select()
    .from(annotations)
    .where(
      and(
        eq(annotations.showId, showId),
        sql`${annotations.anchor}->>'documentId' = ${documentId}`,
        or(
          eq(annotations.layerKind, 'department'),
          and(eq(annotations.layerKind, 'personal'), eq(annotations.layerId, actor.userId)),
        ),
      ),
    )

  const out: Candidate[] = []
  for (const cue of cueRows) {
    const dept = byId.get(cue.departmentId)
    if (!cue.anchor || !dept) continue
    const head = `${dept.code} ${formatCueNumber(cue.major, cue.minor, dept.numberFormat)}`
    out.push({
      table: 'cues',
      rowId: cue.id,
      layer: layerKey({ kind: 'department', id: cue.departmentId }),
      anchor: cue.anchor,
      title: cue.label.trim() === '' ? head : `${head} · ${cue.label.trim()}`,
    })
  }
  for (const note of noteRows) {
    out.push({
      table: 'annotations',
      rowId: note.id,
      layer: layerKey({ kind: note.layerKind, id: note.layerId }),
      anchor: note.anchor,
      title: annotationTitle(note),
    })
  }

  // Department layers in the show's order, the actor's personal layer last.
  const rank = (layer: string): number => {
    const dept = byId.get(layer.slice('department:'.length))
    if (!layer.startsWith('department:') || !dept) return Number.MAX_SAFE_INTEGER
    return dept.sortOrder
  }
  const code = (layer: string): string => byId.get(layer.slice('department:'.length))?.code ?? ''
  return out.sort(
    (a, b) =>
      rank(a.layer) - rank(b.layer) ||
      code(a.layer).localeCompare(code(b.layer)) ||
      a.layer.localeCompare(b.layer) ||
      compareReadingOrder(a.anchor, b.anchor) ||
      a.rowId.localeCompare(b.rowId),
  )
}

const keyOf = (table: Table, rowId: string) => `${table}\u0000${rowId}`

/**
 * For each row, the anchor in the `before` of its most recent change-log row written by a
 * re-anchoring run (`reanchorRowCondition`: the same rule revert uses). A person's later edits are
 * not runs, so they never change it. Only log rows on a layer the actor may see are read.
 */
async function previousAnchors(
  db: Executor,
  actor: Actor,
  showId: string,
  rows: Array<{ table: Table; rowId: string }>,
): Promise<Map<string, Anchor>> {
  const out = new Map<string, Anchor>()
  if (rows.length === 0) return out
  const logs = await db
    .select({
      table: changeLog.tableName,
      rowId: changeLog.rowId,
      layer: changeLog.layer,
      before: changeLog.before,
    })
    .from(changeLog)
    .where(
      and(
        eq(changeLog.showId, showId),
        inArray(changeLog.tableName, [...TABLES]),
        inArray(
          changeLog.rowId,
          rows.map((r) => r.rowId),
        ),
        eq(changeLog.op, 'update'),
        reanchorRowCondition(),
        visibleTo(actor),
      ),
    )
    .orderBy(desc(changeLog.seq))
  for (const log of logs) {
    const key = keyOf(log.table as Table, log.rowId)
    const before = log.before?.anchor as Anchor | null | undefined
    if (out.has(key) || !isLayerVisibleTo(log.layer, actor.userId)) continue
    if (before && typeof before === 'object') out.set(key, before)
  }
  return out
}

/**
 * Any member. What a revision left to review (spec 5.4): `pending` is every cue and annotation whose
 * anchor is on the document's current version and not `ok`, `olderVersions` every one still on
 * another version (for example a cue an offline client placed after the switch). Both are grouped by
 * layer (departments in the show's order, the caller's personal layer last) then reading order, and
 * hold no other member's personal annotation. `previous` is the anchor before the most recent
 * re-anchoring run moved the row, or null. A document with no current version has nothing to review
 * and is `invalid`.
 */
export async function listReanchorReview(
  db: Executor,
  actor: Actor,
  input: { documentId: string },
): Promise<{ currentVersionId: string; pending: ReviewItem[]; olderVersions: ReviewItem[] }> {
  const document = await loadDocument(db, actor, input.documentId)
  const current = document.currentVersionId
  if (!current) throw invalid('this document has no current version yet')

  const rows = await candidates(db, actor, document.id, document.showId)
  const previous = await previousAnchors(db, actor, document.showId, rows)
  const item = (c: Candidate): ReviewItem => ({
    table: c.table,
    rowId: c.rowId,
    layer: c.layer,
    title: c.title,
    anchor: c.anchor,
    previous: previous.get(keyOf(c.table, c.rowId)) ?? null,
  })
  return {
    currentVersionId: current,
    pending: rows
      .filter((c) => c.anchor.documentVersionId === current && c.anchor.status !== 'ok')
      .map(item),
    olderVersions: rows.filter((c) => c.anchor.documentVersionId !== current).map(item),
  }
}

/** The row as the actor may know it: a member of its show and, for a personal layer, its owner. */
async function loadRow(
  db: Executor,
  actor: Actor,
  table: Table,
  rowId: string,
): Promise<{ showId: string; layer: LayerRef; anchor: Anchor | null }> {
  if (table === 'cues') {
    const cue = await loadCueRow(db, rowId)
    if (!cue) throw notFound('Cue not found')
    await requireViewer(db, actor, cue.showId, 'Cue not found')
    return {
      showId: cue.showId,
      layer: { kind: 'department', id: cue.departmentId },
      anchor: cue.anchor,
    }
  }
  const note = await loadAnnotationRow(db, rowId)
  if (!note) throw notFound('Annotation not found')
  await requireViewer(db, actor, note.showId, 'Annotation not found')
  if (note.layerKind === 'personal' && note.layerId !== actor.userId) {
    throw notFound('Annotation not found')
  }
  return {
    showId: note.showId,
    layer: { kind: note.layerKind, id: note.layerId },
    anchor: note.anchor,
  }
}

/** The row's anchor, locked `FOR UPDATE` until the transaction ends. */
async function lockAnchor(tx: Executor, table: Table, rowId: string): Promise<Anchor | null> {
  const target = table === 'cues' ? cues : annotations
  const [row] = await tx
    .select({ anchor: target.anchor })
    .from(target)
    .where(eq(target.id, rowId))
    .for('update')
  if (!row) throw notFound(table === 'cues' ? 'Cue not found' : 'Annotation not found')
  return row.anchor as Anchor | null
}

/**
 * Editor on the row's layer (a personal annotation: its owner). Resolves one review item and returns
 * the row's anchor afterwards. The write goes through `updateCue` or `updateAnnotation`, so layer
 * rights, the archived-show rule and a change-log row for the actor apply.
 *
 * - `accept` sets the status to `ok` where the anchor is (an unbound highlight stays unbound).
 * - `revert` restores `previous`, the anchor before the latest re-anchoring run moved the row, which
 *   leaves it on that older version; `invalid` when no run ever moved it.
 * - `reanchor` runs the matcher from the row's version to the document's current version. A row
 *   already on the current version is a no-op that returns its anchor and writes nothing.
 *
 * `documentId`, when given (the REST route), must be the document the row is anchored to, else the
 * item is `not_found`.
 */
export async function resolveReanchorItem(
  db: Executor,
  blobs: BlobStore,
  actor: Actor,
  input: { table: Table; rowId: string; action: ReanchorAction; documentId?: string },
): Promise<Anchor> {
  if (!TABLES.includes(input.table)) throw invalid('table must be cues or annotations')
  if (!ACTIONS.includes(input.action)) throw invalid('action must be accept, revert or reanchor')
  if (!hasNoNul([input.rowId, input.documentId])) throw invalid('ids must not contain NUL')

  const row = await loadRow(db, actor, input.table, input.rowId)
  if (!row.anchor) throw invalid('this cue is not placed, so it has no anchor to resolve')
  if (input.documentId !== undefined && row.anchor.documentId !== input.documentId) {
    throw notFound(input.table === 'cues' ? 'Cue not found' : 'Annotation not found')
  }
  // Rights first, so a viewer is `forbidden` whatever the action would have found.
  await requireLayerEdit(db, actor, row.showId, row.layer)

  // Word layers are read before the transaction opens, so it does not hold the row over blob reads.
  const start = row.anchor
  let currentVersionId: string | null = null
  let fromText: VersionText | null = null
  let toText: VersionText | null = null
  if (input.action === 'reanchor') {
    const [document] = await db.select().from(documents).where(eq(documents.id, start.documentId))
    currentVersionId = document?.currentVersionId ?? null
    if (!currentVersionId) throw invalid('this document has no current version')
    if (start.documentVersionId !== currentVersionId) {
      fromText = await loadVersionText(db, blobs, start.documentVersionId)
      toText = await loadVersionText(db, blobs, currentVersionId)
    }
  }

  return db.transaction(async (tx) => {
    const locked = await lockAnchor(tx, input.table, input.rowId)
    if (!locked) throw invalid('this cue is not placed, so it has no anchor to resolve')

    let next: Anchor
    if (input.action === 'accept') {
      next = { ...locked, status: 'ok' }
    } else if (input.action === 'revert') {
      const previous = (
        await previousAnchors(tx, actor, row.showId, [{ table: input.table, rowId: input.rowId }])
      ).get(keyOf(input.table, input.rowId))
      if (!previous) {
        throw invalid('nothing to revert to: no re-anchoring run moved this item')
      }
      next = previous
    } else {
      if (!fromText || !toText) return locked
      // The text was read for the anchor and the current version seen before the lock: if either has
      // moved since, the result would be computed from stale input.
      const [document] = await tx
        .select({ currentVersionId: documents.currentVersionId })
        .from(documents)
        .where(eq(documents.id, locked.documentId))
      if (!columnEqual(locked, start) || document?.currentVersionId !== currentVersionId) {
        throw conflict('this item changed while it was being re-anchored; try again')
      }
      next = reanchor(locked, fromText, toText)
    }
    if (columnEqual(locked, next)) return locked

    if (input.table === 'cues') {
      const updated = await updateCue(tx, actor, { cueId: input.rowId, patch: { anchor: next } })
      return updated.anchor as Anchor
    }
    const updated = await updateAnnotation(tx, actor, {
      annotationId: input.rowId,
      patch: { anchor: next },
    })
    return updated.anchor
  })
}

/**
 * Any member. Every cue and annotation of the version's document, with the anchor it had on
 * `versionId`: its current anchor when that points at the version, else the newest anchor in its
 * change log (the `after` of a write, or the `before` of the next one) that did. A row that was never
 * on the version is left out, and so is another member's personal annotation along with its history.
 * Grouped by layer then reading order.
 */
export async function listVersionAnchors(
  db: Executor,
  actor: Actor,
  input: { versionId: string },
): Promise<Array<{ table: Table; rowId: string; layer: string; anchor: Anchor }>> {
  const version = await loadVersion(db, actor, input.versionId)
  const rows = await candidates(db, actor, version.documentId, version.showId)

  const found = new Map<string, Anchor>()
  const needHistory: Candidate[] = []
  for (const row of rows) {
    if (row.anchor.documentVersionId === version.id)
      found.set(keyOf(row.table, row.rowId), row.anchor)
    else needHistory.push(row)
  }

  if (needHistory.length > 0) {
    const onVersion = (column: typeof changeLog.before | typeof changeLog.after): SQL =>
      sql`${column}->'anchor'->>'documentVersionId' = ${version.id}`
    const logs = await db
      .select({
        table: changeLog.tableName,
        rowId: changeLog.rowId,
        layer: changeLog.layer,
        before: changeLog.before,
        after: changeLog.after,
      })
      .from(changeLog)
      .where(
        and(
          eq(changeLog.showId, version.showId),
          inArray(changeLog.tableName, [...TABLES]),
          inArray(
            changeLog.rowId,
            needHistory.map((r) => r.rowId),
          ),
          visibleTo(actor),
          or(onVersion(changeLog.before), onVersion(changeLog.after)),
        ),
      )
      .orderBy(desc(changeLog.seq))
    const wanted = new Set(needHistory.map((r) => keyOf(r.table, r.rowId)))
    for (const log of logs) {
      const key = keyOf(log.table as Table, log.rowId)
      if (!wanted.has(key) || found.has(key) || !isLayerVisibleTo(log.layer, actor.userId)) continue
      // Within one row, the `after` is newer than its `before`.
      for (const side of [log.after, log.before]) {
        const anchor = side?.anchor as Anchor | null | undefined
        if (anchor && anchor.documentVersionId === version.id) {
          found.set(key, anchor)
          break
        }
      }
    }
  }

  return rows.flatMap((r) => {
    const anchor = found.get(keyOf(r.table, r.rowId))
    return anchor ? [{ table: r.table, rowId: r.rowId, layer: r.layer, anchor }] : []
  })
}

/**
 * Any member. A line diff of two versions of one document (`invalid` for versions of different
 * documents) in stream order. `entries` holds the first `limit` lines of the diff (default 2000, at
 * most 10000; `same` lines count), `added` and `removed` count the whole diff, and `truncated` says
 * whether the entries were cut. `documentId`, when given (the REST route), must be the versions'
 * document, else `not_found`.
 */
export async function compareDocumentVersions(
  db: Executor,
  blobs: BlobStore,
  actor: Actor,
  input: { fromVersionId: string; toVersionId: string; limit?: number; documentId?: string },
): Promise<{ entries: LineDiffEntry[]; added: number; removed: number; truncated: boolean }> {
  const limit = input.limit ?? COMPARE_DEFAULT_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1) throw invalid('limit must be a positive integer')
  // Both versions are looked up as the actor before they are compared, so whether a version exists in
  // a show the caller is not in is never revealed by the answer.
  const from = await loadVersion(db, actor, input.fromVersionId)
  const to = await loadVersion(db, actor, input.toVersionId)
  if (from.documentId !== to.documentId) throw invalid('the versions belong to different documents')
  if (input.documentId !== undefined && input.documentId !== from.documentId) {
    throw notFound('Version not found')
  }

  const [fromText, toText] = await Promise.all([
    loadVersionText(db, blobs, from.id),
    loadVersionText(db, blobs, to.id),
  ])
  const { entries, added, removed } = diffVersionLines(fromText, toText)
  const cap = Math.min(limit, COMPARE_MAX_LIMIT)
  return { entries: entries.slice(0, cap), added, removed, truncated: entries.length > cap }
}
