import { useSyncExternalStore } from 'react'

/**
 * Whether the shell's own chrome (the rail, the top bar, the tab bar) is out of reach. Calling mode
 * covers the screen with its own layer; while it is on, nothing behind it may take focus or be read
 * out. The document page sets it while it is calling (it knows the viewer is up, which the address
 * alone does not say) and clears it on leaving and on unmount.
 */
let inert = false
const listeners = new Set<() => void>()

export function setShellInert(next: boolean): void {
  if (inert === next) return
  inert = next
  for (const fn of [...listeners]) fn()
}

export const useShellInert = (): boolean =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    () => inert,
    () => false,
  )
