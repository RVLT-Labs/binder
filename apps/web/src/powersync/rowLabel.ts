import { formatCueNumber } from '@binder/core'
import type { NumberFormat } from '@binder/shared'
import type { AbstractPowerSyncDatabase } from '@powersync/web'

/** The local database, as far as labelling needs it. */
export type LabelDb = Pick<AbstractPowerSyncDatabase, 'getOptional'>

const NOUNS: Record<string, string> = { shows: 'show', documents: 'document', cues: 'cue' }

const noun = (table: string) => `a ${NOUNS[table] ?? `${table} row`}`

interface CueLabelRow {
  major: number
  minor: number
  code: string | null
  number_format: NumberFormat | null
}

/**
 * How a rejection notice names the row it is about, from the local copy: `LX cue 12.5` for a cue,
 * otherwise (or when the row is already gone) the table's noun, `a show`. Never throws.
 */
export async function rowLabel(db: LabelDb, table: string, id: string): Promise<string> {
  if (table !== 'cues') return noun(table)
  try {
    const cue = await db.getOptional<CueLabelRow>(
      `SELECT c.major, c.minor, d.code, d.number_format
         FROM cues c LEFT JOIN departments d ON d.id = c.department_id
        WHERE c.id = ?`,
      [id],
    )
    if (!cue) return noun(table)
    const number = formatCueNumber(cue.major, cue.minor, cue.number_format ?? 'decimal')
    return cue.code ? `${cue.code} cue ${number}` : `cue ${number}`
  } catch {
    return noun(table)
  }
}
