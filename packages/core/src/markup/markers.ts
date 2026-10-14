import type { CueType } from '@binder/shared'

/** The text on a cue marker: `LX 10`, `SB LX 10` for a standby, `W LX 10` for a warning. */
export function markerText(type: CueType, code: string, display: string): string {
  const base = `${code} ${display}`
  if (type === 'standby') return `SB ${base}`
  if (type === 'warn') return `W ${base}`
  return base
}

export interface MarkerStyle {
  fill: 'solid' | 'none'
  stroke: 'none' | 'solid' | 'dashed'
}

/** How a marker is drawn, shared by the screen overlay and print stamping. */
export function markerStyle(type: CueType): MarkerStyle {
  if (type === 'standby') return { fill: 'none', stroke: 'dashed' }
  if (type === 'warn') return { fill: 'none', stroke: 'solid' }
  return { fill: 'solid', stroke: 'none' }
}

/** A rectangle in displayed page space (points, origin bottom-left): `y` is its bottom edge. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export const MARKER_HEIGHT = 14
export const MARKER_PADDING = 8

/** A cue marker's box: its left edge at `x`, vertically centred on `y`, 8 wider than its text. */
export function cueMarkerBox(x: number, y: number, textWidth: number): Box {
  return { x, y: y - MARKER_HEIGHT / 2, w: textWidth + MARKER_PADDING, h: MARKER_HEIGHT }
}
