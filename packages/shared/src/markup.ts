/** Markup vocabulary shared by the API, the web app, and core (spec 4.4 to 4.11). */

export type NumberFormat = 'decimal' | 'point'
export type CueType = 'go' | 'standby' | 'warn'
export type AnchorStatus = 'ok' | 'approximate' | 'unresolved'

/** Word indices into the page's `words`, inclusive. -1 for both means "unbound". */
export interface TextAnchor {
  quote: string
  wordStart: number
  wordEnd: number
}

export interface Anchor {
  documentId: string
  documentVersionId: string
  pageIndex: number
  x: number
  y: number
  text?: TextAnchor
  status: AnchorStatus
}

/**
 * One cue or annotation in the re-anchoring review (spec 5.4). `previous` is the anchor the row had
 * before the most recent re-anchoring run moved it, or null when no run ever moved it. `title` is
 * `LX 12 · Fly out` for a cue and `note · first words` for an annotation.
 */
export interface ReviewItem {
  table: 'cues' | 'annotations'
  rowId: string
  /** A layer key: `department:<id>`, or `personal:<your user id>`. */
  layer: string
  title: string
  anchor: Anchor
  previous: Anchor | null
}

export interface CueNumber {
  major: number
  minor: number
}

export type LayerKind = 'department' | 'personal'

/** A department id or, for a personal layer, the owning user's id. */
export interface LayerRef {
  kind: LayerKind
  id: string
}

export type AnnotationType = 'note' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'stamp' | 'highlight'

const LAYER_KINDS: readonly LayerKind[] = ['department', 'personal']

export function layerKey(l: LayerRef): string {
  return `${l.kind}:${l.id}`
}

export function parseLayerKey(k: string): LayerRef | null {
  const colon = k.indexOf(':')
  if (colon < 0) return null
  const kind = k.slice(0, colon)
  const id = k.slice(colon + 1)
  if (!id || !LAYER_KINDS.includes(kind as LayerKind)) return null
  return { kind: kind as LayerKind, id }
}

export const SNAP_DISTANCE_PT = 12
export const QUOTE_MAX_WORDS = 8
export const DEFAULT_BLOCK_SIZE = 10
export const PERSONAL_LAYER_COLOUR = '#6B7280'
export const DEFAULT_STAMPS = [
  'Enter',
  'Exit',
  'Fly in',
  'Fly out',
  'Blackout',
  'Standby',
  'Go',
] as const

export interface DefaultDepartment {
  code: string
  name: string
  colour: string
  numberFormat: NumberFormat
}

/** Seeded into every new show, in this order; the sort order is the index times ten. */
export const DEFAULT_DEPARTMENTS: readonly DefaultDepartment[] = [
  { code: 'LX', name: 'Lighting', colour: '#F5A623', numberFormat: 'decimal' },
  { code: 'SND', name: 'Sound', colour: '#4A90E2', numberFormat: 'decimal' },
  { code: 'TM', name: 'TheatreMix', colour: '#9B51E0', numberFormat: 'point' },
  { code: 'VID', name: 'Video', colour: '#2BB0A6', numberFormat: 'decimal' },
  { code: 'SM', name: 'Stage management', colour: '#D0021B', numberFormat: 'decimal' },
  { code: 'STG', name: 'Stage', colour: '#8B572A', numberFormat: 'decimal' },
  { code: 'FLY', name: 'Flys', colour: '#417505', numberFormat: 'decimal' },
]

/** A department code: a letter then up to seven letters or digits, upper case. */
export const DEPARTMENT_CODE_RE = /^[A-Z][A-Z0-9]{0,7}$/
export const DEPARTMENT_NAME_MAX = 60
export const COLOUR_RE = /^#[0-9A-Fa-f]{6}$/

/** The writable fields of a cue (spec 4.4); the web mutations, print and services all use it. */
export interface CueFields {
  departmentId: string
  major: number
  minor: number
  label: string
  type: CueType
  notes: string
  colour: string | null
  anchor: Anchor | null
}

/** The writable fields of an annotation (spec 4.4). Geometry is in points, relative to the anchor. */
export interface AnnotationFields {
  layerKind: LayerKind
  layerId: string
  anchor: Anchor
  type: AnnotationType
  geometry: Record<string, number>
  text: string
  style: Record<string, unknown>
}

/** The show's stamp choices: `settings.stampSet` when it is a non-empty list of strings, else the defaults. */
export function stampSet(settings: Record<string, unknown>): string[] {
  const set = settings.stampSet
  if (Array.isArray(set) && set.length > 0 && set.every((s) => typeof s === 'string')) {
    return [...(set as string[])]
  }
  return [...DEFAULT_STAMPS]
}

export type PaperSize = 'A4' | 'Letter'

/** The paper cue sheets are laid out for: `settings.paperSize` when it is `'A4'` or `'Letter'`, else `'A4'`. */
export function paperSize(settings: Record<string, unknown>): PaperSize {
  return settings.paperSize === 'Letter' ? 'Letter' : 'A4'
}
