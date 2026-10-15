import { useSyncExternalStore } from 'react'
import type { MarkupTable } from './mutations'

/** The review item whose next click on the page decides where it belongs on this version. */
export type Relocating = { table: MarkupTable; id: string } | null

let current: Relocating = null
const listeners = new Set<() => void>()

function set(next: Relocating): void {
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

/** "Move" on an item that is not drawn on this version: the next click on a page places it. */
export const startRelocate = (table: MarkupTable, id: string): void => set({ table, id })
export const endRelocate = (): void => set(null)
export const isRelocating = (): boolean => current !== null

export function useRelocating(): Relocating {
  return useSyncExternalStore(subscribe, () => current)
}
