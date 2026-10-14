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
  return (
    <output className="sync-status" aria-label="Sync status" data-state={state.toLowerCase()}>
      <span>{state}</span>
      {pending > 0 && <span className="pending"> · {pending} pending</span>}
    </output>
  )
}
