import {
  createRootRouteWithContext,
  Navigate,
  Outlet,
  useRouterState,
} from '@tanstack/react-router'
import { RowsSkeleton } from '@/components/ui/skeleton'
import { useSessionUser } from '../auth/session'
import { KeepOfflineRunner } from '../offline/keepOffline/KeepOfflineRunner'
import { PowerSyncProvider } from '../powersync/provider'
import type { RouterContext } from '../router'
import { AppShell } from '../shell/AppShell'
import { useLastShowId } from '../shell/lastShow'
import type { Crumb } from '../shell/types'
import { useAccount } from '../shell/useAccount'

export const Route = createRootRouteWithContext<RouterContext>()({ component: RootLayout })

function RootLayout() {
  // The screens on show, not the address: the address changes first, and the screen being left is
  // still drawn (and still reads the local database) until the sign-in screen replaces it. Dropping
  // the provider on the address alone is what made the top bar's sync state throw at sign-out.
  const onLogin = useRouterState({
    select: (s) =>
      s.matches.length > 0
        ? s.matches.some((m) => m.routeId === '/login')
        : s.location.pathname === '/login',
  })
  const { data: user, isPending, error } = useSessionUser()

  if (onLogin) return <Outlet />
  if (isPending) return <RowsSkeleton className="m-4" />
  if (error) return <p className="p-4">Could not reach Binder: {error.message}</p>
  if (!user) return <Navigate to="/login" />

  return (
    <PowerSyncProvider userId={user.id}>
      {/* App-wide, so keep-offline goes on while the user is on the home page or another show. */}
      <KeepOfflineRunner userId={user.id} />
      <SignedIn />
    </PowerSyncProvider>
  )
}

/** The shell around the account's own pages. The shows home and a show draw their own shell. */
const SHOWS_ROOT: Crumb = { label: 'Shows', link: { to: '/' }, phoneOnly: true, backLabel: true }

function crumbsFor(pathname: string): Crumb[] {
  if (pathname === '/settings/tokens') return [SHOWS_ROOT, { label: 'Personal access tokens' }]
  return [SHOWS_ROOT, { label: 'Binder' }]
}

function SignedIn() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const account = useAccount()
  const lastShowId = useLastShowId(account.email)
  // A show's screens are drawn by the show route, which knows the show for the rail and the crumbs;
  // the shows home draws its own too, for the one primary action in the top bar.
  if (pathname === '/' || pathname.startsWith('/shows/')) return <Outlet />
  return (
    <AppShell crumbs={crumbsFor(pathname)} account={account} lastShowId={lastShowId}>
      <Outlet />
    </AppShell>
  )
}
