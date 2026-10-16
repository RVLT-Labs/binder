import { useStatus } from '@powersync/react'
import { cn } from '@/lib/utils'
import { useOnline } from '../offline/useOnline'
import { usePendingChanges } from './usePendingChanges'

/**
 * Connection state plus the number of local changes not yet uploaded. `compact` keeps the dot and
 * hands the word to assistive technology only: for the phone's top bar when a primary action takes
 * the room, so a title such as "Documents" is not cut short.
 */
export function SyncStatus({
  compact = false,
  crowded = false,
}: {
  compact?: boolean
  /** In the desktop and tablet top bar: the word gives way below 1025 px when the screen has controls there. */
  crowded?: boolean
}) {
  const status = useStatus()
  // The sync stream notices a lost network only when it next fails; the browser knows at once.
  const online = useOnline()
  const pending = usePendingChanges()
  const state = !online
    ? 'Offline'
    : status.connected
      ? 'Connected'
      : status.connecting
        ? 'Connecting'
        : 'Offline'
  // DESIGN §8: a dot and a word. Connected with nothing waiting is Synced; with local changes still
  // uploading (or still connecting) it is Syncing…; offline is just "Offline" (the mockup's states sheet; the count of what is waiting is in the OfflineBanner).
  const word =
    state === 'Connected'
      ? pending > 0
        ? 'Syncing…'
        : 'Synced'
      : state === 'Connecting'
        ? 'Syncing…'
        : 'Offline'
  // The mockup's `.sync .dot`: 7 px with a 2 px soft halo in the dot's own colour.
  const dot =
    word === 'Synced'
      ? 'bg-ok shadow-[0_0_0_2px_var(--ok-soft)]'
      : word === 'Syncing…'
        ? 'bg-warn shadow-[0_0_0_2px_var(--warn-soft)]'
        : 'bg-muted shadow-[0_0_0_2px_var(--muted-soft)]'
  return (
    <output
      className="sync-status inline-flex shrink-0 items-center gap-1.5 text-[12px] text-muted"
      aria-label="Sync status"
      data-state={state.toLowerCase()}
      // The words stay the mockup's; the count is for tests and tools (the banner says it to people).
      data-pending={pending}
    >
      <span aria-hidden className={`size-[7px] rounded-full ${dot}`} />
      <span
        className={cn(
          compact && 'sr-only',
          crowded && 'group-has-[[data-bar-actions]:not(:empty)]/bar:max-[1024px]:sr-only',
        )}
      >
        {word}
      </span>
      {state === 'Connected' && pending > 0 && (
        <span className={cn('pending font-mono tabular-nums', compact && 'sr-only')}>
          {' '}
          {pending}
        </span>
      )}
    </output>
  )
}
