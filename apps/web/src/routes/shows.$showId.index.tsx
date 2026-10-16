import { createFileRoute } from '@tanstack/react-router'
import { ShowOverview } from '../overview/ShowOverview'

export const Route = createFileRoute('/shows/$showId/')({ component: ShowPage })

/** The show's page: its overview. The show route's shell is its layout; this is its index. */
function ShowPage() {
  const { showId } = Route.useParams()
  return <ShowOverview showId={showId} />
}
