import { compareReadingOrder, formatCueNumber } from '@binder/core'
import type { NumberFormat } from '@binder/shared'

/** What `matchCues` needs of a cue: its department, number and where it sits. */
export interface MatchableCue {
  departmentId: string
  major: number
  minor: number
  anchor: { pageIndex: number; y: number } | null
}

/** What it needs of a department: its code (`LX`) and how its minor numbers are written. */
export interface MatchableDepartment {
  id: string
  code: string
  numberFormat: NumberFormat
}

/** A cue number being typed: digits, optionally followed by a point and more digits ("12", "12.", "12.5"). */
const NUMBER = /^\d+(?:\.\d*)?$/

/**
 * Splits a typed query into a department and a number prefix: "lx 12" is LX and "12", "12" is any
 * department and "12", "lx" is LX and nothing yet. Null when the query is not about cue numbers at all.
 */
export function parseCueQuery(
  query: string,
  departments: readonly MatchableDepartment[],
): { department: MatchableDepartment | null; prefix: string } | null {
  const q = query.trim().toLowerCase()
  if (q === '') return null
  if (NUMBER.test(q)) return { department: null, prefix: q }
  // The longest code first, so "sm2 4" is SM2 and not SM followed by garbage.
  const byLength = [...departments].sort((a, b) => b.code.length - a.code.length)
  for (const department of byLength) {
    const code = department.code.trim().toLowerCase()
    if (code === '' || !q.startsWith(code)) continue
    const rest = q.slice(code.length).trim()
    if (rest === '' || NUMBER.test(rest)) return { department, prefix: rest }
  }
  return null
}

/**
 * The placed cues a typed query points at, in reading order (page, then top to bottom). The
 * department code is optional ("lx 12" or just "12"); the number is a prefix of the formatted
 * number, so "12" finds 12, 12.5 and 120. Cues not on a page are never matched, since there is
 * nowhere to go. The palette and the Calling keypad both use this.
 */
export function matchCues<T extends MatchableCue>(
  query: string,
  cues: readonly T[],
  departments: readonly MatchableDepartment[],
): T[] {
  const parsed = parseCueQuery(query, departments)
  if (!parsed) return []
  const formats = new Map(departments.map((d) => [d.id, d.numberFormat]))
  const out: T[] = []
  for (const cue of cues) {
    if (!cue.anchor) continue
    if (parsed.department && cue.departmentId !== parsed.department.id) continue
    if (!formats.has(cue.departmentId)) continue
    const shown = formatCueNumber(cue.major, cue.minor, formats.get(cue.departmentId) ?? 'decimal')
    if (shown.startsWith(parsed.prefix)) out.push(cue)
  }
  // Array.prototype.sort is stable, so cues that share a spot keep their given order.
  return out.sort((a, b) => (a.anchor && b.anchor ? compareReadingOrder(a.anchor, b.anchor) : 0))
}
