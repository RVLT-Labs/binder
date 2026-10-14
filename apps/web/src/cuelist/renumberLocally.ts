import { type RenumberCue, type RenumberResult, renumberByBlocks } from '@binder/core'
import type { AbstractPowerSyncDatabase } from '@powersync/web'
import { type EditContext, updateCues } from '../markup/mutations'

type Db = Pick<AbstractPowerSyncDatabase, 'getAll' | 'writeTransaction'>

export interface RenumberTarget {
  departmentId: string
  documentId: string
  blockSize: number
}

/** A local cue row as the renumbering reads it: `anchor` is JSON text. */
export interface CueNumberRow {
  id: string
  major: number
  minor: number
  anchor: string | null
}

/**
 * The department's cues anchored in the document, as `renumberByBlocks` takes them. M1 has no
 * script items, so no cue resolves to a scene or song and every group key is null.
 */
export function renumberCuesOf(rows: readonly CueNumberRow[], documentId: string): RenumberCue[] {
  const out: RenumberCue[] = []
  for (const row of rows) {
    let anchor: unknown = null
    try {
      anchor = row.anchor ? JSON.parse(row.anchor) : null
    } catch {
      // an unreadable anchor is an unplaced cue here
    }
    const a = anchor as { documentId?: unknown; pageIndex?: unknown; y?: unknown } | null
    const placed =
      a !== null &&
      a.documentId === documentId &&
      typeof a.pageIndex === 'number' &&
      typeof a.y === 'number'
    out.push({
      id: row.id,
      major: Number(row.major),
      minor: Number(row.minor),
      anchor: placed ? { pageIndex: a.pageIndex as number, y: a.y as number } : null,
      groupKey: null,
    })
  }
  return out
}

/** What renumbering would do, for the dialog's preview. */
export function previewRenumber(
  rows: readonly CueNumberRow[],
  documentId: string,
  blockSize: number,
): RenumberResult {
  return renumberByBlocks(renumberCuesOf(rows, documentId), { blockSize })
}

/**
 * "Renumber from script order" on the local database, so it works offline: one transaction, one
 * upload batch and one undo entry (`updateCues` writes one edit group). Resolves to what changed.
 */
export async function renumberLocally(
  db: Db,
  ctx: EditContext,
  target: RenumberTarget,
): Promise<RenumberResult> {
  const rows = await db.getAll<CueNumberRow>(
    'SELECT id, major, minor, anchor FROM cues WHERE show_id = ? AND department_id = ?',
    [ctx.showId, target.departmentId],
  )
  const result = previewRenumber(rows, target.documentId, target.blockSize)
  if (result.changes.length > 0) {
    await updateCues(
      db,
      ctx,
      result.changes.map(({ id, major, minor }) => ({ id, patch: { major, minor } })),
    )
  }
  return result
}
