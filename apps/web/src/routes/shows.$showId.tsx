import { useQuery } from '@powersync/react'
import { createFileRoute, Link, Outlet, useChildMatches } from '@tanstack/react-router'
import { useSessionUser } from '../auth/session'
import { DocumentList } from '../documents/DocumentList'
import { OfflineButton } from '../offline/OfflineButton'
import type { ShowRow } from '../powersync/schema'

export const Route = createFileRoute('/shows/$showId')({ component: ShowPage })

/** The show's documents. A document opened from here renders in place of the list (the Outlet). */
function ShowPage() {
  const { showId } = Route.useParams()
  const { data: user } = useSessionUser()
  const { data, isLoading } = useQuery<ShowRow>('SELECT * FROM shows WHERE id = ?', [showId])
  const { data: membership } = useQuery<{ role: string }>(
    'SELECT role FROM show_memberships WHERE show_id = ? AND user_id = ?',
    [showId, user?.id ?? ''],
  )
  const children = useChildMatches()
  const show = data[0]
  if (isLoading) return <p>Loading…</p>
  if (!show) return <p>Show not found.</p>
  if (children.length > 0) return <Outlet />

  const role = membership[0]?.role
  const canUpload = (role === 'owner' || role === 'editor') && show.status !== 'archived'
  return (
    <>
      <p>
        <Link to="/">← Shows</Link>
      </p>
      <h1>{show.title}</h1>
      <OfflineButton showId={showId} />
      <DocumentList showId={showId} canUpload={canUpload} />
    </>
  )
}
