import { stampSet } from '@binder/shared'

export const STAMP_NAME_MAX = 40

/** A show's `settings` JSON text as a record; anything unreadable is empty. */
export function parseSettings(settings: string | null | undefined): Record<string, unknown> {
  try {
    const value = settings ? JSON.parse(settings) : {}
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

/** The stamps a show offers, from its `settings` JSON text: its own set, else the defaults. */
export function readStamps(settings: string | null | undefined): string[] {
  return stampSet(parseSettings(settings))
}

/** The show's `settings` JSON text with its stamp set replaced; every other setting is kept. */
export function withStamps(settings: string | null | undefined, stamps: string[]): string {
  return JSON.stringify({ ...parseSettings(settings), stampSet: stamps })
}

/** Why `name` cannot join a set that already holds `others`, or null. A stamp is 1 to 40 characters. */
export function checkStampName(name: string, others: readonly string[]): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Give the stamp a name.'
  if (trimmed.includes('\u0000')) return 'That name has a character that can’t be stored.'
  if (trimmed.length > STAMP_NAME_MAX)
    return `A stamp name is at most ${STAMP_NAME_MAX} characters.`
  if (others.includes(trimmed)) return 'That stamp is already in the set.'
  return null
}
