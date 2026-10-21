import { type FormEvent, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn, focusRing } from '@/lib/utils'
import { authClient } from './client'

export interface LoginFormProps {
  /** Show "Email me a link instead"; false when the server cannot send mail. */
  magicLink: boolean
  onSignedIn: () => Promise<void>
}

export function MagicLinkButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{ minHeight: 44, minWidth: 44 }}
      className={cn(
        'mx-auto inline-flex min-h-11 items-center rounded-sm px-3 text-[14px] font-semibold text-ink-2 underline decoration-line-2 underline-offset-[3px] hover:text-ink disabled:cursor-not-allowed disabled:opacity-45 md:min-h-0 md:px-0 md:text-[13px]',
        focusRing,
      )}
    >
      Email me a link instead
    </button>
  )
}

export function LoginForm({ magicLink, onSignedIn }: LoginFormProps) {
  const emailId = useId()
  const passwordId = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  async function signIn(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const { error } = await authClient.signIn.email({ email, password })
    setBusy(false)
    if (error) {
      setMessage({ text: error.message ?? 'Sign-in failed', failed: true })
      return
    }
    await onSignedIn()
  }

  async function sendLink() {
    if (!email) {
      setMessage({ text: 'Enter your email first', failed: true })
      return
    }
    setBusy(true)
    const { error } = await authClient.signIn.magicLink({ email, callbackURL: '/' })
    setBusy(false)
    setMessage(
      error
        ? { text: error.message ?? 'Could not send the link', failed: true }
        : { text: `Sign-in link sent to ${email}`, failed: false },
    )
  }

  return (
    <>
      <form onSubmit={signIn} className="flex flex-col gap-[22px] md:gap-[18px]">
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-[3px]">
            <Label htmlFor={emailId}>Email</Label>
            <Input
              id={emailId}
              inputSize="lg"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-[3px]">
            <Label htmlFor={passwordId}>Password</Label>
            <Input
              id={passwordId}
              inputSize="lg"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-1.5 md:gap-3.5">
          <Button type="submit" size="lg" className="w-full" disabled={busy || !password}>
            Sign in
          </Button>
          {magicLink && <MagicLinkButton disabled={busy} onClick={sendLink} />}
        </div>
      </form>
      {message && (
        <p
          role="status"
          className={cn('text-center text-[13px]', message.failed ? 'text-t-out' : 'text-ink-2')}
        >
          {message.text}
        </p>
      )}
    </>
  )
}
