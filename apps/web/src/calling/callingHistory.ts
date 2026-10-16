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

/** A key that is unique among a document's chips, whatever their labels say. */
export const jumpKey = (jump: Jump): string =>
  jump.kind === 'cue' ? `cue:${jump.cueId}` : `page:${jump.index}`

const NONE: readonly Jump[] = []

/**
 * The last few distinct jumps of this tab's session, newest first, kept per document: a page or cue
 * of one script means nothing on another. In memory only: a reload starts with none, and nothing
 * here is written to the device or the show.
 */
let recent = new Map<string, readonly Jump[]>()
const listeners = new Set<() => void>()

export function recordJump(documentId: string, jump: Jump): void {
  const mine = recent.get(documentId) ?? NONE
  recent = new Map(recent).set(
    documentId,
    [jump, ...mine.filter((j) => !same(j, jump))].slice(0, RECENT_JUMPS),
  )
  for (const fn of [...listeners]) fn()
}

export const recentJumps = (documentId: string): readonly Jump[] => recent.get(documentId) ?? NONE

export function useRecentJumps(documentId: string): readonly Jump[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    () => recentJumps(documentId),
  )
}

/** For tests: forget every jump. */
export function resetRecentJumps(): void {
  recent = new Map()
  for (const fn of [...listeners]) fn()
}
