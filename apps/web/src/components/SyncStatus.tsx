import { useQuery, useStatus } from '@powersync/react'
import { useOnline } from '../offline/useOnline'

/** Connection state plus the number of local changes not yet uploaded. */
export function SyncStatus() {
  const status = useStatus()
  // The sync stream notices a lost network only when it next fails; the browser knows at once.
  const online = useOnline()
  // ps_crud is PowerSync's upload queue: one row per local change awaiting upload.
  const { data } = useQuery<{ n: number }>('SELECT count(*) AS n FROM ps_crud')
  const pending = data[0]?.n ?? 0
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
  const dot = word === 'Synced' ? 'bg-ok' : word === 'Syncing…' ? 'bg-warn' : 'bg-muted'
  return (
    <output
      className="sync-status inline-flex shrink-0 items-center gap-1.5 text-[12px] text-ink-2"
      aria-label="Sync status"
      data-state={state.toLowerCase()}
    >
      <span aria-hidden className={`size-2 rounded-full ${dot}`} />
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
