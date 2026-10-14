import type { Anchor, CueFields, CueType, NumberFormat } from '@binder/shared'
import { compareReadingOrder } from '../anchors/order'
import { compareCueNumbers, findDuplicateNumbers, formatCueNumber } from './numbering'

export type CueListFlag = 'duplicate' | 'approximate' | 'unresolved' | 'older-version'

export interface CueListRow {
  id: string
  display: string
  type: CueType
  label: string
  page: string
  documentTitle: string
  trigger: string
  notes: string
  flags: CueListFlag[]
  placed: boolean
  anchor: Anchor | null
}

/**
 * The rows of a department's cue list (the cue sheet export uses them too): sorted by
 * `(major, minor)` with placed cues first and unplaced cues in their own trailing group.
 */
export function cueListRows(
  cues: Array<CueFields & { id: string }>,
  departments: Array<{ id: string; code: string; numberFormat: NumberFormat }>,
  documents: Array<{ id: string; title: string; currentVersionId: string | null }>,
): CueListRow[] {
  const formats = new Map(departments.map((d) => [d.id, d.numberFormat]))
  const titles = new Map(documents.map((d) => [d.id, d]))
  const duplicates = findDuplicateNumbers(cues)

  const docsByDepartment = new Map<string, Set<string>>()
  for (const c of cues) {
    if (!c.anchor) continue
    const set = docsByDepartment.get(c.departmentId) ?? new Set<string>()
    set.add(c.anchor.documentId)
    docsByDepartment.set(c.departmentId, set)
  }

  const rows = [...cues]
    .sort(
      (a, b) =>
        Number(a.anchor === null) - Number(b.anchor === null) ||
        compareCueNumbers(a, b) ||
        (a.anchor && b.anchor ? compareReadingOrder(a.anchor, b.anchor) : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((c): CueListRow => {
      const a = c.anchor
      const multi = (docsByDepartment.get(c.departmentId)?.size ?? 0) > 1
      const doc = a ? titles.get(a.documentId) : undefined
      const documentTitle = multi && doc ? doc.title : ''
      const flags: CueListFlag[] = []
      if (duplicates.has(c.id)) flags.push('duplicate')
      if (a?.status === 'approximate') flags.push('approximate')
      if (a?.status === 'unresolved') flags.push('unresolved')
      if (
        a &&
        doc &&
        doc.currentVersionId !== null &&
        a.documentVersionId !== doc.currentVersionId
      ) {
        flags.push('older-version')
      }
      const pageText = a ? `p.${a.pageIndex + 1}` : '—'
      return {
        id: c.id,
        display: formatCueNumber(c.major, c.minor, formats.get(c.departmentId) ?? 'decimal'),
        type: c.type,
        label: c.label,
        page: documentTitle ? `${documentTitle} ${pageText}` : pageText,
        documentTitle,
        trigger: a?.text && a.text.wordStart >= 0 ? a.text.quote : '',
        notes: c.notes,
        flags,
        placed: a !== null,
        anchor: a,
      }
    })
  return rows
}
