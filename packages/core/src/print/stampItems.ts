import {
  type Anchor,
  type AnnotationFields,
  type AnnotationType,
  type CueFields,
  type CueType,
  type LayerRef,
  layerKey,
  type MarkerSide,
  markerSide,
  type NumberFormat,
  PERSONAL_LAYER_COLOUR,
  type WordLayer,
} from '@binder/shared'
import { formatCueNumber } from '../cues/numbering'
import { DEFAULT_NOTE_FONT, DEFAULT_STAMP_FONT, DEFAULT_STROKE } from '../markup/annotationLayout'
import { type TextExtent, textExtent } from '../markup/cueTags'
import { type Box, markerLead, markerTypeWord } from '../markup/markers'
import { wordBoxes } from '../markup/wordBoxes'

/** The page's ink: the cue tag number. The same value as the `--page-ink` token on screen. */
export const PAGE_INK = '#1A1715'

/** One thing to draw on a script page, in displayed page space (points, origin bottom-left). */
export type StampItem =
  | {
      kind: 'cue'
      id: string
      pageIndex: number
      /** The anchor: where an unbound cue's tick stands. */
      x: number
      /** The anchor's y: the tag is level with it. */
      y: number
      type: CueType
      /** The department half of the tag (`LX`, `SB LX`, `W LX`) and the formatted cue number. */
      lead: string
      /** The type word alone (`SB`, `W`, or empty): what the lead shrinks to in a narrow margin. */
      typeWord: string
      number: string
      /** The tag number's ink: dark page ink, not the department colour. */
      numberInk: string
      colour: string
      /** The page margin the department's tags sit in. */
      side: MarkerSide
      /** Crowded tags are laid out in this order: department sort order, then cue number. */
      sortKey: { department: number; major: number; minor: number }
      /** The trigger words' boxes, one per line; empty when unbound or the page's words are unknown. */
      triggerBoxes: Box[]
      /** The page's text block, which tags stay out of; null when its words are unknown. */
      textExtent: TextExtent | null
    }
  | {
      kind: 'annotation'
      pageIndex: number
      x: number
      y: number
      type: AnnotationType
      geometry: Record<string, number>
      /** The note or stamp text; for a highlight, its quote. */
      text: string
      colour: string
      strokeWidth: number
      fontSize: number
      /** A highlight's rectangles, one per covered line; empty when its words are not bound. */
      wordBoxes: Box[]
    }

export interface StampInput {
  versionId: string
  layers: LayerRef[]
  cues: Array<CueFields & { id: string }>
  annotations: Array<AnnotationFields & { id: string }>
  departments: Array<{
    id: string
    code: string
    colour: string
    numberFormat: NumberFormat
    sortOrder: number
  }>
  /** The show's settings: `markerSides` says which margin each department's tags sit in. */
  settings: Record<string, unknown>
  /** The word layers of the pages that have a bound cue or highlight, by page index. */
  wordLayers: ReadonlyMap<number, WordLayer>
}

const onVersion = (a: Anchor | null, versionId: string): a is Anchor =>
  a !== null && a.documentVersionId === versionId

const asNumber = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

/**
 * What to stamp for one document version: the annotations, then the cues (so markers sit on
 * top), only those anchored on `versionId` and in the selected layers. A cue takes its
 * department's colour as on screen; an annotation its own style colour, else its layer's.
 */
export function buildStampItems(input: StampInput): StampItem[] {
  const selected = new Set(input.layers.map(layerKey))
  const departments = new Map(input.departments.map((d) => [d.id, d]))
  const items: StampItem[] = []

  for (const a of input.annotations) {
    if (!onVersion(a.anchor, input.versionId)) continue
    if (!selected.has(layerKey({ kind: a.layerKind, id: a.layerId }))) continue
    const dept = a.layerKind === 'department' ? departments.get(a.layerId) : undefined
    if (a.layerKind === 'department' && !dept) continue
    const style = a.style as { colour?: unknown; strokeWidth?: unknown; fontSize?: unknown }
    const layerColour = dept?.colour ?? PERSONAL_LAYER_COLOUR
    const text = a.type === 'highlight' ? (a.anchor.text?.quote ?? '') : a.text
    const words = input.wordLayers.get(a.anchor.pageIndex)
    items.push({
      kind: 'annotation',
      pageIndex: a.anchor.pageIndex,
      x: a.anchor.x,
      y: a.anchor.y,
      type: a.type,
      geometry: a.geometry,
      text,
      colour: typeof style.colour === 'string' ? style.colour : layerColour,
      strokeWidth: asNumber(style.strokeWidth) ?? DEFAULT_STROKE,
      fontSize:
        asNumber(style.fontSize) ?? (a.type === 'stamp' ? DEFAULT_STAMP_FONT : DEFAULT_NOTE_FONT),
      wordBoxes:
        a.type === 'highlight' && words && a.anchor.text ? wordBoxes(words, a.anchor.text) : [],
    })
  }

  for (const c of input.cues) {
    if (!onVersion(c.anchor, input.versionId)) continue
    if (!selected.has(layerKey({ kind: 'department', id: c.departmentId }))) continue
    const dept = departments.get(c.departmentId)
    if (!dept) continue
    const words = input.wordLayers.get(c.anchor.pageIndex)
    items.push({
      kind: 'cue',
      id: c.id,
      pageIndex: c.anchor.pageIndex,
      x: c.anchor.x,
      y: c.anchor.y,
      type: c.type,
      lead: markerLead(c.type, dept.code),
      typeWord: markerTypeWord(c.type),
      number: formatCueNumber(c.major, c.minor, dept.numberFormat),
      numberInk: PAGE_INK,
      colour: dept.colour,
      side: markerSide(input.settings, dept.id),
      sortKey: { department: dept.sortOrder, major: c.major, minor: c.minor },
      triggerBoxes: words && c.anchor.text ? wordBoxes(words, c.anchor.text) : [],
      textExtent: textExtent(words),
    })
  }
  return items
}
