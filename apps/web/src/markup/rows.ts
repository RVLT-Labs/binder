import { type Anchor, anchorSchema } from '@binder/shared'

/** The cue types a local row may hold; anything else is not a cue Binder can show or print. */
export const CUE_TYPES: readonly string[] = ['go', 'standby', 'warn']

/** The annotation types a local row may hold. */
export const ANNOTATION_TYPES: readonly string[] = [
  'note',
  'rect',
  'ellipse',
  'line',
  'arrow',
  'stamp',
  'highlight',
]

/** A JSON column from a local row: its text parsed, an already-parsed value as is, null when it is not JSON. */
export function parseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v ?? null
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}

/** The anchor held by a local row's `anchor` column, or null when it is empty or not a valid anchor. */
export function parseAnchor(v: unknown): Anchor | null {
  const parsed = anchorSchema.safeParse(parseJson(v))
  return parsed.success ? (parsed.data as Anchor) : null
}
