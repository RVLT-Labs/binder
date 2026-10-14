import { MIN_DRAFT } from './annotationDraft'

type Point = { x: number; y: number }

export type BoxHandle = 'nw' | 'ne' | 'sw' | 'se'
export type Handle = BoxHandle | 'start' | 'end'

const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v))

/** The anchor moved by (dx, dy); with a page size, kept on the page. Geometry is the caller's. */
export function moveBy(
  anchor: Point,
  dx: number,
  dy: number,
  page?: { width: number; height: number },
): Point {
  const x = anchor.x + dx
  const y = anchor.y + dy
  return page ? { x: clamp(x, page.width), y: clamp(y, page.height) } : { x, y }
}

export interface BoxResult {
  anchor: Point
  geometry: { w: number; h: number }
}

/**
 * The box (anchored at its bottom-left, extending right and up) after dragging one corner to `p`.
 * The opposite corner stays fixed and the result is normalised, so dragging past it flips the box.
 * Null when the result would be under 2 points on a side.
 */
export function resizeBoxOrNull(
  anchor: Point,
  geometry: { w: number; h: number },
  handle: BoxHandle,
  p: Point,
): BoxResult | null {
  // y is up: the north edge is the top, anchor.y + h.
  const fixed = {
    x: handle === 'nw' || handle === 'sw' ? anchor.x + geometry.w : anchor.x,
    y: handle === 'nw' || handle === 'ne' ? anchor.y : anchor.y + geometry.h,
  }
  const w = Math.abs(p.x - fixed.x)
  const h = Math.abs(p.y - fixed.y)
  if (w < MIN_DRAFT || h < MIN_DRAFT) return null
  return { anchor: { x: Math.min(p.x, fixed.x), y: Math.min(p.y, fixed.y) }, geometry: { w, h } }
}

/** `resizeBoxOrNull`, keeping the box as it was when the result would be too small. */
export function resizeBox(
  anchor: Point,
  geometry: { w: number; h: number },
  handle: BoxHandle,
  p: Point,
): BoxResult {
  return resizeBoxOrNull(anchor, geometry, handle, p) ?? { anchor, geometry }
}

export interface LineResult {
  anchor: Point
  geometry: { dx: number; dy: number }
}

/**
 * The line (anchored at its start, running by (dx, dy)) after dragging one end to `p`; the other
 * end stays fixed. Null when the result would be under 2 points long.
 */
export function moveEndpointOrNull(
  anchor: Point,
  geometry: { dx: number; dy: number },
  handle: 'start' | 'end',
  p: Point,
): LineResult | null {
  const start = handle === 'start' ? p : anchor
  const end = handle === 'start' ? { x: anchor.x + geometry.dx, y: anchor.y + geometry.dy } : p
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (Math.hypot(dx, dy) < MIN_DRAFT) return null
  return { anchor: { x: start.x, y: start.y }, geometry: { dx, dy } }
}

/** `moveEndpointOrNull`, keeping the line as it was when the result would be too short. */
export function moveEndpoint(
  anchor: Point,
  geometry: { dx: number; dy: number },
  handle: 'start' | 'end',
  p: Point,
): LineResult {
  return moveEndpointOrNull(anchor, geometry, handle, p) ?? { anchor, geometry }
}
