const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * A short, human "when": "12 min ago", "5 h ago", "2 d ago", then a date ("2 Oct", with the year
 * when it is not this one). Empty for a missing or unreadable time.
 */
export function timeAgo(iso: string | null | undefined, now: Date): string {
  if (!iso) return ''
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const age = now.getTime() - then.getTime()
  if (age < MINUTE) return 'just now'
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min ago`
  if (age < DAY) return `${Math.floor(age / HOUR)} h ago`
  if (age < 7 * DAY) return `${Math.floor(age / DAY)} d ago`
  return then.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: then.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}
