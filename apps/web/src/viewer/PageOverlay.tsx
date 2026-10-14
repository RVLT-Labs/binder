import type { ReactNode } from 'react'
import { pageGeometry } from './coords'

export interface PageOverlayProps {
  /** Displayed page size in PDF points. */
  width: number
  height: number
  zoom: number
  /** Drawn in displayed coordinates (points, origin bottom-left, y up). Text must be counter-flipped. */
  children: ReactNode
}

/**
 * An SVG over one page, filling its box. Children draw in displayed page space: the viewBox is the
 * page in points and the group flips y, so (x, y) is where a word layer says it is. It never takes
 * pointer events, so the page underneath stays selectable and scrollable.
 */
export function PageOverlay({ width, height, zoom, children }: PageOverlayProps) {
  const { cssWidth, cssHeight } = pageGeometry({ width, height }, zoom)
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{
        position: 'absolute',
        inset: 0,
        width: cssWidth,
        height: cssHeight,
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    >
      <g transform={`translate(0 ${height}) scale(1 -1)`}>{children}</g>
    </svg>
  )
}
