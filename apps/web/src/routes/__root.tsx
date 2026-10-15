import {
  createRootRouteWithContext,
  Navigate,
  Outlet,
  useRouterState,
} from '@tanstack/react-router'
import { useSessionUser } from '../auth/session'
import { PowerSyncProvider } from '../powersync/provider'
import type { RouterContext } from '../router'
import { AppShell } from '../shell/AppShell'
import type { Crumb } from '../shell/types'
import { useAccount } from '../shell/useAccount'

export const Route = createRootRouteWithContext<RouterContext>()({ component: RootLayout })

function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { data: user, isPending, error } = useSessionUser()

  if (pathname === '/login') return <Outlet />
  if (isPending) return <p className="p-4">Loading…</p>
  if (error) return <p className="p-4">Could not reach Binder: {error.message}</p>
  if (!user) return <Navigate to="/login" />

  return (
    <PowerSyncProvider userId={user.id}>
      <SignedIn />
    </PowerSyncProvider>
  )
}

/** The shell around the screens above a show: the shows list and the account's own pages. */
const SHOWS_ROOT: Crumb = { label: 'Shows', link: { to: '/' }, phoneOnly: true }

function crumbsFor(pathname: string): Crumb[] {
  if (pathname === '/') return [{ label: 'Shows' }]
  if (pathname === '/settings/tokens') return [SHOWS_ROOT, { label: 'Personal access tokens' }]
  return [SHOWS_ROOT, { label: 'Binder' }]
}

function SignedIn() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const account = useAccount()
  // A show's screens are drawn by the show route, which knows the show for the rail and the crumbs.
  if (pathname.startsWith('/shows/')) return <Outlet />
  return (
    <AppShell crumbs={crumbsFor(pathname)} account={account}>
      <Outlet />
    </AppShell>
  )
}
