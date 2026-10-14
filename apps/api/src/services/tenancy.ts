import { type Db, organisations, orgMemberships, showMemberships, shows, user } from '@binder/db'
import { type Actor, newId, type Role, roleAtLeast, type ShowStatus } from '@binder/shared'
import { and, eq, type InferSelectModel, sql } from 'drizzle-orm'
import { conflict, forbidden, invalid, notFound } from '../errors'
import { logChange } from './changeLog'
import type { Executor } from './executor'

export type Organisation = InferSelectModel<typeof organisations>
export type Show = InferSelectModel<typeof shows>
export type ShowMembership = InferSelectModel<typeof showMemberships>

/** New orgs and shows cannot sit inside a list scope, so only unrestricted actors may create them. */
function assertUnscopedToken(actor: Actor): void {
  if (actor.showScope && actor.showScope !== '*') {
    throw forbidden('token scope does not allow creating organisations or shows')
  }
}

export async function createOrganisation(
  db: Db,
  actor: Actor,
  input: { name: string },
): Promise<Organisation> {
  assertUnscopedToken(actor)
  return db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organisations)
      .values({ id: newId(), name: input.name })
      .returning()
    await tx
      .insert(orgMemberships)
      .values({ id: newId(), organisationId: org.id, userId: actor.userId, role: 'owner' })
    return org
  })
}

export async function listOrganisations(db: Db, actor: Actor): Promise<Organisation[]> {
  const rows = await db
    .select({ org: organisations })
    .from(orgMemberships)
    .innerJoin(organisations, eq(organisations.id, orgMemberships.organisationId))
    .where(eq(orgMemberships.userId, actor.userId))
    .orderBy(organisations.createdAt)
  return rows.map((r) => r.org)
}

export async function getShowRole(
  db: Executor,
  userId: string,
  showId: string,
): Promise<Role | null> {
  const [row] = await db
    .select({ role: showMemberships.role })
    .from(showMemberships)
    .where(and(eq(showMemberships.showId, showId), eq(showMemberships.userId, userId)))
  return row?.role ?? null
}

/** notFound when the user has no membership (do not reveal the show exists), forbidden when below `min`. */
export async function requireShowRole(
  db: Executor,
  actor: Actor,
  showId: string,
  min: Role,
): Promise<Role> {
  if (actor.showScope && actor.showScope !== '*' && !actor.showScope.includes(showId)) {
    throw forbidden('token scope does not include this show')
  }
  const role = await getShowRole(db, actor.userId, showId)
  if (!role) throw notFound('Show not found')
  if (!roleAtLeast(role, min)) throw forbidden()
  return role
}

/**
 * Archived shows are read-only for everyone (spec 4.1). The single exception is an owner
 * unarchiving: `allowUnarchive` with a patch that changes only `status` to something other than archived.
 */
export function assertShowWritable(
  show: { status: ShowStatus },
  opts: { allowUnarchive?: boolean; patch?: { status?: ShowStatus } } = {},
): void {
  if (show.status !== 'archived') return
  const keys = Object.entries(opts.patch ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k)
  const unarchiving =
    opts.allowUnarchive === true &&
    keys.length === 1 &&
    keys[0] === 'status' &&
    opts.patch?.status !== 'archived'
  if (!unarchiving) throw forbidden('show is archived')
}

export async function createShow(
  db: Db,
  actor: Actor,
  input: { organisationId: string; title: string; batchId?: string },
): Promise<Show> {
  assertUnscopedToken(actor)
  const batchId = input.batchId ?? newId()
  return db.transaction(async (tx) => {
    const [member] = await tx
      .select({ id: orgMemberships.id })
      .from(orgMemberships)
      .where(
        and(
          eq(orgMemberships.organisationId, input.organisationId),
          eq(orgMemberships.userId, actor.userId),
        ),
      )
    if (!member) throw notFound('Organisation not found')
    const [show] = await tx
      .insert(shows)
      .values({
        id: newId(),
        organisationId: input.organisationId,
        title: input.title,
        updatedBy: actor.userId,
      })
      .returning()
    const [ownerMembership] = await tx
      .insert(showMemberships)
      .values({
        id: newId(),
        showId: show.id,
        userId: actor.userId,
        role: 'owner',
        updatedBy: actor.userId,
      })
      .returning()
    await logChange(tx, {
      showId: show.id,
      actor,
      batchId,
      table: 'show_memberships',
      rowId: ownerMembership.id,
      op: 'insert',
      before: null,
      after: {
        userId: ownerMembership.userId,
        role: ownerMembership.role,
        departments: ownerMembership.departments,
      },
    })
    await logChange(tx, {
      showId: show.id,
      actor,
      batchId,
      table: 'shows',
      rowId: show.id,
      op: 'insert',
      before: null,
      after: { organisationId: show.organisationId, title: show.title, status: show.status },
    })
    return show
  })
}

