import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { afterSignIn } from '../auth/afterSignIn'
import { authCapabilitiesQueryKey, fetchAuthCapabilities } from '../auth/capabilities'
import { LoginForm } from '../auth/LoginForm'
import { meQueryKey } from '../auth/session'

export const Route = createFileRoute('/login')({ component: LoginPage })

function LoginPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // The magic-link option appears only once the server says it can send links.
  const capabilities = useQuery({
    queryKey: authCapabilitiesQueryKey,
    queryFn: fetchAuthCapabilities,
    staleTime: 5 * 60_000,
  })

  return (
    <main className="login mx-auto max-w-3xl p-4">
      <h1>Sign in to Binder</h1>
      <LoginForm
        magicLink={capabilities.data?.magicLink === true}
        onSignedIn={() =>
          afterSignIn({
            refreshSession: () => queryClient.invalidateQueries({ queryKey: meQueryKey }),
            toHome: () => navigate({ to: '/' }),
          })
        }
      />
    </main>
  )
}
