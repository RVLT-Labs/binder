import { actorLabel, type SummaryRow, summariseBatch } from '@binder/core'
import { changeLog, departments, user } from '@binder/db'
import {
  type ActivityGroup,
  type Actor,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  type HistoryEntry,
  parseLayerKey,
  redactPersonalLayer,
} from '@binder/shared'
import { and, desc, eq, gte, isNotNull, isNull, lt, type SQL, sql } from 'drizzle-orm'
import { invalid } from '../errors'
import { hasNoNul } from '../validation'
import type { Executor } from './executor'
import { requireShowRole } from './tenancy'

export type { ActivityGroup, HistoryEntry } from '@binder/shared'

type Kind = 'human' | 'agent' | 'all'

interface RowFilter {
  showId: string
  rowId?: string
  table?: string
  layer?: string
  userId?: string
  kind?: Kind
  from?: Date
  to?: Date
  before?: number
}

const KINDS: readonly Kind[] = ['human', 'agent', 'all']
const CHUNK = 500

function checkDate(name: string, d: Date | undefined): void {
  if (d !== undefined && (!(d instanceof Date) || Number.isNaN(d.getTime()))) {
    throw invalid(`${name} must be a valid date`)
  }
}

function checkFilter(f: RowFilter): void {
  if (!hasNoNul([f.showId, f.rowId, f.table, f.layer, f.userId])) {
    throw invalid('filters must not contain NUL')
  }
  if (f.layer !== undefined && !parseLayerKey(f.layer)) {
    throw invalid('layer must be department:<id> or personal:<userId>')
  }
  if (f.kind !== undefined && !KINDS.includes(f.kind))
    throw invalid('kind must be human, agent or all')
  checkDate('from', f.from)
  checkDate('to', f.to)
  if (f.before !== undefined && !(Number.isSafeInteger(f.before) && f.before > 0)) {
    throw invalid('before must be a positive integer')
  }
}

function pageSize(limit: number | undefined): number {
  if (limit === undefined) return HISTORY_DEFAULT_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1) throw invalid('limit must be a positive integer')
  return Math.min(limit, HISTORY_MAX_LIMIT)
}

/**
 * The privacy filter every history query carries (spec 4.11): rows on a personal layer belong to its
 * owner alone.
 */
const visibleTo = (actor: Actor): SQL =>
  sql`(${changeLog.layer} IS NULL OR ${changeLog.layer} NOT LIKE 'personal:%' OR ${changeLog.layer} = ${`personal:${actor.userId}`})`

function conditions(actor: Actor, f: RowFilter): SQL[] {
  const where: SQL[] = [eq(changeLog.showId, f.showId), visibleTo(actor)]
  if (f.rowId !== undefined) where.push(eq(changeLog.rowId, f.rowId))
  if (f.table !== undefined) where.push(eq(changeLog.tableName, f.table))
  if (f.userId !== undefined) where.push(eq(changeLog.userId, f.userId))
  if (f.kind === 'agent') where.push(isNotNull(changeLog.agent))
  if (f.kind === 'human') where.push(isNull(changeLog.agent))
  if (f.from) where.push(gte(changeLog.serverTs, f.from))
  // Dates carry milliseconds, Postgres microseconds: `to` is inclusive of its whole millisecond.
  if (f.to) where.push(lt(changeLog.serverTs, new Date(f.to.getTime() + 1)))
  if (f.before !== undefined) where.push(lt(changeLog.seq, f.before))
  if (f.layer !== undefined) {
    const ref = parseLayerKey(f.layer)
    // A department move is logged once, on the destination layer (M1-R3): the source department's
    // history still shows the cue leaving, by matching the department the cue was in before.
    const leaving =
      ref?.kind === 'department'
        ? sql`(${changeLog.tableName} = 'cues' AND ${changeLog.before}->>'departmentId' = ${ref.id})`
        : sql`false`
    where.push(sql`(${changeLog.layer} = ${f.layer} OR ${leaving})`)
  }
  return where
}

async function fetchRows(db: Executor, actor: Actor, f: RowFilter, limit: number) {
  return db
    .select({
      seq: changeLog.seq,
      showId: changeLog.showId,
      serverTs: changeLog.serverTs,
      clientTs: changeLog.clientTs,
      userId: changeLog.userId,
      userName: user.name,
      via: changeLog.via,
      agent: changeLog.agent,
      batchId: changeLog.batchId,
      tableName: changeLog.tableName,
      rowId: changeLog.rowId,
      op: changeLog.op,
      before: changeLog.before,
      after: changeLog.after,
      layer: changeLog.layer,
    })
    .from(changeLog)
    .leftJoin(user, eq(user.id, changeLog.userId))
    .where(and(...conditions(actor, f)))
    .orderBy(desc(changeLog.seq))
    .limit(limit)
}

