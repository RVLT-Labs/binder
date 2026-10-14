const pad = (n: number) => String(n).padStart(2, '0')

/** `HH:mm` in the viewer's local time, from an ISO timestamp. */
export function formatClock(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `YYYY-MM-DD` in the viewer's local time. */
export function localDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** `Today`, `Yesterday`, or the local date, for a heading over a day's changes. */
export function dayHeading(iso: string, now: Date = new Date()): string {
  const day = localDay(iso)
  if (day === localDay(now.toISOString())) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (day === localDay(yesterday.toISOString())) return 'Yesterday'
  return day
}

/** The clock time, with the date in front of it unless the change was today. */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const clock = formatClock(iso)
  return localDay(iso) === localDay(now.toISOString()) ? clock : `${localDay(iso)} ${clock}`
}
