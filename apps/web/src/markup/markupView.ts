import { compareCueNumbers, compareReadingOrder } from '@binder/core'
import {
  type Anchor,
  anchorSchema,
  type LayerKind,
  layerKey,
  type NumberFormat,
} from '@binder/shared'
import type { Database } from '../powersync/schema'

/** A local cue row joined with its department, the anchor parsed. */
export type CueRowWithDept = Omit<Database['cues'], 'anchor'> & {
  id: string
  anchor: Anchor
  dept_code: string
  dept_colour: string
  dept_number_format: NumberFormat
  dept_hidden: number
}

/** A local annotation row, the anchor parsed. */
export type AnnotationRow = Omit<Database['annotations'], 'anchor'> & { id: string; anchor: Anchor }

type RawCue = Omit<CueRowWithDept, 'anchor' | 'dept_number_format'> & {
  anchor: string | null
  dept_number_format: string | null
}
type RawAnnotation = Omit<AnnotationRow, 'anchor'> & { anchor: string | null }

function parseAnchor(text: string | null): Anchor | null {
  if (!text) return null
  try {
    const parsed = anchorSchema.safeParse(JSON.parse(text))
    return parsed.success ? (parsed.data as Anchor) : null
  } catch {
    return null
  }
}

function byPage<T extends { anchor: Anchor }>(items: T[]): Map<number, T[]> {
  const map = new Map<number, T[]>()
  for (const item of items) {
    const list = map.get(item.anchor.pageIndex)
    if (list) list.push(item)
    else map.set(item.anchor.pageIndex, [item])
  }
  return map
}

export interface MarkupView {
  cuesByPage: Map<number, CueRowWithDept[]>
  annotationsByPage: Map<number, AnnotationRow[]>
  /** Every shown cue in reading order: what `]` and `[` walk. */
  ordered: CueRowWithDept[]
}

/**
 * What the overlay draws: placed rows on layers the user shows, grouped by page in reading order.
 * Hidden departments' cues stay in the database but are not drawn.
 */
export function groupMarkup(
  cues: readonly RawCue[],
  annotations: readonly RawAnnotation[],
  hidden: ReadonlySet<string>,
): MarkupView {
  const shown = (kind: LayerKind, id: string) => !hidden.has(layerKey({ kind, id }))
  const ordered: CueRowWithDept[] = []
  for (const row of cues) {
    const anchor = parseAnchor(row.anchor)
    if (!anchor || row.dept_hidden || !shown('department', row.department_id ?? '')) continue
    ordered.push({
      ...row,
      anchor,
      dept_number_format: row.dept_number_format === 'point' ? 'point' : 'decimal',
    })
  }
  ordered.sort(
    (a, b) =>
      compareReadingOrder(a.anchor, b.anchor) ||
      a.dept_code.localeCompare(b.dept_code) ||
      compareCueNumbers(
        { major: a.major ?? 0, minor: a.minor ?? 0 },
        { major: b.major ?? 0, minor: b.minor ?? 0 },
      ),
  )
  const shownAnnotations: AnnotationRow[] = []
  for (const row of annotations) {
    const anchor = parseAnchor(row.anchor)
    const kind = row.layer_kind === 'personal' ? 'personal' : 'department'
    if (anchor && shown(kind, row.layer_id ?? '')) shownAnnotations.push({ ...row, anchor })
  }
  return { cuesByPage: byPage(ordered), annotationsByPage: byPage(shownAnnotations), ordered }
}

/** The cue `]` (1) or `[` (-1) moves to from `current`; it stops at either end. */
export function stepCue(
  ids: readonly string[],
  current: string | null,
  dir: 1 | -1,
): string | null {
  if (ids.length === 0) return null
  const at = current === null ? -1 : ids.indexOf(current)
  if (at < 0) return (dir === 1 ? ids[0] : ids.at(-1)) ?? null
  return ids[Math.min(ids.length - 1, Math.max(0, at + dir))] ?? null
}
