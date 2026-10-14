import { createFileRoute, Link } from '@tanstack/react-router'
import { ActivityFeed } from '../history/ActivityFeed'

export const Route = createFileRoute('/shows/$showId/activity')({ component: ActivityPage })

function ActivityPage() {
  const { showId } = Route.useParams()
  return (
    <>
      <p>
        <Link to="/shows/$showId" params={{ showId }}>
          ← Show
        </Link>
      </p>
      <ActivityFeed showId={showId} />
    </>
  )
}
