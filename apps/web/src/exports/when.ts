import { localDay } from '../history/time'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

export interface WhenPart {
  text: string
  /** Numbers read in mono (the clock, the day of the month). */
  mono?: boolean
}

/**
 * When an export was made, as the exports mockup writes it: "today 14:02", "yesterday 22:51", "12 Oct",
 * and with the year once it is from an earlier one. In the viewer's local time.
 */
export function whenParts(iso: string, now: Date = new Date()): WhenPart[] {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return []
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const day = localDay(iso)
  if (day === localDay(now.toISOString())) return [{ text: 'today ' }, { text: clock, mono: true }]
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (day === localDay(yesterday.toISOString()))
    return [{ text: 'yesterday ' }, { text: clock, mono: true }]
  const parts: WhenPart[] = [
    { text: String(d.getDate()), mono: true },
    { text: ` ${MONTHS[d.getMonth()]}` },
  ]
  if (d.getFullYear() !== now.getFullYear()) parts.push({ text: ` ${d.getFullYear()}` })
  return parts
}

/** The text of a file's tile: its extension in capitals (PDF, CSV, XLSX), or FILE. */
export function fileTypeOf(filename: string | null): string {
  const dot = filename?.lastIndexOf('.') ?? -1
  if (!filename || dot < 0 || dot === filename.length - 1) return 'FILE'
  return filename.slice(dot + 1).toUpperCase()
}
