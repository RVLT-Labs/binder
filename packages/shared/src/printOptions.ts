import { z } from 'zod'
import type { PaperSize } from './markup'

/** What a script print does beyond the layers: which pages, which paper, and what to include. */
export interface PrintOptions {
  /** `'all'`, or a normalised 1-based page list such as `1-5, 8`. */
  pages: 'all' | string
  /** Absent means leave every page as it is; otherwise each page is fitted to this paper. */
  paper?: PaperSize
  includeStandbyWarn: boolean
  includeAnnotations: boolean
  includeCueNotes: boolean
}

type Interval = [from: number, to: number]

const PART = /^(\d+)(?:[-–—](\d+))?$/

/** The 1-based, inclusive intervals of a page range, or null when it is not one. Not merged. */
function intervals(text: string): Interval[] | null {
  const out: Interval[] = []
  for (const raw of text.split(',')) {
    const part = raw.trim().replace(/\s*([-–—])\s*/, '$1')
    const m = PART.exec(part)
    if (!m) return null
    const from = Number(m[1])
    const to = m[2] === undefined ? from : Number(m[2])
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from)
      return null
    out.push([from, to])
  }
  return out.length > 0 ? out : null
}

/** Sorts intervals and joins any that overlap or touch. */
function merged(parts: Interval[]): Interval[] {
  const out: Interval[] = []
  for (const [from, to] of [...parts].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = out.at(-1)
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to)
    else out.push([from, to])
  }
  return out
}

export type PageRangeResult =
  | { ok: true; indices: number[] }
  | { ok: false; reason: 'syntax' | 'beyond'; message: string }

/**
 * The pages a range text names, as ascending, de-duplicated zero-based indices. `N`, `N-M` (hyphen,
 * en dash or em dash) and comma-separated lists of them, spaces allowed. A page past the end of the
 * script is an error, never clamped.
 */
export function parsePageRange(text: string, pageCount: number): PageRangeResult {
  const parts = intervals(text)
  if (!parts) {
    return {
      ok: false,
      reason: 'syntax',
      message: `Pages look like 1–${Math.max(pageCount, 1)} or 3, 7–9.`,
    }
  }
  const spans = merged(parts)
  if ((spans.at(-1) as Interval)[1] > pageCount) {
    return {
      ok: false,
      reason: 'beyond',
      message: `This script has ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}.`,
    }
  }
  const indices: number[] = []
  for (const [from, to] of spans) for (let p = from; p <= to; p++) indices.push(p - 1)
  return { ok: true, indices }
}

/** The canonical ASCII text of a page range (`1-5, 8`, merged and sorted), or null when it is not one. */
export function normalisePageRange(text: string): string | null {
  const parts = intervals(text)
  if (!parts) return null
  return merged(parts)
    .map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`))
    .join(', ')
}

const MAX_FILENAME = 200
const UNSAFE_REASON = `File names can't contain / \\ : * ? " < > |`
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are the point
const UNSAFE_CHARS = /[/\\:*?"<>|\u0000-\u001f\u007f]/
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export type FilenameResult = { ok: true; name: string } | { ok: false; reason: string }

/**
 * Checks a file name for a script export and gives the name to use. A trailing `.pdf` (any case) is
 * dropped and one is put back, so the field can show or hide it. At most 200 characters in all.
 */
export function validateExportFilename(raw: string): FilenameResult {
  const trimmed = raw.trim()
  const stem = trimmed.replace(/\.pdf$/i, '')
  if (stem === '') return { ok: false, reason: 'Give the file a name.' }
  if (UNSAFE_CHARS.test(stem)) return { ok: false, reason: UNSAFE_REASON }
  if (stem.startsWith('.') || stem.endsWith('.') || stem !== stem.trim()) {
    return { ok: false, reason: "File names can't start or end with a dot or a space." }
  }
  if (RESERVED.test(stem.split('.')[0] as string)) {
    return { ok: false, reason: `"${stem}" is reserved by Windows. Pick another name.` }
  }
  if (stem.length + 4 > MAX_FILENAME) {
    return { ok: false, reason: `Keep the name under ${MAX_FILENAME - 4} characters.` }
  }
  return { ok: true, name: `${stem}.pdf` }
}

function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Department codes keep their case; anything outside letters and digits becomes a hyphen. */
function codeSlug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** The layers part of a script file name, from what `layerSelectionLabel` says. */
function layerSlug(label: string): string {
  if (label === 'Clean copy') return 'clean'
  const parts = label
    .split(/\s*[,+]\s*/)
    .map((p) => (/^(all layers|personal)$/i.test(p) ? slug(p) : codeSlug(p)))
    .filter((p) => p !== '')
  return parts.join('-') || 'clean'
}

/**
 * The default file name of a script export, in the mockup's slug form:
 * `songs-for-a-new-world-libretto-v2-LX-SND-TM.pdf`. The one copy both the server and the browser
 * use. `layerLabel` is what `layerSelectionLabel` gives for the chosen layers.
 */
export function scriptExportFilename(parts: {
  show: string
  document: string
  versionNumber: number
  layerLabel: string
}): string {
  const tail = `v${parts.versionNumber}-${layerSlug(parts.layerLabel)}`
  const room = MAX_FILENAME - '.pdf'.length - tail.length - 2
  // The show and the document share what the layers and version leave of the 200 characters.
  const half = Math.max(8, Math.floor(room / 2))
  const show = (slug(parts.show) || 'untitled').slice(0, half).replace(/-+$/, '')
  const doc = (slug(parts.document) || 'untitled').slice(0, Math.max(8, room - show.length))
  return `${show}-${doc.replace(/-+$/, '')}-${tail}.pdf`.slice(0, MAX_FILENAME)
}

export const printOptionsSchema = z.object({
  pages: z
    .union([
      z.literal('all'),
      z
        .string()
        .max(MAX_FILENAME)
        .refine((s) => normalisePageRange(s) === s, 'Pages look like 1-43 or 3, 7-9.'),
    ])
    .default('all'),
  paper: z.enum(['A4', 'Letter']).optional(),
  includeStandbyWarn: z.boolean().default(true),
  includeAnnotations: z.boolean().default(true),
  includeCueNotes: z.boolean().default(true),
})
