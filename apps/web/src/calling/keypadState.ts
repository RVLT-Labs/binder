import { useSyncExternalStore } from 'react'

/**
 * Whether Calling mode's go-to keypad is open. A module store, like the palette's, so the window's
 * `g` key (outside the React tree) can open it and the strip's Go to… button can too.
 */
let open = false
const listeners = new Set<() => void>()

function set(next: boolean) {
  if (open === next) return
  open = next
  for (const fn of [...listeners]) fn()
}

export const openKeypad = () => set(true)
export const closeKeypad = () => set(false)
export const isKeypadOpen = (): boolean => open

export const useKeypadOpen = (): boolean =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    () => open,
  )
