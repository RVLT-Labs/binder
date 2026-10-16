import { useStatus } from '@powersync/react'
import { useOnline } from '../offline/useOnline'
import { usePendingChanges } from './usePendingChanges'

/** Connection state plus the number of local changes not yet uploaded. */
export function SyncStatus() {
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
  // uploading (or still connecting) it is Syncing…; offline keeps the count of what is waiting.
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
    >
      <span aria-hidden className={`size-[7px] rounded-full ${dot}`} />
      <span>{word}</span>
      {state === 'Connected' && pending > 0 && (
        <span className="pending font-mono tabular-nums"> {pending}</span>
      )}
      {state !== 'Connected' && pending > 0 && (
        <span className="pending font-mono tabular-nums"> · {pending} pending</span>
      )}
    </output>
  )
}
