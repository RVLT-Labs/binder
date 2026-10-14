import { formatCueNumber } from '@binder/core'
import type { HistoryEntry, NumberFormat } from '@binder/shared'

export interface ChangeContext {
  /** The code of the department the change was made in, or null when there is none to show. */
  departmentCode: string | null
  numberFormat: NumberFormat
  /**
   * The cue's number as it stood after this change. A log row holds only the columns that changed,
   * so a minor-only edit does not carry its major; this fills the gap.
   */
  numberAfter?: { major: number; minor: number }
  /** Names a layer for `Layer Personal → LX`; null (or absent) falls back to a generic phrase. */
  layerName?: (kind: string, id: string | null) => string | null
}

/** Columns every write touches that say nothing about what the user did. */
const BOOKKEEPING = new Set(['id', 'showId', 'createdAt', 'updatedAt', 'updatedBy'])

type Columns = Record<string, unknown>

function anchorOf(value: unknown): { pageIndex: number | null } | null {
  let v = value
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  if (typeof v !== 'object' || v === null) return null
  const { pageIndex } = v as { pageIndex?: unknown }
  return { pageIndex: typeof pageIndex === 'number' ? pageIndex : null }
}

const page = (a: { pageIndex: number | null }) => (a.pageIndex === null ? null : a.pageIndex + 1)

function placedLine(value: unknown): string {
  const a = anchorOf(value)
  if (!a) return 'Added (unplaced)'
  const p = page(a)
  return p === null ? 'Placed' : `Placed on p.${p}`
}

function anchorLine(before: unknown, after: unknown): string {
  const from = anchorOf(before)
  const to = anchorOf(after)
  if (!to) return 'Unplaced'
  const toPage = page(to)
  if (!from) return toPage === null ? 'Placed' : `Placed on p.${toPage}`
  const fromPage = page(from)
  if (toPage === null) return 'Moved'
  if (fromPage === null || fromPage === toPage) return `Moved on p.${toPage}`
  return `Moved p.${fromPage} → p.${toPage}`
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function numberLine(before: Columns, after: Columns, ctx: ChangeContext): string {
  const pick = (side: Columns, key: 'major' | 'minor', other: Columns): number | undefined => {
    for (const source of [side[key], other[key], ctx.numberAfter?.[key]]) {
      if (isNumber(source)) return source
    }
    return undefined
  }
  const parts = {
    beforeMajor: pick(before, 'major', after),
    beforeMinor: pick(before, 'minor', after),
    afterMajor: pick(after, 'major', before),
    afterMinor: pick(after, 'minor', before),
  }
  if (
    parts.beforeMajor === undefined ||
    parts.beforeMinor === undefined ||
    parts.afterMajor === undefined ||
    parts.afterMinor === undefined
  ) {
    return 'Renumbered'
  }
  const prefix = ctx.departmentCode ? `${ctx.departmentCode} ` : ''
  const was = formatCueNumber(parts.beforeMajor, parts.beforeMinor, ctx.numberFormat)
  const now = formatCueNumber(parts.afterMajor, parts.afterMinor, ctx.numberFormat)
  return `Renumbered ${prefix}${was} → ${prefix}${now}`
}

const text = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

function layerLine(before: Columns, after: Columns, ctx: ChangeContext): string {
  const kind = (side: Columns, other: Columns) =>
    text(side.layerKind ?? other.layerKind) === 'personal' ? 'personal' : 'department'
  const name = (side: Columns, other: Columns) => {
    const k = kind(side, other)
    if (k === 'personal') return 'Personal'
    const id = typeof (side.layerId ?? null) === 'string' ? (side.layerId as string) : null
    return ctx.layerName?.(k, id) ?? 'a department layer'
  }
  return `Layer ${name(before, after)} → ${name(after, before)}`
}

function cueLines(before: Columns, after: Columns, keys: Set<string>, ctx: ChangeContext) {
  const lines: string[] = []
  const handled = new Set<string>()
  const take = (...names: string[]) => {
    const hit = names.some((n) => keys.has(n))
    for (const n of names) handled.add(n)
    return hit
  }
  if (take('anchor')) lines.push(anchorLine(before.anchor, after.anchor))
  if (take('major', 'minor')) lines.push(numberLine(before, after, ctx))
  if (take('label')) lines.push(`Label "${text(before.label)}" → "${text(after.label)}"`)
  if (take('type')) lines.push(`Type ${text(before.type)} → ${text(after.type)}`)
  if (take('notes')) lines.push('Notes edited')
  if (take('departmentId')) lines.push('Department changed')
  if (take('colour')) lines.push('Colour changed')
  return { lines, handled }
}

function annotationLines(before: Columns, after: Columns, keys: Set<string>, ctx: ChangeContext) {
  const lines: string[] = []
  const handled = new Set<string>()
  const take = (...names: string[]) => {
    const hit = names.some((n) => keys.has(n))
    for (const n of names) handled.add(n)
    return hit
  }
  if (take('anchor')) lines.push(anchorLine(before.anchor, after.anchor))
  if (take('text')) lines.push('Text edited')
  if (take('geometry')) lines.push('Resized')
  if (take('style')) lines.push('Restyled')
  if (take('type')) lines.push(`Type ${text(before.type)} → ${text(after.type)}`)
  if (take('layerKind', 'layerId')) lines.push(layerLine(before, after, ctx))
  return { lines, handled }
}

/**
 * The lines one change log entry reads as in a history list ("Moved p.9 → p.10", "Label "Fly out" →
 * "Fly in""). Total over any entry: unknown columns read as "Edited", a missing before or after is
 * tolerated, and a redacted personal layer id (null) is just a layer with no name.
 */
export function formatChange(entry: HistoryEntry, ctx: ChangeContext): string[] {
  const before = entry.before ?? {}
  const after = entry.after ?? {}
  const cues = entry.table === 'cues'
  const annotations = entry.table === 'annotations'

  if (entry.op === 'delete') return ['Deleted']
  if (entry.op === 'insert') {
    return cues || annotations ? [placedLine(after.anchor)] : ['Added']
  }
  if (!cues && !annotations) return ['Edited']

  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const k of BOOKKEEPING) keys.delete(k)
  const { lines, handled } = cues
    ? cueLines(before, after, keys, ctx)
    : annotationLines(before, after, keys, ctx)
  if ([...keys].some((k) => !handled.has(k)) || lines.length === 0) lines.push('Edited')
  return lines
}
