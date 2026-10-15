import type { LayerRef } from '@binder/shared'

export interface FooterInfo {
  showTitle: string
  /** The document and its version label, e.g. `Libretto v2`. */
  documentLabel: string
  /** The layer selection, from `layerSelectionLabel`. */
  layerLabel: string
  /** The Binder version the export was made from; null when it was not saved as one. */
  binderVersion: number | null
  exportId: string
  date: Date
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** The footer line: `Show · Document · Layers · Binder v3 · 2026-10-15 14:02` (the date in local time). */
export function footerText(f: FooterInfo): string {
  const d = f.date
  const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  const source =
    f.binderVersion === null ? `export ${f.exportId.slice(-8)}` : `Binder v${f.binderVersion}`
  return [f.showTitle, f.documentLabel, f.layerLabel, source, stamp].join(' · ')
}

/**
 * What the footer says about the layers on the page: `Clean copy` for none, `All layers` when
 * every department is in, otherwise the department codes in department order, plus ` + personal`.
 */
export function layerSelectionLabel(
  sel: LayerRef[],
  departments: Array<{ id: string; code: string }>,
): string {
  const picked = new Set(sel.filter((l) => l.kind === 'department').map((l) => l.id))
  const personal = sel.some((l) => l.kind === 'personal')
  if (picked.size === 0 && !personal) return 'Clean copy'
  if (departments.length > 0 && departments.every((d) => picked.has(d.id))) return 'All layers'
  const codes = departments.filter((d) => picked.has(d.id)).map((d) => d.code)
  if (codes.length === 0) return 'Personal'
  return codes.join(', ') + (personal ? ' + personal' : '')
}
