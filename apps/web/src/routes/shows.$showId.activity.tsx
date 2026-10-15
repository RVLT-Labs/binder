import { createFileRoute, Link } from '@tanstack/react-router'
import { ActivityFeed } from '../history/ActivityFeed'

interface ActivitySearch {
  /** Show only changes made at or after this time (an ISO timestamp), e.g. since an export. */
  from?: string
}

export const Route = createFileRoute('/shows/$showId/activity')({
  validateSearch: (search: Record<string, unknown>): ActivitySearch => ({
    from:
      typeof search.from === 'string' && !Number.isNaN(Date.parse(search.from))
        ? search.from
        : undefined,
  }),
  component: ActivityPage,
})

function ActivityPage() {
  const { showId } = Route.useParams()
  const { from } = Route.useSearch()
  return (
    <>
      <p>
        <Link to="/shows/$showId" params={{ showId }}>
          ← Show
        </Link>
      </p>
      <ActivityFeed showId={showId} from={from} />
    </>
  )
}
