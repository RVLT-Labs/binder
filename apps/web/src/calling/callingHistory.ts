import { useSyncExternalStore } from 'react'

/** A jump made through the keypad or the palette: a cue (by id) or a page (zero-based). */
export type Jump =
  | { kind: 'cue'; cueId: string; label: string }
  | { kind: 'page'; index: number; label: string }

/** How many recent jumps the keypad offers. */
export const RECENT_JUMPS = 3

const same = (a: Jump, b: Jump) =>
  a.kind === 'cue'
    ? b.kind === 'cue' && a.cueId === b.cueId
    : b.kind === 'page' && a.index === b.index

/**
 * The last few distinct jumps of this tab's session, newest first. In memory only: a reload starts
 * with none, and nothing here is written to the device or the show.
 */
let recent: readonly Jump[] = []
const listeners = new Set<() => void>()

export function recordJump(jump: Jump): void {
  recent = [jump, ...recent.filter((j) => !same(j, jump))].slice(0, RECENT_JUMPS)
  for (const fn of [...listeners]) fn()
}

export const recentJumps = (): readonly Jump[] => recent

export function useRecentJumps(): readonly Jump[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    () => recent,
  )
}

/** For tests: forget every jump. */
export function resetRecentJumps(): void {
  recent = []
  for (const fn of [...listeners]) fn()
}
