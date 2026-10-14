import { usePowerSync } from '@powersync/react'
import { useEffect, useRef, useState } from 'react'
import { type PrefetchProgress, prefetchShow } from './prefetch'

type State =
  | { phase: 'idle' }
  | { phase: 'running'; progress: PrefetchProgress }
  | { phase: 'done'; fetched: number; failed: number }
  | { phase: 'error'; message: string }

/**
 * Downloads a show's ready documents (PDFs, thumbnails, text) so they open and search with no
 * network. Safe to press again: what is stored is skipped, and anything that failed is retried.
 */
export function OfflineButton({ showId }: { showId: string }) {
  const db = usePowerSync()
  const [state, setState] = useState<State>({ phase: 'idle' })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function start() {
    setState({ phase: 'running', progress: { done: 0, total: 0 } })
    try {
      const { fetched, failed } = await prefetchShow(db, showId, (progress) => {
        if (mounted.current) setState({ phase: 'running', progress })
      })
      if (mounted.current) setState({ phase: 'done', fetched, failed: failed.length })
    } catch (err) {
      if (mounted.current) {
        setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  const running = state.phase === 'running'
  return (
    <div className="offline">
      <button type="button" onClick={start} disabled={running}>
        {state.phase === 'done' && state.failed === 0
          ? 'Refresh offline copy'
          : 'Make available offline'}
      </button>
      {running && (
        <progress
          aria-label="Offline download progress"
          value={state.progress.done}
          max={Math.max(state.progress.total, 1)}
        />
      )}
      <span role="status" className="offline-status">
        {state.phase === 'running' && state.progress.total > 0
          ? `Saving ${state.progress.done} of ${state.progress.total}…`
          : state.phase === 'done'
            ? state.failed === 0
              ? `Available offline (${state.fetched} files)`
              : `${state.failed} of ${state.fetched + state.failed} files could not be saved. Press the button to retry.`
            : state.phase === 'error'
              ? `Could not save for offline use: ${state.message}`
              : ''}
      </span>
    </div>
  )
}
