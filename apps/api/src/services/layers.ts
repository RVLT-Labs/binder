import { departments, shows } from '@binder/db'
import { type Actor, canEditLayer, type LayerRef, type MembershipScope } from '@binder/shared'
import { and, eq } from 'drizzle-orm'
import { forbidden, invalid, notFound } from '../errors'
import type { Executor } from './executor'
import { assertShowWritable, getShowMembership, requireShowRole } from './tenancy'

/**
 * Internal (not in the services barrel, so not an MCP operation): the caller's role and department
 * scope on a show. Runs `requireShowRole` first, so token scope and existence-hiding apply.
 */
export async function getMembershipScope(
  db: Executor,
  actor: Actor,
  showId: string,
): Promise<MembershipScope> {
  const role = await requireShowRole(db, actor, showId, 'viewer')
  const membership = await getShowMembership(db, actor.userId, showId)
  return { role, departments: membership?.departments ?? [] }
}

/**
 * Internal guard for every markup write (cues, annotations, reverts): the layer permission matrix
 * of spec 4.1 and 4.11 plus the archived-show rule. Another user's personal layer is `not_found`
 * (it does not exist as far as the caller can tell); a department that is not in this show is `invalid`.
 */
export async function requireLayerEdit(
  db: Executor,
  actor: Actor,
  showId: string,
  layer: LayerRef,
): Promise<void> {
  const scope = await getMembershipScope(db, actor, showId)
  const [show] = await db.select().from(shows).where(eq(shows.id, showId))
  if (!show) throw notFound('Show not found')
  assertShowWritable(show)

  if (layer.kind === 'department') {
    const [dept] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.id, layer.id), eq(departments.showId, showId)))
    if (!dept) throw invalid('department is not in this show')
  } else if (layer.id !== actor.userId) {
    throw notFound('Layer not found')
  }
  if (!canEditLayer(scope, actor.userId, layer)) {
    throw forbidden('you cannot edit this layer')
  }
}
