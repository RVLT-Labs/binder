import type { CueType } from '@binder/shared'

/** The text on a cue marker: `LX 10`, `SB LX 10` for a standby, `W LX 10` for a warning. */
export function markerText(type: CueType, code: string, display: string): string {
  return `${markerLead(type, code)} ${display}`
}

/** The type word on a standby or warning's tag: `SB`, `W`, or empty for a go. */
export function markerTypeWord(type: CueType): string {
  if (type === 'standby') return 'SB'
  if (type === 'warn') return 'W'
  return ''
}

/** The department half of a cue tag: `LX`, `SB LX` for a standby, `W LX` for a warning. */
export function markerLead(type: CueType, code: string): string {
  const word = markerTypeWord(type)
  return word ? `${word} ${code}` : code
}

/** A stored cue type as a `CueType`: anything but standby or warn is a go. */
export function asCueType(type: string | null | undefined): CueType {
  return type === 'standby' || type === 'warn' ? type : 'go'
}

/** A rectangle in displayed page space (points, origin bottom-left): `y` is its bottom edge. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}
