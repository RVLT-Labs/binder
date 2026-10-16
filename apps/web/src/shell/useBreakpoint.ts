import { useSyncExternalStore } from 'react'

export type Breakpoint = 'phone' | 'tablet' | 'desktop'

/** DESIGN §6.1: phone below 768, tablet 768 to 1024 inclusive, desktop above 1024. */
const TABLET_UP = '(min-width: 768px)'
const DESKTOP_UP = '(min-width: 1025px)'

function matches(query: string): boolean | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
  return window.matchMedia(query).matches
}

function read(): Breakpoint {
  // Without matchMedia (server render, a bare test environment) the full shell is the safe answer.
  if (matches(DESKTOP_UP) !== false) return 'desktop'
  return matches(TABLET_UP) ? 'tablet' : 'phone'
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const lists = [TABLET_UP, DESKTOP_UP].map((q) => window.matchMedia(q))
  for (const list of lists) list.addEventListener?.('change', onChange)
  return () => {
    for (const list of lists) list.removeEventListener?.('change', onChange)
  }
}

/** Which shell to draw: bottom tab bar (phone), icon rail (tablet) or labelled rail (desktop). */
export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, read, () => 'desktop')
}
