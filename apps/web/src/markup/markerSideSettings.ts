import { type MarkerSide, markerSide } from '@binder/shared'
import { parseSettings } from './stampSettings'

/** The margin a department's cue tags sit in, from a show's `settings` JSON text: left unless it says right. */
export function readMarkerSide(
  settings: string | null | undefined,
  departmentId: string,
): MarkerSide {
  return markerSide(parseSettings(settings), departmentId)
}

/** The show's `settings` JSON text with one department's side replaced; every other setting is kept. */
export function withMarkerSide(
  settings: string | null | undefined,
  departmentId: string,
  side: MarkerSide,
): string {
  const current = parseSettings(settings)
  const sides = current.markerSides
  const kept =
    sides && typeof sides === 'object' && !Array.isArray(sides)
      ? (sides as Record<string, unknown>)
      : {}
  return JSON.stringify({ ...current, markerSides: { ...kept, [departmentId]: side } })
}
