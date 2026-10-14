import { formatCueNumber } from '@binder/core'
import type { NumberFormat } from '@binder/shared'
import type { AbstractPowerSyncDatabase } from '@powersync/web'

/** The local database, as far as labelling needs it. */
export type LabelDb = Pick<AbstractPowerSyncDatabase, 'getOptional'>

const NOUNS: Record<string, string> = {
  shows: 'show',
  documents: 'document',
  cues: 'cue',
  annotations: 'annotation',
}

const noun = (table: string) => {
  const word = NOUNS[table] ?? `${table} row`
  return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`
}

interface CueLabelRow {
  major: number
  minor: number
  code: string | null
  number_format: NumberFormat | null
}

interface AnnotationLabelRow {
  type: string
  layer_kind: string
  code: string | null
}

async function cueLabel(db: LabelDb, id: string): Promise<string> {
  const cue = await db.getOptional<CueLabelRow>(
    `SELECT c.major, c.minor, d.code, d.number_format
       FROM cues c LEFT JOIN departments d ON d.id = c.department_id
      WHERE c.id = ?`,
    [id],
  )
  if (!cue) return noun('cues')
  const number = formatCueNumber(cue.major, cue.minor, cue.number_format ?? 'decimal')
  return cue.code ? `${cue.code} cue ${number}` : `cue ${number}`
}

async function annotationLabel(db: LabelDb, id: string): Promise<string> {
  const a = await db.getOptional<AnnotationLabelRow>(
    `SELECT a.type, a.layer_kind, d.code
       FROM annotations a
       LEFT JOIN departments d ON a.layer_kind = 'department' AND d.id = a.layer_id
      WHERE a.id = ?`,
    [id],
  )
  if (!a) return noun('annotations')
  if (a.layer_kind === 'personal') return `personal ${a.type}`
  return a.code ? `${a.code} ${a.type}` : a.type
}

/**
 * How a rejection notice names the row it is about, from the local copy: `LX cue 12.5` for a cue,
 * `LX arrow` or `personal highlight` for an annotation, otherwise (or when the row is already gone)
 * the table's noun, `a show`. Never throws.
 */
export async function rowLabel(db: LabelDb, table: string, id: string): Promise<string> {
  try {
    if (table === 'cues') return await cueLabel(db, id)
    if (table === 'annotations') return await annotationLabel(db, id)
  } catch {
    // fall through to the noun
  }
  return noun(table)
}