export async function listShows(
  db: Db,
  actor: Actor,
): Promise<{ active: (Show & { role: Role })[]; archived: (Show & { role: Role })[] }> {
  const rows = await db
    .select({ show: shows, role: showMemberships.role })
    .from(showMemberships)
    .innerJoin(shows, eq(shows.id, showMemberships.showId))
    .where(eq(showMemberships.userId, actor.userId))
    .orderBy(shows.createdAt)
  const scope = actor.showScope
  const items = rows
    .filter((r) => !scope || scope === '*' || scope.includes(r.show.id))
    .map((r) => ({ ...r.show, role: r.role }))
  return {
    active: items.filter((s) => s.status !== 'archived'),
    archived: items.filter((s) => s.status === 'archived'),
  }
}

export async function updateShow(
  db: Db,
  actor: Actor,
  input: {
    showId: string
    patch: { title?: string; status?: ShowStatus; settings?: Record<string, unknown> }
    batchId?: string
  },
): Promise<Show> {
  const batchId = input.batchId ?? newId()
  return db.transaction(async (tx) => {
    await requireShowRole(tx, actor, input.showId, 'owner')
    const [current] = await tx.select().from(shows).where(eq(shows.id, input.showId))
    if (!current) throw notFound('Show not found')
    assertShowWritable(current, { allowUnarchive: true, patch: input.patch })

    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const key of ['title', 'status', 'settings'] as const) {
      const next = input.patch[key]
      if (next === undefined) continue
      if (JSON.stringify(next) === JSON.stringify(current[key])) continue
      before[key] = current[key]
      after[key] = next
    }
    if (Object.keys(after).length === 0) return current

    const [updated] = await tx
      .update(shows)
      .set({ ...after, updatedBy: actor.userId })
      .where(eq(shows.id, input.showId))
      .returning()
    await logChange(tx, {
      showId: input.showId,
      actor,
      batchId,
      table: 'shows',
      rowId: input.showId,
      op: 'update',
      before,
      after,
    })
    return updated
  })
}

export async function addShowMember(
  db: Db,
  actor: Actor,
  input: {
    showId: string
    email: string
    role: Role
    departments?: string[]
    batchId?: string
  },
): Promise<ShowMembership> {
  const batchId = input.batchId ?? newId()
  return db.transaction(async (tx) => {
    await requireShowRole(tx, actor, input.showId, 'owner')
    const [show] = await tx.select().from(shows).where(eq(shows.id, input.showId))
    if (!show) throw notFound('Show not found')
    assertShowWritable(show)

    const [target] = await tx
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.email}) = ${input.email.toLowerCase()}`)
    if (!target) throw notFound('No user with that email')
    if (await getShowRole(tx, target.id, input.showId)) {
      throw conflict('User is already a member of this show')
    }
    const departments = input.departments ?? ['*']
    if (departments.length === 0) throw invalid('departments must not be empty')

    const [membership] = await tx
      .insert(showMemberships)
      .values({
        id: newId(),
        showId: input.showId,
        userId: target.id,
        role: input.role,
        departments,
        updatedBy: actor.userId,
      })
      .returning()
    await logChange(tx, {
      showId: input.showId,
      actor,
      batchId,
      table: 'show_memberships',
      rowId: membership.id,
      op: 'insert',
      before: null,
      after: { userId: target.id, role: membership.role, departments: membership.departments },
    })
    return membership
  })
}
