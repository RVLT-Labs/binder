import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { authClient } from '../auth/client'
import { meQueryKey } from '../auth/session'

export const Route = createFileRoute('/login')({ component: LoginPage })

function LoginPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function signIn(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const { error } = await authClient.signIn.email({ email, password })
    setBusy(false)
    if (error) {
      setMessage(error.message ?? 'Sign-in failed')
      return
    }
    await queryClient.invalidateQueries({ queryKey: meQueryKey })
    await navigate({ to: '/' })
  }

  async function sendLink() {
    if (!email) {
      setMessage('Enter your email first')
      return
    }
    setBusy(true)
    const { error } = await authClient.signIn.magicLink({ email, callbackURL: '/' })
    setBusy(false)
    setMessage(
      error ? (error.message ?? 'Could not send the link') : `Sign-in link sent to ${email}`,
    )
  }

  return (
    <main className="page login">
      <h1>Sign in to Binder</h1>
      <form onSubmit={signIn}>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy || !password}>
          Sign in
        </button>
        <button type="button" disabled={busy} onClick={sendLink}>
          Email me a sign-in link
        </button>
      </form>
      {message && <p role="status">{message}</p>}
    </main>
  )
}
