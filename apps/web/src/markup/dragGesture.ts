import { useMemo, useRef } from 'react'

/** Pointer travel, in CSS pixels, before a press becomes a drag. */
export const DRAG_THRESHOLD = 3

/**
 * A finger on a bubble drifts as it taps: the bubble drag takes this much travel from a touch so a
 * tap never writes a position. A mouse or pen keeps `DRAG_THRESHOLD`.
 */
export const TOUCH_BUBBLE_THRESHOLD = 8

/** The travel before a bubble drag starts, for the kind of pointer that pressed it (`PointerEvent.pointerType`). */
export function bubbleDragThreshold(pointerType: string | undefined): number {
  return pointerType === 'touch' ? TOUCH_BUBBLE_THRESHOLD : DRAG_THRESHOLD
}

export interface PointerDragOptions {
  /** The pointer that started the drag: events from any other pointer are ignored. */
  pointerId: number
  /** Where it went down, in client pixels. */
  start: { x: number; y: number }
  /** Travel, in CSS pixels, before the press becomes a drag; `DRAG_THRESHOLD` when absent. */
  threshold?: number
  /** Keeps the pointer's events on this element while it is pressed. */
  capture?: Element
  /** Each move once the pointer has travelled past the threshold. */
  onMove?: (ev: PointerEvent) => void
  /** The release of a drag that passed the threshold (not a cancel, not a tap). */
  onDrop: (ev: PointerEvent) => void
  /** However the drag ended: release (after `onDrop`), cancel, or `stop()`. */
  onStop?: () => void
}

/**
 * One pointer drag: move, release and cancel are heard on the window, so the drag still ends if its
 * element goes away mid-drag (a collaborator deleted the row). Events from any other pointer (a
 * second finger, another button's device) neither move nor end it. Returns a `stop` that ends it now.
 */
export function startPointerDrag(opts: PointerDragOptions): () => void {
  const threshold = opts.threshold ?? DRAG_THRESHOLD
  let dragging = false
  let live = true
  const mine = (ev: PointerEvent) => ev.pointerId === opts.pointerId
  const move = (ev: PointerEvent) => {
    if (!mine(ev)) return
    if (!dragging && Math.hypot(ev.clientX - opts.start.x, ev.clientY - opts.start.y) < threshold)
      return
    dragging = true
    opts.onMove?.(ev)
  }
  const stop = () => {
    if (!live) return
    live = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    opts.onStop?.()
  }
  const end = (ev: PointerEvent) => {
    if (!mine(ev)) return
    const dropped = dragging && ev.type === 'pointerup'
    // The drop runs before the stop, so a gesture can keep what it previewed while its write lands.
    try {
      if (dropped) opts.onDrop(ev)
    } finally {
      stop()
    }
  }
  try {
    opts.capture?.setPointerCapture(opts.pointerId)
  } catch {
    // A pointer that is already gone cannot be captured; the window listeners still work.
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
  return stop
}

export interface DragSlot {
  /** Starts a drag, ending any other first. `owner` is the row being dragged, if any. */
  begin(owner: string | null, opts: PointerDragOptions): void
  /** Ends the drag if its row is no longer among the rows `has` knows. */
  endIfGone(has: (id: string) => boolean): void
  stop(): void
}

/** The one drag in progress from a page: markers, shapes and handles all go through it. */
export function useDragSlot(): DragSlot {
  const current = useRef<{ owner: string | null; stop: () => void } | null>(null)
  return useMemo<DragSlot>(
    () => ({
      begin(owner, opts) {
        current.current?.stop()
        const entry = {
          owner,
          stop: () => {},
        }
        entry.stop = startPointerDrag({
          ...opts,
          onStop: () => {
            if (current.current === entry) current.current = null
            opts.onStop?.()
          },
        })
        current.current = entry
      },
      endIfGone(has) {
        const entry = current.current
        if (entry?.owner && !has(entry.owner)) entry.stop()
      },
      stop() {
        current.current?.stop()
      },
    }),
    [],
  )
}
