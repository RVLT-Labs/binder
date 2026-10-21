import type { BubbleOffset } from '@binder/shared'
import { useCallback, useEffect, useReducer, useRef } from 'react'

/** The write follows the last press of a burst by this long. */
export const NUDGE_DEBOUNCE_MS = 300
/** A written nudge stands in for the stored tag at most this long while the write travels back. */
export const NUDGE_SETTLE_MS = 1500

/** Tag offsets are kept to a hundredth of a point: finer is noise in the history and the sync. */
export const hundredth = (n: number) => Math.round(n * 100) / 100

/** Two tags are the same offset (an absent tag is the margin). */
export const tagKey = (tag: BubbleOffset | undefined | null) => (tag ? `${tag.dx},${tag.dy}` : '')

interface Entry {
  /** Where the bubble is drawn and will be written: every press builds on this, whatever the stored tag does. */
  tag: BubbleOffset
  /** The write has been issued; the entry stays until the stored tag catches up. */
  issued: boolean
  debounce: ReturnType<typeof setTimeout> | null
  expiry: ReturnType<typeof setTimeout> | null
}

export interface BubbleNudges {
  /** The tag a cue's bubble is being nudged to, or undefined when it is not. Drawn at once, written soon. */
  targetOf(id: string): BubbleOffset | undefined
  /**
   * Moves the bubble by `(dx, dy)` page points from its nudge target, or from `base` (where it is
   * drawn now) when it has none. Presses within a burst build on one another and are written once.
   */
  nudge(id: string, base: BubbleOffset, dx: number, dy: number): void
  /** Writes a cue's pending nudge now (all cues when no id). A no-op when nothing is pending. */
  flush(id?: string): void
  /**
   * Drops a cue's nudge target, pending write included: its bubble is drawn from the stored tag again.
   * For a write that overrides the nudge (a drag, Reset to margin), which leaves the issued entry
   * unable to ever match the stored tag.
   */
  forget(id: string): void
  /** Changes with every nudge, write and settle: a dependency for what is drawn from `targetOf`. */
  version: number
}

/**
 * Keyboard nudges of cue bubbles, coalesced: each press moves a per-cue target that is drawn at once;
 * `write` is called once, `NUDGE_DEBOUNCE_MS` after the last press of a burst (one burst, one history
 * entry), or sooner on `flush`, when a cue other than `selectedId` is no longer selected, on unmount,
 * and when the page is hidden or closed. An entry is dropped once its write has landed in `cues` (the
 * stored tag equals it) or after `NUDGE_SETTLE_MS`, so a stored change in between never loses a press.
 */
export function useBubbleNudge(
  cues: ReadonlyArray<{ id: string; anchor: { tag?: BubbleOffset } }>,
  selectedId: string | null,
  write: (id: string, tag: BubbleOffset) => void,
): BubbleNudges {
  const entries = useRef(new Map<string, Entry>())
  const [version, bump] = useReducer((n: number) => n + 1, 0)
  const writeRef = useRef(write)
  writeRef.current = write

  const drop = useCallback((id: string) => {
    const e = entries.current.get(id)
    if (!e) return
    if (e.debounce) clearTimeout(e.debounce)
    if (e.expiry) clearTimeout(e.expiry)
    entries.current.delete(id)
    bump()
  }, [])

  const flushOne = useCallback(
    (id: string) => {
      const e = entries.current.get(id)
      if (!e || e.issued) return
      if (e.debounce) clearTimeout(e.debounce)
      e.debounce = null
      e.issued = true
      e.expiry = setTimeout(() => drop(id), NUDGE_SETTLE_MS)
      writeRef.current(id, e.tag)
      bump()
    },
    [drop],
  )

  const flush = useCallback(
    (id?: string) => {
      if (id !== undefined) flushOne(id)
      else for (const key of [...entries.current.keys()]) flushOne(key)
    },
    [flushOne],
  )

  const nudge = useCallback(
    (id: string, base: BubbleOffset, dx: number, dy: number) => {
      const was = entries.current.get(id)
      const from = was?.tag ?? base
      const tag = { dx: hundredth(from.dx + dx), dy: hundredth(from.dy + dy) }
      if (was?.debounce) clearTimeout(was.debounce)
      if (was?.expiry) clearTimeout(was.expiry)
      entries.current.set(id, {
        tag,
        issued: false,
        expiry: null,
        debounce: setTimeout(() => flushOne(id), NUDGE_DEBOUNCE_MS),
      })
      bump()
    },
    [flushOne],
  )

  // An issued nudge gives way to the stored tag once it has caught up (or the cue has gone).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` re-runs this when an entry is issued
  useEffect(() => {
    for (const [id, e] of entries.current) {
      if (!e.issued) continue
      const cue = cues.find((c) => c.id === id)
      if (!cue || tagKey(cue.anchor.tag) === tagKey(e.tag)) drop(id)
    }
  }, [cues, version, drop])

  // Only the selected cue's bubble is nudged: deselecting writes what is pending.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` re-runs this when an entry is created
  useEffect(() => {
    for (const id of entries.current.keys()) if (id !== selectedId) flushOne(id)
  }, [selectedId, version, flushOne])

  // Closing or hiding the tab must not lose the last nudge; leaving the page writes it too.
  useEffect(() => {
    const gone = () => flush()
    const hide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', gone)
    document.addEventListener('visibilitychange', hide)
    const live = entries.current
    return () => {
      window.removeEventListener('pagehide', gone)
      document.removeEventListener('visibilitychange', hide)
      flush()
      for (const e of live.values()) {
        if (e.debounce) clearTimeout(e.debounce)
        if (e.expiry) clearTimeout(e.expiry)
      }
      live.clear()
    }
  }, [flush])

  const targetOf = useCallback((id: string) => entries.current.get(id)?.tag, [])
  return { targetOf, nudge, flush, forget: drop, version }
}
