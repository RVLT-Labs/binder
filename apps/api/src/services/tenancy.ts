import {
  type Db,
  departments,
  organisations,
  orgMemberships,
  showMemberships,
  shows,
  user,
} from '@binder/db'
import {
  type Actor,
  cueSizesSchema,
  DEFAULT_DEPARTMENTS,
  layerKey,
  newId,
  ROLE_RANK,
  type Role,
  roleAtLeast,
  type ShowStatus,
} from '@binder/shared'
import { and, asc, eq, type InferSelectModel, inArray, sql } from 'drizzle-orm'
import { conflict, forbidden, invalid, notFound } from '../errors'
import { issuesMessage, memberDepartments, noNul } from '../validation'
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

/** Internal: the user's membership row on a show, or null. */
export async function getShowMembership(
  db: Executor,
  userId: string,
  showId: string,
): Promise<ShowMembership | null> {
  const [row] = await db
    .select()
    .from(showMemberships)
    .where(and(eq(showMemberships.showId, showId), eq(showMemberships.userId, userId)))
  return row ?? null
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

/** A new show starts with the default departments, each logged as an insert on its own layer. */
async function seedDefaultDepartments(
  tx: Executor,
  actor: Actor,
  showId: string,
  batchId: string,
): Promise<void> {
  const rows = await tx
    .insert(departments)
    .values(
      DEFAULT_DEPARTMENTS.map((d, i) => ({
        id: newId(),
        showId,
        code: d.code,
        name: d.name,
        colour: d.colour,
        numberFormat: d.numberFormat,
        sortOrder: i * 10,
        updatedBy: actor.userId,
      })),
    )
    .returning()
  for (const d of rows) {
    await logChange(tx, {
      showId,
      actor,
      batchId,
      table: 'departments',
      rowId: d.id,
      op: 'insert',
      before: null,
      after: {
        code: d.code,
        name: d.name,
        colour: d.colour,
        numberFormat: d.numberFormat,
        sortOrder: d.sortOrder,
        hidden: d.hidden,
      },
      layer: layerKey({ kind: 'department', id: d.id }),
    })
  }
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
    await seedDefaultDepartments(tx, actor, show.id, batchId)
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

/** Any member. The show with the caller's role and how many members it has. */
export async function getShow(
  db: Executor,
  actor: Actor,
  input: { showId: string },
): Promise<Show & { role: Role; memberCount: number }> {
  const role = await requireShowRole(db, actor, input.showId, 'viewer')
  const [show] = await db.select().from(shows).where(eq(shows.id, input.showId))
  if (!show) throw notFound('Show not found')
  const [{ memberCount }] = await db
    .select({ memberCount: sql<number>`count(*)::int` })
    .from(showMemberships)
    .where(eq(showMemberships.showId, input.showId))
  return { ...show, role, memberCount }
}

export async function updateShow(
  db: Executor,
  actor: Actor,
  input: {
    showId: string
    patch: { title?: string; status?: ShowStatus; settings?: Record<string, unknown> }
    batchId?: string
    clientTs?: Date
  },
): Promise<Show> {
  const batchId = input.batchId ?? newId()
  return db.transaction(async (tx) => {
    await requireShowRole(tx, actor, input.showId, 'owner')
    const [current] = await tx.select().from(shows).where(eq(shows.id, input.showId))
    if (!current) throw notFound('Show not found')
    assertShowWritable(current, { allowUnarchive: true, patch: input.patch })
    if (input.patch.settings !== undefined) {
      await assertCueSizes(tx, input.showId, input.patch.settings, current.settings)
    }

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
      clientTs: input.clientTs,
    })
    return updated
  })
}

/**
 * `settings.cueSizes`, when present, maps department ids to `normal` or `large` and nothing else.
 * Every entry that is new or changed must name one of this show's departments; an entry already
 * stored with the same value is kept, so a stale one never blocks an unrelated settings write.
 */
