import { useQuery } from '@powersync/react'
import { createFileRoute, Outlet, useMatches } from '@tanstack/react-router'
import { UploadDocumentButton, UploadProvider } from '../documents/UploadProvider'
import type { ShowRow } from '../powersync/schema'
import { BinderAvatars } from '../presence/Avatars'
import { PresenceProvider } from '../presence/PresenceProvider'
import { AppShell } from '../shell/AppShell'
import { useRememberShow } from '../shell/lastShow'
import { useAccount } from '../shell/useAccount'
import { useBreakpoint } from '../shell/useBreakpoint'
import { useShowCrumbs } from '../shell/useShowCrumbs'

export const Route = createFileRoute('/shows/$showId')({ component: ShowLayout })

/**
 * The screens whose top bar carries the show's one red action, "Upload document". The phone's
 * overview has none (its mockup draws no button, so the long show name keeps its room); uploading
 * is on the Documents tab.
 */
const UPLOAD_SCREENS: readonly string[] = ['/shows/$showId/', '/shows/$showId/docs/']

/**
 * The shell around everything inside a show: its rail and tabs, crumbs and notices, the one
 * presence connection that serves the show's screens and its documents alike, and the show's one
 * upload dialog. The screens themselves are the child routes; the show's own page is the index.
 */
function ShowLayout() {
  const { showId } = Route.useParams()
  const account = useAccount()
  const { data, isLoading } = useQuery<ShowRow>('SELECT * FROM shows WHERE id = ?', [showId])
  const show = data[0]
  useRememberShow(account.email, showId, Boolean(show))
  const crumbs = useShowCrumbs(showId, show?.title ?? undefined)
  const leaf = useMatches({ select: (matches) => matches.at(-1)?.routeId })
  // The document lays out and scrolls its own panels, so it gets the content area to itself.
  const fullBleed = leaf === '/shows/$showId/docs/$docId'
  const phone = useBreakpoint() === 'phone'

  return (
    <PresenceProvider showId={showId}>
      <UploadProvider showId={showId}>
        <AppShell
          showId={showId}
          crumbs={crumbs}
          account={account}
          fullBleed={fullBleed}
          // The show's own page draws who is in the binder between the sync state and the buttons.
          actions={leaf === '/shows/$showId/' ? <BinderAvatars /> : undefined}
          primary={
            leaf && UPLOAD_SCREENS.includes(leaf) && !(phone && leaf === '/shows/$showId/') ? (
              <UploadDocumentButton />
            ) : undefined
          }
        >
          {isLoading ? <p>Loading…</p> : !show ? <p>Show not found.</p> : <Outlet />}
        </AppShell>
      </UploadProvider>
    </PresenceProvider>
  )
}
