import type { PresencePeer } from '@binder/shared'

/** Gap between a marker and the outline around it, in points: clear of the marker's own selection box. */
const OUTLINE_GAP = 4
/** The outline's width: 2 pt, in the page's point space. */
const OUTLINE_WIDTH = 2
/** Extra gap for each further person who has the same row selected. */
const OUTLINE_STEP = 3

/**
 * A peer's selection: a 2 pt outline in their colour drawn outside the cue or annotation, so the
 * row keeps its own (department) colour and both read. Several people on one row get nested
 * outlines. Purely decorative: hidden from assistive technology and never takes the pointer.
 */
export function PeerOutline({
  box,
  peers,
}: {
  box: { x: number; y: number; w: number; h: number }
  peers: readonly PresencePeer[]
}) {
  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a plain SVG group is never focusable
    <g className="peer-outline" aria-hidden="true" pointerEvents="none">
      {peers.map((peer, i) => {
        const gap = OUTLINE_GAP + i * OUTLINE_STEP
        return (
          <rect
            key={peer.userId}
            data-peer-id={peer.userId}
            x={box.x - gap}
            y={box.y - gap}
            width={box.w + 2 * gap}
            height={box.h + 2 * gap}
            rx={3}
            fill="none"
            stroke={peer.colour}
            strokeWidth={OUTLINE_WIDTH}
            pointerEvents="none"
          />
        )
      })}
    </g>
  )
}
