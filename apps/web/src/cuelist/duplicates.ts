import { findDuplicateNumbers } from '@binder/core'

export interface DuplicateStats {
  /** How many distinct numbers are used more than once ("LX has 2 duplicate numbers"). */
  numbers: number
  /** How many cues share a number with another cue (what the cue list flags). */
  cues: number
}

interface NumberedCue {
  id: string
  departmentId: string
  major: number
  minor: number
}

/**
 * Duplicate cue numbers per department, from one place so the cue list and the show overview
 * always agree. A duplicate is the same department, major and minor on two or more cues
 * (`findDuplicateNumbers`, which also drives the cue list's "Duplicate" flag). Departments with
 * none are left out of the map.
 */
export function duplicateStats(cues: readonly NumberedCue[]): Map<string, DuplicateStats> {
  const flagged = findDuplicateNumbers([...cues])
  const numbers = new Map<string, Set<string>>()
  const counts = new Map<string, number>()
  for (const c of cues) {
    if (!flagged.has(c.id)) continue
    const set = numbers.get(c.departmentId) ?? new Set<string>()
    set.add(`${c.major}\u0000${c.minor}`)
    numbers.set(c.departmentId, set)
    counts.set(c.departmentId, (counts.get(c.departmentId) ?? 0) + 1)
  }
  const out = new Map<string, DuplicateStats>()
  for (const [departmentId, set] of numbers) {
    out.set(departmentId, { numbers: set.size, cues: counts.get(departmentId) ?? 0 })
  }
  return out
}
