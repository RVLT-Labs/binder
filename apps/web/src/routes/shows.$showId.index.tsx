import { useQuery } from '@powersync/react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { DocumentList } from '../documents/DocumentList'
import { useDepartments } from '../markup/useDepartments'
import { OfflineButton } from '../offline/OfflineButton'
import type { ShowRow } from '../powersync/schema'
import { BinderPresence } from '../presence/Avatars'
import { useCanUpload } from '../revisions/useCanUpload'

export const Route = createFileRoute('/shows/$showId/')({ component: ShowPage })

/** The show's documents and cue lists. The show route's shell is its layout; this is its index. */
function ShowPage() {
  const { showId } = Route.useParams()
  const { data } = useQuery<ShowRow>('SELECT * FROM shows WHERE id = ?', [showId])
  const canUpload = useCanUpload(showId)
  const departments = useDepartments(showId)
  const show = data[0]
  if (!show) return null

  return (
    <>
      <h1>{show.title}</h1>
      <OfflineButton showId={showId} />
      <BinderPresence showId={showId} />
      <p>
        <Link to="/shows/$showId/settings" params={{ showId }}>
          Settings
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
