import { useQuery } from '@powersync/react'
import { createFileRoute, Link } from '@tanstack/react-router'
import type { ShowRow } from '../powersync/schema'

export const Route = createFileRoute('/shows/$showId')({ component: ShowPage })

/** Stub: the document viewer arrives in a later task. */
function ShowPage() {
  const { showId } = Route.useParams()
  const { data, isLoading } = useQuery<ShowRow>('SELECT * FROM shows WHERE id = ?', [showId])
  const show = data[0]
  if (isLoading) return <p>Loading…</p>
  if (!show) return <p>Show not found.</p>
  return (
    <>
      <p>
        <Link to="/">← Shows</Link>
      </p>
      <h1>{show.title}</h1>
      <p>Documents arrive in a later milestone.</p>
    </>
  )
}
