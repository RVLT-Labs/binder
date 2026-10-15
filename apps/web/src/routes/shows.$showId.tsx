import { useQuery } from '@powersync/react'
import { createFileRoute, Outlet, useMatches } from '@tanstack/react-router'
import type { ShowRow } from '../powersync/schema'
import { PresenceProvider } from '../presence/PresenceProvider'
import { AppShell } from '../shell/AppShell'
import { useAccount } from '../shell/useAccount'
import { useShowCrumbs } from '../shell/useShowCrumbs'

export const Route = createFileRoute('/shows/$showId')({ component: ShowLayout })

/**
 * The shell around everything inside a show: its rail and tabs, crumbs and notices, and the one
 * presence connection that serves the show's screens and its documents alike. The screens
 * themselves are the child routes; the show's own page is the index.
 */
function ShowLayout() {
  const { showId } = Route.useParams()
  const account = useAccount()
  const { data, isLoading } = useQuery<ShowRow>('SELECT * FROM shows WHERE id = ?', [showId])
  const show = data[0]
  const crumbs = useShowCrumbs(showId, show?.title ?? undefined)
  // The document lays out and scrolls its own panels, so it gets the content area to itself.
  const fullBleed = useMatches({
    select: (matches) => matches.at(-1)?.routeId === '/shows/$showId/docs/$docId',
  })

  return (
    <PresenceProvider showId={showId}>
      <AppShell showId={showId} crumbs={crumbs} account={account} fullBleed={fullBleed}>
        {isLoading ? <p>Loading…</p> : !show ? <p>Show not found.</p> : <Outlet />}
      </AppShell>
    </PresenceProvider>
  )
}
