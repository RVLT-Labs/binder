import { type FormEvent, useState } from 'react'
import { authClient } from './client'

export interface LoginFormProps {
  /** Show "Email me a sign-in link"; false when the server cannot send mail. */
  magicLink: boolean
  onSignedIn: () => Promise<void>
}

export function LoginForm({ magicLink, onSignedIn }: LoginFormProps) {
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
    await onSignedIn()
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
    <>
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
        {magicLink && (
          <button type="button" disabled={busy} onClick={sendLink}>
            Email me a sign-in link
          </button>
        )}
      </form>
      {message && <p role="status">{message}</p>}
    </>
  )
}
