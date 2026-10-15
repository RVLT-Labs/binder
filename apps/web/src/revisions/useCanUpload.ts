import { useQuery } from '@powersync/react'
import { useSessionUser } from '../auth/session'

/** Whether this user may upload to the show: an owner or editor of a show that is not archived. */
export function useCanUpload(showId: string): boolean {
  const { data: user } = useSessionUser()
  const { data: membership } = useQuery<{ role: string | null }>(
    'SELECT role FROM show_memberships WHERE show_id = ? AND user_id = ?',
    [showId, user?.id ?? ''],
  )
  const { data: shows } = useQuery<{ status: string | null }>(
    'SELECT status FROM shows WHERE id = ?',
    [showId],
  )
  const role = membership[0]?.role
  return (role === 'owner' || role === 'editor') && shows[0]?.status !== 'archived'
}
