import { cn, focusRing } from '@/lib/utils'
import { dismissNotice, type Notice, useNotices } from './noticeStore'

/** The 3 px accent bar down a notice's left edge says what kind it is; the words say what happened. */
const ACCENT: Record<Notice['kind'], string> = {
  rejection: 'before:bg-red',
  error: 'before:bg-red',
  info: 'before:bg-blue',
}

/**
 * Rejected sync writes and other problems the user should know about, as Flow-style notices: cards
 * with a left accent bar. Fixed bottom-right on desktop and tablet; on a phone they sit above the
 * tab bar when there is one.
 */
export function Notices({ aboveTabBar = false }: { aboveTabBar?: boolean }) {
  const notices = useNotices()
  if (notices.length === 0) return null
  return (
    <ul
      aria-label="Notices"
      className={cn(
        'pointer-events-none fixed right-4 left-4 z-50 m-0 flex list-none flex-col gap-2 p-0 md:left-auto md:w-[26rem]',
        aboveTabBar
          ? 'bottom-[calc(56px+env(safe-area-inset-bottom)+12px)] md:bottom-4'
          : 'bottom-[calc(16px+env(safe-area-inset-bottom))]',
      )}
    >
      {notices.map((n) => (
        <li
          key={n.id}
          role="alert"
          className={cn(
            'notice pointer-events-auto relative flex items-center gap-3 overflow-hidden rounded-[var(--radius)] border-2 border-line-2 bg-card py-2 pr-2 pl-5 text-[13.5px] text-ink shadow-stk',
            'before:absolute before:inset-y-0 before:left-0 before:w-[3px]',
            ACCENT[n.kind],
            `notice-${n.kind}`,
          )}
        >
          <span className="min-w-0 flex-1 py-1">{n.message}</span>
          {n.action && (
            <button
              type="button"
              onClick={n.action.run}
              className={cn(
                'min-h-11 shrink-0 rounded-full px-3 text-[13px] font-semibold text-ink underline underline-offset-2 hover:text-red md:min-h-8',
                focusRing,
              )}
            >
              {n.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => dismissNotice(n.id)}
            aria-label="Dismiss notice"
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-full text-[18px] leading-none text-muted hover:text-ink md:size-8',
              focusRing,
            )}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}
