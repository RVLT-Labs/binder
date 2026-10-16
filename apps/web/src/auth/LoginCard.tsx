import { BinderMark } from '@/brand/BinderMark'
import { LoginForm, type LoginFormProps } from './LoginForm'

/**
 * The sign-in card (DESIGN §11): the mark and wordmark, a Kalam line, the form, and under the card
 * why signing in once is enough. The page's heading is "Sign in to Binder" for assistive tech; the
 * eye reads the wordmark.
 */
export function LoginCard(props: LoginFormProps) {
  return (
    // The mockup's sign-in (`screens2_access.py` .ac-login, `screens2_mobile.py` .mb-lcard): a 400 px
    // card, 32/32/28 padding and an 18 px rhythm (28/24/24 and 22 on a phone).
    <div className="w-full max-w-[400px]">
      <div className="flex flex-col gap-[22px] rounded-[20px] border-2 border-line-2 bg-card p-[28px_24px_24px] shadow-card md:gap-[18px] md:p-[32px_32px_28px]">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3">
            <BinderMark className="size-11 shrink-0 drop-shadow-[0_3px_0_var(--red-700)]" />
            <h1
              aria-label="Sign in to Binder"
              className="font-display text-[30px] font-extrabold leading-none tracking-[-.03em] text-ink"
            >
              Binder
            </h1>
            <span className="inline-flex h-5 items-center rounded-full border border-line-2 px-[9px] text-[11px] font-semibold text-muted">
              by RVLT
            </span>
          </div>
          <p className="-mt-0.5 font-hand text-[16px] leading-[1.2] text-muted md:-mt-1.5">
            the book is where you left it
          </p>
        </div>
        <LoginForm {...props} />
      </div>
      <p className="mt-[18px] px-3 text-center text-[12px] leading-[1.5] text-muted md:px-0">
        Stays signed in on this device, so the book opens offline.
      </p>
    </div>
  )
}