type LogRow = Awaited<ReturnType<typeof fetchRows>>[number]

const UNKNOWN_USER = 'Unknown user'

/**
 * Viewer and above. Change log rows, newest first, narrowed by row, table, layer, user, kind
 * (`agent` means an agent wrote it) and an inclusive `server_ts` window. `limit` defaults to 50 and
 * is capped at 200; page back with `before` set to the previous `nextBefore`. Another user's
 * personal layer never appears, and a former personal layer id in a move is redacted (see shared
 * `redactPersonalLayer`).
 */
export async function listHistory(
  db: Executor,
  actor: Actor,
  input: {
    showId: string
    rowId?: string
    table?: string
    layer?: string
    userId?: string
    kind?: Kind
    from?: Date
    to?: Date
    before?: number
    limit?: number
  },
): Promise<{ entries: HistoryEntry[]; nextBefore: number | null }> {
  checkFilter(input)
  const limit = pageSize(input.limit)
  await requireShowRole(db, actor, input.showId, 'viewer')
  const rows = await fetchRows(db, actor, input, limit + 1)
  const page = rows.slice(0, limit)
  return {
    entries: page.map((r) => ({
      seq: r.seq,
      serverTs: r.serverTs.toISOString(),
      clientTs: r.clientTs ? r.clientTs.toISOString() : null,
      userId: r.userId,
      userName: r.userName ?? UNKNOWN_USER,
      via: r.via,
      agent: r.agent,
      batchId: r.batchId,
      table: r.tableName,
      rowId: r.rowId,
      op: r.op,
      before: redactPersonalLayer(r.before, actor.userId),
      after: redactPersonalLayer(r.after, actor.userId),
      layer: r.layer,
    })),
    nextBefore: rows.length > limit ? (page[page.length - 1]?.seq ?? null) : null,
  }
}

const extendsRun = (run: LogRow[], row: LogRow): boolean =>
  row.batchId !== null && run[0].batchId === row.batchId && run[0].userId === row.userId

/**
 * Viewer and above. The feed groups maximal runs of consecutive rows sharing a batch id and user
 * (rows without a batch id stand alone), newest first, each with a sentence ("moved 3 TM cues and
 * relabelled 1"). `limit` counts groups; a group is never split across pages. The same privacy
 * filter, layer match and `kind`, `from`, `to` bounds as `listHistory` apply.
 */
export async function activityFeed(
  db: Executor,
  actor: Actor,
  input: {
    showId: string
    layer?: string
    kind?: Kind
    from?: Date
    to?: Date
    before?: number
    limit?: number
  },
): Promise<{ groups: ActivityGroup[]; nextBefore: number | null }> {
  checkFilter(input)
  const limit = pageSize(input.limit)
  await requireShowRole(db, actor, input.showId, 'viewer')

  const runs: LogRow[][] = []
  let more = false
  let cursor = input.before
  scan: for (;;) {
    const rows = await fetchRows(db, actor, { ...input, before: cursor }, CHUNK)
    for (const row of rows) {
      const run = runs[runs.length - 1]
      if (run && extendsRun(run, row)) {
        run.push(row)
        continue
      }
      if (runs.length === limit) {
        more = true
        break scan
      }
      runs.push([row])
    }
    if (rows.length < CHUNK) break
    cursor = rows[rows.length - 1].seq
  }

  const codes = new Map(
    (
      await db
        .select({ id: departments.id, code: departments.code })
        .from(departments)
        .where(eq(departments.showId, input.showId))
    ).map((d) => [d.id, d.code]),
  )
  const codeOf = (layer: string | null): string | null => {
    const ref = layer ? parseLayerKey(layer) : null
    return ref?.kind === 'department' ? (codes.get(ref.id) ?? null) : null
  }

  const groups = runs.map((run): ActivityGroup => {
    const newest = run[0]
    const oldest = run[run.length - 1]
    const chronological: SummaryRow[] = [...run].reverse().map((r) => ({
      table: r.tableName,
      op: r.op,
      before: r.before,
      after: r.after,
      departmentCode: codeOf(r.layer),
    }))
    return {
      batchId: newest.batchId,
      userId: newest.userId,
      label: actorLabel(newest.userName ?? UNKNOWN_USER, newest.agent),
      summary: summariseBatch(chronological),
      at: newest.serverTs.toISOString(),
      fromSeq: oldest.seq,
      toSeq: newest.seq,
      count: run.length,
      via: newest.via,
      agent: newest.agent,
    }
  })
  return { groups, nextBefore: more ? (groups[groups.length - 1]?.fromSeq ?? null) : null }
}