async function assertCueSizes(
  tx: Executor,
  showId: string,
  next: Record<string, unknown>,
  current: unknown,
): Promise<void> {
  if (!Object.hasOwn(next, 'cueSizes')) return
  const parsed = cueSizesSchema.safeParse(next.cueSizes)
  if (!parsed.success) throw invalid(`settings.cueSizes: ${issuesMessage(parsed.error)}`)
  const stored =
    current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>).cueSizes
      : undefined
  const before =
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {}
  const changed = Object.entries(parsed.data)
    .filter(([id, size]) => !(Object.hasOwn(before, id) && before[id] === size))
    .map(([id]) => id)
  if (changed.length === 0) return
  const own = new Set(
    (
      await tx
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.showId, showId))
    ).map((d) => d.id),
  )
  const stranger = changed.find((id) => !own.has(id))
  if (stranger !== undefined) {
    throw invalid(`settings.cueSizes: ${stranger} is not a department of this show`)
  }
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

    if (input.email.length > 254 || !noNul(input.email)) throw invalid('email is not valid')
    const scope = await resolveMemberDepartments(tx, input.showId, input.departments ?? ['*'])
    const [target] = await tx
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.email}) = ${input.email.toLowerCase()}`)
    if (!target) throw notFound('No user with that email')
    if (await getShowRole(tx, target.id, input.showId)) {
      throw conflict('User is already a member of this show')
    }
    const [membership] = await tx
      .insert(showMemberships)
      .values({
        id: newId(),
        showId: input.showId,
        userId: target.id,
        role: input.role,
        departments: scope,
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

/**
 * A member's department scope: `['*']`, or a non-empty list of this show's department ids.
 * Anything else is `invalid`, so a scope can never name a department of another show.
 */
async function resolveMemberDepartments(
  tx: Executor,
  showId: string,
  input: string[],
): Promise<string[]> {
  const parsed = memberDepartments.safeParse(input)
  if (!parsed.success) throw invalid(issuesMessage(parsed.error))
  const ids = [...new Set(parsed.data)]
  if (ids.includes('*')) {
    if (ids.length > 1) throw invalid("'*' cannot be combined with department ids")
    return ['*']
  }
  const rows = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.showId, showId), inArray(departments.id, ids)))
  const known = new Set(rows.map((r) => r.id))
  const unknown = ids.filter((id) => !known.has(id))
  if (unknown.length > 0) throw invalid(`unknown department id: ${unknown.join(', ')}`)
  return ids
}

function assertRole(role: string): asserts role is Role {
  if (!Object.hasOwn(ROLE_RANK, role)) throw invalid('role must be owner, editor or viewer')
}

/**
 * Internal (not in the barrel): a membership and its show for an owner of that show. A caller who
 * is not a member of the show gets `not_found`, so membership ids do not leak across shows.
 */
export async function loadMembershipAsOwner(
  db: Executor,
  actor: Actor,
  membershipId: string,
): Promise<{ membership: ShowMembership; show: Show }> {
  const [membership] = await db
    .select()
    .from(showMemberships)
    .where(eq(showMemberships.id, membershipId))
  if (!membership) throw notFound('Membership not found')
  await requireShowRole(db, actor, membership.showId, 'owner')
  const [show] = await db.select().from(shows).where(eq(shows.id, membership.showId))
  if (!show) throw notFound('Show not found')
  return { membership, show }
}

/** Locks the show's owner rows and refuses to remove or demote the last one. */
async function assertAnotherOwner(tx: Executor, showId: string): Promise<void> {
  const owners = await tx
    .select({ id: showMemberships.id })
    .from(showMemberships)
    .where(and(eq(showMemberships.showId, showId), eq(showMemberships.role, 'owner')))
    .for('update')
  if (owners.length <= 1) throw conflict('A show needs at least one owner')
}

/** Any member. Emails are only revealed to owners. */
export async function listShowMembers(
  db: Executor,
  actor: Actor,
  input: { showId: string },
): Promise<
  Array<{
    membershipId: string
    userId: string
    name: string
    email: string | null
    role: Role
    departments: string[]
  }>
> {
  const role = await requireShowRole(db, actor, input.showId, 'viewer')
  const rows = await db
    .select({
      membershipId: showMemberships.id,
      userId: showMemberships.userId,
      name: user.name,
      email: user.email,
      role: showMemberships.role,
      departments: showMemberships.departments,
    })
    .from(showMemberships)
    .innerJoin(user, eq(user.id, showMemberships.userId))
    .where(eq(showMemberships.showId, input.showId))
    .orderBy(asc(showMemberships.createdAt), asc(showMemberships.id))
  return rows.map((r) => ({ ...r, email: role === 'owner' ? r.email : null }))
}

export async function updateShowMember(
  db: Executor,
  actor: Actor,
  input: { membershipId: string; role?: Role; departments?: string[]; batchId?: string },
): Promise<ShowMembership> {
  const batchId = input.batchId ?? newId()
  return db.transaction(async (tx) => {
    const { membership: current, show } = await loadMembershipAsOwner(tx, actor, input.membershipId)
    assertShowWritable(show)

    const next: { role?: Role; departments?: string[] } = {}
    if (input.role !== undefined) {
      assertRole(input.role)
      next.role = input.role
    }
    if (input.departments !== undefined) {
      next.departments = await resolveMemberDepartments(tx, current.showId, input.departments)
    }
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const key of ['role', 'departments'] as const) {
      const value = next[key]
      if (value === undefined || JSON.stringify(value) === JSON.stringify(current[key])) continue
      before[key] = current[key]
      after[key] = value
    }
    if (Object.keys(after).length === 0) return current
    if (current.role === 'owner' && after.role !== undefined) {
      await assertAnotherOwner(tx, current.showId)
    }

    const [updated] = await tx
      .update(showMemberships)
      .set({ ...after, updatedBy: actor.userId })
      .where(eq(showMemberships.id, current.id))
      .returning()
    await logChange(tx, {
      showId: current.showId,
      actor,
      batchId,
      table: 'show_memberships',
      rowId: current.id,
      op: 'update',
      before,
      after,
    })
    return updated
  })
}

/** Owners only. The last owner cannot be removed. Returns the removed membership. */
export async function removeShowMember(
  db: Executor,
  actor: Actor,
  input: { membershipId: string; batchId?: string },
): Promise<ShowMembership> {
  const batchId = input.batchId ?? newId()
  return db.transaction(async (tx) => {
    const { membership, show } = await loadMembershipAsOwner(tx, actor, input.membershipId)
    assertShowWritable(show)
    if (membership.role === 'owner') await assertAnotherOwner(tx, membership.showId)
    await tx.delete(showMemberships).where(eq(showMemberships.id, membership.id))
    await logChange(tx, {
      showId: membership.showId,
      actor,
      batchId,
      table: 'show_memberships',
      rowId: membership.id,
      op: 'delete',
      before: {
        userId: membership.userId,
        role: membership.role,
        departments: membership.departments,
      },
      after: null,
    })
    return membership
  })
}
