import { type CueSize, cueSize } from '@binder/shared'
import { parseSettings } from './stampSettings'

/** How big a department's cue bubbles are, from a show's `settings` JSON text: normal unless it says large. */
export function readCueSize(settings: string | null | undefined, departmentId: string): CueSize {
  return cueSize(parseSettings(settings), departmentId)
}

/** The show's `settings` JSON text with one department's cue size replaced; every other setting is kept. */
export function withCueSize(
  settings: string | null | undefined,
  departmentId: string,
  size: CueSize,
): string {
  const current = parseSettings(settings)
  const sizes = current.cueSizes
  const kept =
    sizes && typeof sizes === 'object' && !Array.isArray(sizes)
      ? (sizes as Record<string, unknown>)
      : {}
  return JSON.stringify({ ...current, cueSizes: { ...kept, [departmentId]: size } })
}
