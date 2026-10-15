import { BinderMark } from '@/brand/BinderMark'
import { LoginForm, type LoginFormProps } from './LoginForm'

/**
 * The sign-in card (DESIGN §11): the mark and wordmark, a Kalam line, the form, and under the card
 * why signing in once is enough. The page's heading is "Sign in to Binder" for assistive tech; the
 * eye reads the wordmark.
 */
export function LoginCard(props: LoginFormProps) {
  return (
    <div className="w-full max-w-[368px]">
      <div className="rounded-[20px] border-2 border-line-2 bg-card p-6 shadow-card md:p-[30px]">
        <div className="flex items-center gap-3">
          <BinderMark className="size-10 shrink-0" />
          <h1
            aria-label="Sign in to Binder"
            className="font-display text-[28px] font-extrabold leading-none text-ink"
          >
            Binder
          </h1>
          <span className="rounded-full border border-line-2 px-2.5 py-1 text-[11px] leading-none text-muted">
            by RVLT
          </span>
        </div>
        <p className="mt-1 mb-6 font-hand text-[17px] leading-snug text-ink-2">
          the book is where you left it
        </p>
        <LoginForm {...props} />
      </div>
      <p className="mt-4 text-center text-[12px] text-muted">
        Stays signed in on this device, so the book opens offline.
      </p>
    </div>
  )
}
