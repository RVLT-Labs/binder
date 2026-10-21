import { useQuery } from '@powersync/react'
import { useMemo } from 'react'
import { useSessionUser } from '../auth/session'

/**
 * The ids of the shows the signed-in user owns, from the local membership rows. Empty until the
 * memberships have synced, so an owner-only control stays off rather than flashing on.
 */
export function useOwnedShowIds(): ReadonlySet<string> {
  const { data: user } = useSessionUser()
  const userId = user?.id ?? ''
  const { data } = useQuery<{ show_id: string }>(
    "SELECT show_id FROM show_memberships WHERE user_id = ? AND role = 'owner'",
    [userId],
  )
  return useMemo(() => new Set(data.map((row) => row.show_id)), [data])
}
