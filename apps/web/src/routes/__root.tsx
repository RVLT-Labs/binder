import { useQueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  Link,
  Navigate,
  Outlet,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { authClient } from '../auth/client'
import { useSessionUser } from '../auth/session'
import { Notices } from '../components/Notices'
import { clearNotices } from '../components/noticeStore'
import { SyncStatus } from '../components/SyncStatus'
import { clearLocalData, PowerSyncProvider } from '../powersync/provider'
import type { RouterContext } from '../router'

export const Route = createRootRouteWithContext<RouterContext>()({ component: RootLayout })

function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { data: user, isPending, error } = useSessionUser()

  if (pathname === '/login') return <Outlet />
  if (isPending) return <p className="page">Loading…</p>
  if (error) return <p className="page">Could not reach Binder: {error.message}</p>
  if (!user) return <Navigate to="/login" />

  return (
    <PowerSyncProvider userId={user.id}>
      <header className="app-header">
        <Link to="/" className="brand">
          Binder
        </Link>
        <nav>
          <Link to="/">Shows</Link>
          <Link to="/settings/tokens">Tokens</Link>
        </nav>
        <SyncStatus />
        <span className="user">{user.email}</span>
        <SignOut />
      </header>
      <Notices />
      <main className="page">
        <Outlet />
      </main>
    </PowerSyncProvider>
  )
}

function SignOut() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={async () => {
        await clearLocalData()
        await authClient.signOut()
        clearNotices()
        queryClient.clear()
        await navigate({ to: '/login' })
      }}
    >
      Sign out
    </button>
  )
}
