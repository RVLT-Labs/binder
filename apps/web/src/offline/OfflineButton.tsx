import { usePowerSync } from '@powersync/react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { blobCacheChanged } from './cacheStatus'
import { type PrefetchProgress, prefetchShow } from './prefetch'

export type OfflineCopyState =
  | { phase: 'idle' }
  | { phase: 'running'; progress: PrefetchProgress }
  | { phase: 'done'; fetched: number; failed: number }
  | { phase: 'error'; message: string }

export interface OfflineCopy {
  state: OfflineCopyState
  running: boolean
  start: () => Promise<void>
}

/**
 * Downloads a show's ready documents (PDFs, thumbnails, text) so they open and search with no
 * network. Safe to run again: what is stored is skipped, and anything that failed is retried. The
 * state is a hook so that the button and the words about it can sit in different places (the
 * overview's top bar holds the button, its Offline card the progress).
 */
export function useOfflineCopy(showId: string): OfflineCopy {
  const db = usePowerSync()
  const [state, setState] = useState<OfflineCopyState>({ phase: 'idle' })
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
    } finally {
      // Whatever got stored (or not), the screens that say what is on this device look again.
      blobCacheChanged()
    }
  }

  return { state, running: state.phase === 'running', start }
}

/** The button that starts (or refreshes) the offline copy. */
export function OfflineAction({ copy, className }: { copy: OfflineCopy; className?: string }) {
  const { state } = copy
  return (
    <Button
      type="button"
      variant="line"
      className={className}
      onClick={() => void copy.start()}
      disabled={copy.running}
    >
      {state.phase === 'done' && state.failed === 0
        ? 'Refresh offline copy'
        : 'Make available offline'}
    </Button>
  )
}

/**
 * The copy's progress bar and the sentence about how it went. Nothing while idle; the live region
 * appears with the first "running" state, so the sentences that follow are announced.
 */
export function OfflineStatus({ copy, className }: { copy: OfflineCopy; className?: string }) {
  const { state } = copy
  if (state.phase === 'idle') return null
  return (
    <div className={cn('flex flex-col items-start gap-3', className)}>
      {state.phase === 'running' && (
        <progress
          aria-label="Offline download progress"
          value={state.progress.done}
          max={Math.max(state.progress.total, 1)}
          className="h-2 w-full appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-ink-2 [&::-webkit-progress-bar]:bg-paper-2 [&::-webkit-progress-value]:bg-ink-2"
        />
      )}
      <span role="status" className="offline-status text-[13px] text-muted empty:-mt-3">
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
