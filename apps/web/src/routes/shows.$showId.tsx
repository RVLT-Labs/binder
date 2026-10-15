import { useQuery } from '@powersync/react'
import { createFileRoute, Link, Outlet, useChildMatches } from '@tanstack/react-router'
import { DocumentList } from '../documents/DocumentList'
import { useDepartments } from '../markup/useDepartments'
import { OfflineButton } from '../offline/OfflineButton'
import type { ShowRow } from '../powersync/schema'
import { BinderPresence } from '../presence/Avatars'
import { PresenceProvider } from '../presence/PresenceProvider'
import { useCanUpload } from '../revisions/useCanUpload'

export const Route = createFileRoute('/shows/$showId')({ component: ShowPage })

/**
 * The show's documents. A document opened from here renders in place of the list (the Outlet).
 * One presence connection serves the whole show, list and documents alike.
 */
function ShowPage() {
  const { showId } = Route.useParams()
  return (
    <PresenceProvider showId={showId}>
      <ShowBody showId={showId} />
    </PresenceProvider>
  )
}

function ShowBody({ showId }: { showId: string }) {
  const { data, isLoading } = useQuery<ShowRow>('SELECT * FROM shows WHERE id = ?', [showId])
  const canUpload = useCanUpload(showId)
  const departments = useDepartments(showId)
  const children = useChildMatches()
  const show = data[0]
  if (isLoading) return <p>Loading…</p>
  if (!show) return <p>Show not found.</p>
  if (children.length > 0) return <Outlet />

  return (
    <>
      <p>
        <Link to="/">← Shows</Link>
      </p>
      <h1>{show.title}</h1>
      <OfflineButton showId={showId} />
      <BinderPresence showId={showId} />
      <p>
        <Link to="/shows/$showId/settings" params={{ showId }}>
          Settings
        </Link>{' '}
        ·{' '}
        <Link to="/shows/$showId/activity" params={{ showId }}>
          Activity
        </Link>{' '}
        ·{' '}
        <Link to="/shows/$showId/exports" params={{ showId }}>
          Exports
        </Link>
      </p>
      <nav aria-label="Cue lists">
        <h2>Cue lists</h2>
        <ul className="cue-list-links">
          {departments
            .filter((d) => !d.hidden)
            .map((d) => (
              <li key={d.id}>
                <Link to="/shows/$showId/cues" params={{ showId }} search={{ department: d.id }}>
                  {d.code} cue list
                </Link>
              </li>
            ))}
        </ul>
      </nav>
      <DocumentList showId={showId} canUpload={canUpload} />
    </>
  )
}
