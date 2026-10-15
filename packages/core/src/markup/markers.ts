import type { CueType } from '@binder/shared'

/** The text on a cue marker: `LX 10`, `SB LX 10` for a standby, `W LX 10` for a warning. */
export function markerText(type: CueType, code: string, display: string): string {
  return `${markerLead(type, code)} ${display}`
}

/** The department half of a cue tag: `LX`, `SB LX` for a standby, `W LX` for a warning. */
export function markerLead(type: CueType, code: string): string {
  if (type === 'standby') return `SB ${code}`
  if (type === 'warn') return `W ${code}`
  return code
}

/** A rectangle in displayed page space (points, origin bottom-left): `y` is its bottom edge. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}
