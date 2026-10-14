import { type CueNumber, DEFAULT_BLOCK_SIZE, type NumberFormat } from '@binder/shared'

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Display text: the major alone when the minor is zero, otherwise per the department's format. */
export function formatCueNumber(major: number, minor: number, format: NumberFormat): string {
  if (minor === 0) return String(major)
  if (format === 'point' || minor % 10 !== 0) return `${major}.${pad2(minor)}`
  return `${major}.${minor / 10}`
}

const NUMBER_RE = /^(\d{1,4})(?:\.(\d{1,2}))?$/

/** A decimal with at most two decimal places, read as hundredths: "14.5" is 14 and 50. */
export function parseCueNumber(text: string): CueNumber | null {
  const m = NUMBER_RE.exec(text.trim())
  if (!m) return null
  const major = Number(m[1])
  if (major > 9999) return null
  return { major, minor: m[2] === undefined ? 0 : Number(m[2].padEnd(2, '0')) }
}

export function compareCueNumbers(a: CueNumber, b: CueNumber): number {
  return a.major - b.major || a.minor - b.minor
}

/** Ids of the cues that share a department, major and minor with another cue. */
export function findDuplicateNumbers(
  cues: Array<{ id: string; departmentId: string; major: number; minor: number }>,
): Set<string> {
  const groups = new Map<string, string[]>()
  for (const c of cues) {
    const key = `${c.departmentId}\u0000${c.major}\u0000${c.minor}`
    const ids = groups.get(key)
    if (ids) ids.push(c.id)
    else groups.set(key, [c.id])
  }
  const dupes = new Set<string>()
  for (const ids of groups.values()) if (ids.length > 1) for (const id of ids) dupes.add(id)
  return dupes
}

const toNumber = (v: number): CueNumber => ({ major: Math.floor(v / 100), minor: v % 100 })

/** The multiple of `step` strictly between p and n nearest their midpoint, lower on a tie. */
function nearestMultiple(p: number, n: number, step: number): number | null {
  const lo = (Math.floor(p / step) + 1) * step
  const hi = (Math.ceil(n / step) - 1) * step
  if (lo > hi) return null
  const base = Math.floor((p + n) / 2 / step) * step
  let best: number | null = null
  for (const k of [base, base + step]) {
    if (k < lo || k > hi) continue
    if (best === null || Math.abs(2 * k - (p + n)) < Math.abs(2 * best - (p + n))) best = k
  }
  return best
}

/**
 * The number for a new cue between `prev` and `next` (spec: integers per block, points for
 * insertions). Works in hundredths. A usable `next` is one after `prev`; with none the next integer
 * follows `prev`. When nothing fits between two neighbours the previous number is returned, a
 * duplicate the cue list flags.
 */
export function suggestCueNumber(
  prev: CueNumber | null,
  next: CueNumber | null,
  blockSize: number = DEFAULT_BLOCK_SIZE,
): CueNumber {
  if (!prev && !next) return { major: blockSize, minor: 0 }
  const p = prev ? prev.major * 100 + prev.minor : 0
  const n = next ? next.major * 100 + next.minor : null
  if (n === null || n <= p) return { major: Math.floor(p / 100) + 1, minor: 0 }
  const integer = (Math.floor(p / 100) + 1) * 100
  if (integer < n) return toNumber(integer)
  const found =
    nearestMultiple(p, n, 50) ??
    nearestMultiple(p, n, 10) ??
    (Math.floor((p + n) / 2) > p ? Math.floor((p + n) / 2) : null)
  return found === null ? (prev ?? toNumber(p)) : toNumber(found)
}
