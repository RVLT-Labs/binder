import type { AnnotationType } from '@binder/shared'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Handle } from './annotationEdit'

/** A handle is this many CSS pixels square, however far the page is zoomed. */
const HANDLE_PX = 8

export interface HandleTarget {
  type: AnnotationType
  anchor: { x: number; y: number }
  geometry: Record<string, number>
}

const CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  start: 'crosshair',
  end: 'crosshair',
}

/** Where each handle sits (displayed points, y up): a box's four corners, a line's two ends. */
export function handlePositions(a: HandleTarget): Array<{ handle: Handle; x: number; y: number }> {
  const { x, y } = a.anchor
  if (a.type === 'rect' || a.type === 'ellipse') {
    const w = Number(a.geometry.w) || 0
    const h = Number(a.geometry.h) || 0
    return [
      { handle: 'nw', x, y: y + h },
      { handle: 'ne', x: x + w, y: y + h },
      { handle: 'sw', x, y },
      { handle: 'se', x: x + w, y },
    ]
  }
  if (a.type === 'line' || a.type === 'arrow') {
    return [
      { handle: 'start', x, y },
      { handle: 'end', x: x + (Number(a.geometry.dx) || 0), y: y + (Number(a.geometry.dy) || 0) },
    ]
  }
  return []
}

export interface HandlesProps {
  annotation: HandleTarget
  zoom: number
  onHandleDown: (handle: Handle, e: ReactPointerEvent<SVGRectElement>) => void
}

/** The drag handles of a selected rect, ellipse, line, or arrow that the user may resize. */
export function Handles({ annotation, zoom, onHandleDown }: HandlesProps) {
  const size = HANDLE_PX / zoom
  return (
    <g className="annotation-handles">
      {handlePositions(annotation).map(({ handle, x, y }) => (
        <rect
          key={handle}
          data-handle={handle}
          x={x - size / 2}
          y={y - size / 2}
          width={size}
          height={size}
          fill="#fff"
          stroke="#1d4ed8"
          strokeWidth={1.25 / zoom}
          style={{ pointerEvents: 'auto', cursor: CURSOR[handle], touchAction: 'none' }}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            onHandleDown(handle, e)
          }}
        />
      ))}
    </g>
  )
}
