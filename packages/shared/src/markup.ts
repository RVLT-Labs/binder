/** Markup vocabulary shared by the API, the web app, and core (spec 4.4 to 4.11). */

export type NumberFormat = 'decimal' | 'point'
export type CueType = 'go' | 'standby' | 'warn'
export type AnchorStatus = 'ok' | 'approximate' | 'unresolved'

/** How a cue marks its place in the script. An absent mark is `underline`. */
export type CueMark = 'underline' | 'highlight' | 'line' | 'pointer'
export const CUE_MARKS: readonly CueMark[] = ['underline', 'highlight', 'line', 'pointer']

/** Where the cue bubble sits, in points from its default spot. */
export interface BubbleOffset {
  dx: number
  dy: number
}

export function markOf(anchor: { mark?: CueMark } | null | undefined): CueMark {
  return anchor?.mark ?? 'underline'
}

/** A line or pointer mark sits at a character position inside a word. */
export function isCaretMark(m: CueMark): m is 'line' | 'pointer' {
  return m === 'line' || m === 'pointer'
}

/** Word indices into the page's `words`, inclusive. -1 for both means "unbound". */
export interface TextAnchor {
  quote: string
  wordStart: number
  wordEnd: number
  /** Characters into the word at wordStart, for a line or pointer mark. */
  offset?: number
}

export interface Anchor {
  documentId: string
  documentVersionId: string
  pageIndex: number
  x: number
  y: number
  text?: TextAnchor
  mark?: CueMark
  tag?: BubbleOffset
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

/** The re-anchoring review of a document; `currentVersionId` is null while it has no current version. */
export interface ReanchorReview {
  currentVersionId: string | null
  pending: ReviewItem[]
  olderVersions: ReviewItem[]
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
export const QUOTE_MAX_CHARS = 400
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
  { code: 'LX', name: 'Lighting', colour: '#C9811F', numberFormat: 'decimal' },
  { code: 'SND', name: 'Sound', colour: '#2F6BD6', numberFormat: 'decimal' },
  { code: 'TM', name: 'TheatreMix', colour: '#7A5CD0', numberFormat: 'point' },
  { code: 'VID', name: 'Video', colour: '#C2487E', numberFormat: 'decimal' },
  { code: 'SM', name: 'Stage management', colour: '#1C8B83', numberFormat: 'decimal' },
  { code: 'STG', name: 'Stage', colour: '#CC5E2E', numberFormat: 'decimal' },
  { code: 'FLY', name: 'Flys', colour: '#6E8C12', numberFormat: 'decimal' },
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

export type MarkerSide = 'left' | 'right'

/**
 * The page margin a department's cue tags sit in: `settings.markerSides[departmentId]` when it is
 * `'right'`, else `'left'`. Anything malformed falls back to left.
 */
export function markerSide(settings: Record<string, unknown>, departmentId: string): MarkerSide {
  const sides = settings.markerSides
  if (!sides || typeof sides !== 'object' || Array.isArray(sides)) return 'left'
  const side = Object.hasOwn(sides, departmentId)
    ? (sides as Record<string, unknown>)[departmentId]
    : undefined
  return side === 'right' ? 'right' : 'left'
}

export type ConnectorWidth = 'thin' | 'medium' | 'bold'
export type ConnectorPattern = 'solid' | 'dashed' | 'dotted'

/** How a department's connector (the line from a cue's bubble to its mark) is drawn. */
export interface ConnectorStyle {
  width: ConnectorWidth
  pattern: ConnectorPattern
}

/** Today's line: 0.75 pt, plain. */
export const DEFAULT_CONNECTOR_STYLE: Readonly<ConnectorStyle> = Object.freeze({
  width: 'thin',
  pattern: 'solid',
})

const CONNECTOR_WIDTHS: readonly string[] = ['thin', 'medium', 'bold']
const CONNECTOR_PATTERNS: readonly string[] = ['solid', 'dashed', 'dotted']

/**
 * A department's connector style: `settings.connectorStyles[departmentId]`, with a bad or missing
 * width falling back to `thin` and a bad or missing pattern to `solid`. Anything malformed gives
 * the default. Always a fresh object.
 */
export function connectorStyle(
  settings: Record<string, unknown>,
  departmentId: string,
): ConnectorStyle {
  const fallback: ConnectorStyle = { ...DEFAULT_CONNECTOR_STYLE }
  if (!settings || typeof settings !== 'object') return fallback
  const styles = settings.connectorStyles
  if (!styles || typeof styles !== 'object' || Array.isArray(styles)) return fallback
  const entry = Object.hasOwn(styles, departmentId)
    ? (styles as Record<string, unknown>)[departmentId]
    : undefined
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fallback
  const { width, pattern } = entry as Record<string, unknown>
  return {
    width:
      typeof width === 'string' && CONNECTOR_WIDTHS.includes(width)
        ? (width as ConnectorWidth)
        : fallback.width,
    pattern:
      typeof pattern === 'string' && CONNECTOR_PATTERNS.includes(pattern)
        ? (pattern as ConnectorPattern)
        : fallback.pattern,
  }
}
