import { useSyncExternalStore } from 'react'
import type { MarkupTable } from './mutations'

export type Selection = { table: MarkupTable; id: string } | null

let current: Selection = null
const listeners = new Set<() => void>()

function set(next: Selection): void {
  if (current?.table === next?.table && current?.id === next?.id) return
  current = next
  for (const fn of [...listeners]) fn()
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const select = (table: MarkupTable, id: string): void => set({ table, id })
export const clearSelection = (): void => set(null)

/** The selected cue or annotation, shared across the viewer. */
export function useSelection(): Selection {
  return useSyncExternalStore(subscribe, () => current)
}

let fresh: string | null = null

/** Marks a row just created, so its editor can take focus once (a new note wants its text typed). */
export function markFresh(id: string): void {
  fresh = id
}

/** True once for the row `markFresh` named. */
export function takeFresh(id: string): boolean {
  if (fresh !== id) return false
  fresh = null
  return true
}
