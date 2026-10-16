import { useSyncExternalStore } from 'react'
import type { ShowStatus } from './runner'

/**
 * How keep-offline is getting on, per show: the runner mount copies the runner's status here so
 * the switch (More, the overview's Offline card) can say so without holding the runner. Memory
 * only; the map is replaced, never mutated.
 */
let statuses: ReadonlyMap<string, ShowStatus> = new Map()
const listeners = new Set<() => void>()

export function publishKeepOfflineStatus(next: ReadonlyMap<string, ShowStatus>): void {
  statuses = next
  for (const l of [...listeners]) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** The runner's status of one show; undefined when it has none (Off, or not reported yet). */
export function useKeepOfflineStatus(showId: string): ShowStatus | undefined {
  return useSyncExternalStore(subscribe, () => statuses.get(showId))
}
