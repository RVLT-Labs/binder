import { useOnline } from '../offline/useOnline'
import { WifiOffIcon } from './icons'
import { usePendingChanges } from './usePendingChanges'

/**
 * The words and the look: the mockups' `.ov-banner`. Offline is a state, not an error (DESIGN §11),
 * so it is a muted bar, never an alert, and it says how much is waiting (nothing, when nothing is).
 * It is read politely by the live region that holds it (`ShellOfflineBanner`), which stays mounted
 * so that the bar arriving is announced.
 */
export function OfflineBanner({ waiting }: { waiting: number }) {
  return (
    <div className="offline-banner flex min-h-11 items-center gap-3 rounded-[12px] border-2 border-line-2 bg-elev px-4 py-2 text-[13.5px] text-ink-2 md:h-11 md:py-0">
      <WifiOffIcon aria-hidden className="size-4 shrink-0 text-muted" />
      <span>
        Offline. Changes are saved on this device
        {waiting > 0 ? (
          <>
            {' '}
            — <span className="font-mono tabular-nums">{waiting}</span> waiting to sync.
          </>
        ) : (
          '.'
        )}
      </span>
    </div>
  )
}

function WaitingBanner() {
  return <OfflineBanner waiting={usePendingChanges()} />
}

/**
 * Shown while the browser has no network. The upload count is read only then, so a screen that is
 * online (or a test without a database) never opens the query.
 */
export function ShellOfflineBanner({ className }: { className?: string }) {
  const online = useOnline()
  // One live region for the life of the shell: a region that arrives already holding text is often
  // not announced, so the text is what gets mounted inside it.
  return (
    <div role="status" className={online ? undefined : className}>
      {!online && <WaitingBanner />}
    </div>
  )
}
