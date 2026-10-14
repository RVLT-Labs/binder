import type { MembershipScope, Role } from '@binder/shared'
import { useQuery } from '@powersync/react'
import { useSessionUser } from '../auth/session'
import type { Database } from '../powersync/schema'

const ROLES: readonly string[] = ['owner', 'editor', 'viewer']

/**
 * The scope stored in a local `show_memberships` row. `departments` is JSON text in SQLite; an
 * unreadable value scopes the member to nothing rather than to everything.
 */
export function parseMembership(
  row: Pick<Database['show_memberships'], 'role' | 'departments'>,
): MembershipScope | null {
  if (!row.role || !ROLES.includes(row.role)) return null
  let departments: string[] = []
  try {
    const parsed: unknown = JSON.parse(row.departments ?? '[]')
    if (Array.isArray(parsed) && parsed.every((d) => typeof d === 'string')) departments = parsed
  } catch {
    // keep the empty scope
  }
  return { role: row.role as Role, departments }
}

/** The signed-in user's role and department scope on a show, or null until it has synced. */
export function useMembership(showId: string): (MembershipScope & { userId: string }) | null {
  const { data: user } = useSessionUser()
  const userId = user?.id ?? ''
  const { data } = useQuery<Database['show_memberships']>(
    'SELECT * FROM show_memberships WHERE show_id = ? AND user_id = ?',
    [showId, userId],
  )
  const row = data[0]
  const scope = row ? parseMembership(row) : null
  return scope && userId ? { ...scope, userId } : null
}
