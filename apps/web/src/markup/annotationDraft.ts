import type { AnnotationType } from '@binder/shared'

type Point = { x: number; y: number }

/** A drag shorter than this, in points, makes no shape. */
export const MIN_DRAFT = 2

export interface Draft {
  anchor: Point
  geometry: Record<string, number>
}

/**
 * The anchor and geometry for a shape dragged from `start` to `end` (displayed points). A rect or
 * ellipse anchors at its bottom-left corner whichever way it was dragged; a line or arrow anchors at
 * its start. A drag under 2 points (either side of a box, the length of a line) makes nothing. Notes,
 * stamps and highlights anchor where they were pressed and carry no geometry.
 */
export function draftToAnnotation(tool: AnnotationType, start: Point, end: Point): Draft | null {
  const dx = end.x - start.x
  const dy = end.y - start.y
  switch (tool) {
    case 'rect':
    case 'ellipse': {
      const w = Math.abs(dx)
      const h = Math.abs(dy)
      if (w < MIN_DRAFT || h < MIN_DRAFT) return null
      return {
        anchor: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) },
        geometry: { w, h },
      }
    }
    case 'line':
    case 'arrow':
      if (Math.hypot(dx, dy) < MIN_DRAFT) return null
      return { anchor: { x: start.x, y: start.y }, geometry: { dx, dy } }
    default:
      return { anchor: { x: start.x, y: start.y }, geometry: {} }
  }
}
