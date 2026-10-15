import {
  type Anchor,
  type AnnotationFields,
  type AnnotationType,
  type CueFields,
  type CueType,
  type LayerRef,
  layerKey,
  type NumberFormat,
  PERSONAL_LAYER_COLOUR,
  type WordLayer,
} from '@binder/shared'
import { formatCueNumber } from '../cues/numbering'
import { DEFAULT_NOTE_FONT, DEFAULT_STAMP_FONT, DEFAULT_STROKE } from '../markup/annotationLayout'
import { type Box, markerText } from '../markup/markers'
import { wordBoxes } from '../markup/wordBoxes'

/** One thing to draw on a script page, in displayed page space (points, origin bottom-left). */
export type StampItem =
  | {
      kind: 'cue'
      pageIndex: number
      x: number
      y: number
      type: CueType
      boxText: string
      labelText: string
      colour: string
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
  departments: Array<{ id: string; code: string; colour: string; numberFormat: NumberFormat }>
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
    items.push({
      kind: 'cue',
      pageIndex: c.anchor.pageIndex,
      x: c.anchor.x,
      y: c.anchor.y,
      type: c.type,
      boxText: markerText(c.type, dept.code, formatCueNumber(c.major, c.minor, dept.numberFormat)),
      labelText: c.label,
      colour: dept.colour,
    })
  }
  return items
}
