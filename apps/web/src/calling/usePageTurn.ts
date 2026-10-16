import { type HTMLAttributes, type PointerEvent, useRef } from 'react'

/** A swipe turns the page past this many pixels sideways, when it is mostly sideways. */
const SWIPE_PX = 56
/** A tap stays within this many pixels and lets go within this many milliseconds. */
const TAP_SLOP_PX = 10
const TAP_MS = 500

/** Elements a tap belongs to: the strip, a tag, a control. They never turn the page. */
const OWN_TAP = 'button, a, input, dialog, [role="button"], [data-cue-id], [aria-label="Calling"]'

/**
 * Calling mode's page turns by hand (DESIGN §9): a tap on the stage's left third goes back, on its
 * right third forward, and a sideways swipe turns the page whichever way it goes (a swipe to the
 * left is forward). Spread the result on the stage; vertical drags are left to scroll the page.
 */
export function usePageTurn(turn: (direction: 1 | -1) => void): HTMLAttributes<HTMLDivElement> {
  const start = useRef<{ x: number; y: number; t: number; target: EventTarget | null } | null>(null)
  return {
    onPointerDown(e: PointerEvent<HTMLDivElement>) {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      start.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, target: e.target }
    },
    onPointerCancel() {
      start.current = null
    },
    onPointerUp(e: PointerEvent<HTMLDivElement>) {
      const from = start.current
      start.current = null
      if (!from) return
      const dx = e.clientX - from.x
      const dy = e.clientY - from.y
      if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.6) {
        turn(dx < 0 ? 1 : -1)
        return
      }
      if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX || e.timeStamp - from.t > TAP_MS)
        return
      const target = from.target
      if (target instanceof Element && target.closest(OWN_TAP)) return
      const { left, width } = e.currentTarget.getBoundingClientRect()
      const along = (e.clientX - left) / width
      if (along < 1 / 3) turn(-1)
      else if (along > 2 / 3) turn(1)
    },
  }
}
