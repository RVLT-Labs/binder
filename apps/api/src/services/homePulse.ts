import { cardSentence } from '@binder/core'
import { changeLog, type Db, departments, showMemberships } from '@binder/db'
import { type Actor, presenceColour, type ShowLastChange, type ShowPresence } from '@binder/shared'
import { inArray, sql } from 'drizzle-orm'
import type { PresenceHub } from '../presence/hub'
import {
  type DepartmentCodes,
  fetchRows,
  type LogRow,
  summaryRowsOf,
  toActivityGroup,
  visibleTo,
} from './history'
import { listShows } from './tenancy'

/** A batch is read up to this many rows; a longer one counts "at least" and reads for its newest. */
const RUN_CAP = 500

interface Newest {
  showId: string
  seq: number
  batchId: string | null
  userId: string
}

/**
 * The newest row the actor may see in each of the given shows, in one query: for every id a
 * `LIMIT 1` over `change_log_show_seq_idx` read backwards, so the cost does not depend on log size.
 */
async function newestPerShow(db: Db, actor: Actor, showIds: string[]): Promise<Newest[]> {
  const ids = sql.join(
    showIds.map((id) => sql`${id}`),
    sql`, `,
  )
  const result = await db.execute<{
    show_id: string
    seq: string | number
    batch_id: string | null
    user_id: string
  }>(sql`
    SELECT s.id AS show_id, l.seq, l.batch_id, l.user_id
    FROM unnest(ARRAY[${ids}]::text[]) AS s(id)
    CROSS JOIN LATERAL (
      SELECT ${changeLog.seq} AS seq, ${changeLog.batchId} AS batch_id, ${changeLog.userId} AS user_id
      FROM ${changeLog}
      WHERE ${changeLog.showId} = s.id AND ${visibleTo(actor)}
      ORDER BY ${changeLog.seq} DESC
      LIMIT 1
    ) AS l`)
  return result.rows.map((r) => ({
    showId: r.show_id,
    seq: Number(r.seq),
    batchId: r.batch_id,
    userId: r.user_id,
  }))
}

/**
 * Any member. For each of the caller's non-archived shows (inside the token's show scope, as
 * `listShows`), the newest visible change as one batch: who, the card sentence and when. A show with
 * nothing visible in its log maps to null. Another member's personal-layer rows are never visible,
 * so never the last change.
 *
 * Step 1 takes the newest visible row per show in one query. Step 2 loads that row's run (same show,
 * batch and user, the same privacy filter, capped at 500; a row without a batch id stands alone),
 * one query per show in parallel. Step 3 words it with `toActivityGroup`, the helper the activity
 * feed uses, so the wording is the feed's.
 *
 * Divergence to accept: the feed groups only consecutive rows, this groups by batch id, so a batch
 * interleaved with a concurrent one can differ from the feed by a row.
 */
export async function latestChangePerShow(
  db: Db,
  actor: Actor,
): Promise<Record<string, ShowLastChange | null>> {
  const { active } = await listShows(db, actor)
  const showIds = active.map((s) => s.id)
  const out: Record<string, ShowLastChange | null> = {}
  if (showIds.length === 0) return out
  for (const id of showIds) out[id] = null

  const newest = await newestPerShow(db, actor, showIds)
  const codes: DepartmentCodes = new Map(
    (
      await db
        .select({ id: departments.id, code: departments.code })
        .from(departments)
        .where(inArray(departments.showId, showIds))
    ).map((d) => [d.id, d.code]),
  )
  const runs = await Promise.all(
    newest.map(async (n): Promise<{ showId: string; run: LogRow[] }> => {
      const filter =
        n.batchId === null
          ? { showId: n.showId, seq: n.seq }
          : { showId: n.showId, batchId: n.batchId, userId: n.userId }
      return { showId: n.showId, run: await fetchRows(db, actor, filter, RUN_CAP) }
    }),
  )
  for (const { showId, run } of runs) {
    if (run.length === 0) continue
    const g = toActivityGroup(run, codes)
    out[showId] = {
      at: g.at,
      userId: g.userId,
      label: g.label,
      summary: g.summary,
      sentence: cardSentence(summaryRowsOf(run, codes)),
      count: g.count,
      via: g.via,
      agent: g.agent,
      batchId: g.batchId,
    }
  }
  return out
}

/**
 * Any member. Who is in each of the caller's non-archived shows right now (inside the token's show
 * scope, as `listShows`): only shows with at least one person appear, each person once however many
 * tabs they hold, the caller's own other devices included. Per person: id, display name, their
 * stable colour, and their department scope as codes (`[]` for every department). No email, no
 * document or page.
 *
 * The hub is in this process's memory, so this is exact for the single API container of spec 3.7 and
 * would split across several, the same limit as presence inside a show.
 */
export async function presenceSummary(
  db: Db,
  hub: PresenceHub,
  actor: Actor,
): Promise<{ shows: Record<string, ShowPresence> }> {
  const { active } = await listShows(db, actor)
  const occupied = new Map<string, { userId: string; name: string }[]>()
  for (const { id } of active) {
    const people = hub.occupants(id)
    if (people.length > 0) occupied.set(id, people)
  }
  const out: Record<string, ShowPresence> = {}
  if (occupied.size === 0) return { shows: out }
  const showIds = [...occupied.keys()]

  const codes = new Map(
    (
      await db
        .select({ id: departments.id, code: departments.code })
        .from(departments)
        .where(inArray(departments.showId, showIds))
    ).map((d) => [d.id, d.code]),
  )
  const scopes = new Map<string, string[]>()
  const members = await db
    .select({
      showId: showMemberships.showId,
      userId: showMemberships.userId,
      departments: showMemberships.departments,
    })
    .from(showMemberships)
    .where(inArray(showMemberships.showId, showIds))
  for (const m of members) {
    const all = m.departments.includes('*')
    scopes.set(
      `${m.showId}:${m.userId}`,
      all ? [] : m.departments.flatMap((id) => codes.get(id) ?? []),
    )
  }
  for (const [showId, people] of occupied) {
    out[showId] = {
      people: people.map((p) => ({
        userId: p.userId,
        name: p.name,
        colour: presenceColour(p.userId),
        departments: scopes.get(`${showId}:${p.userId}`) ?? [],
      })),
    }
  }
  return { shows: out }
}
