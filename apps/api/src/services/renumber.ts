import { renumberByBlocks } from '@binder/core'
import { cues, departments, documents } from '@binder/db'
import { type Actor, newId } from '@binder/shared'
import { and, eq } from 'drizzle-orm'
import { invalid, notFound } from '../errors'
import { updateCue } from './cues'
import type { Executor } from './executor'
import { requireLayerEdit } from './layers'

/**
 * "Renumber from script order" (spec 4.5) for one department within one document. Cues whose
 * anchor is in the document (any version) are ordered by reading order, those on the current
 * version first and those left on an older version after them, and renumbered in blocks;
 * unplaced cues, the 0 range and other documents are untouched. Every change is written through
 * `updateCue` in one transaction under one batch id, so it is one revertable batch. M1 has no
 * script items, so there are no groups and the cues take consecutive integers from the block size.
 * Needs edit rights on the department's layer.
 */
export async function renumberCues(
  db: Executor,
  actor: Actor,
  input: { departmentId: string; documentId: string; blockSize?: number; batchId?: string },
): Promise<{ changed: number; flagged: Array<{ cueId: string; reason: 'spilled' | 'overflow' }> }> {
  const batchId = input.batchId ?? newId()
  const blockSize = input.blockSize
  if (
    blockSize !== undefined &&
    (!Number.isInteger(blockSize) || blockSize < 2 || blockSize > 1000)
  ) {
    throw invalid('blockSize must be an integer from 2 to 1000')
  }
  if (input.departmentId.includes('\u0000') || input.documentId.includes('\u0000')) {
    throw invalid('ids must not contain NUL')
  }
  return db.transaction(async (tx) => {
    const [dept] = await tx
      .select({ showId: departments.showId })
      .from(departments)
      .where(eq(departments.id, input.departmentId))
    if (!dept) throw notFound('Department not found')
    await requireLayerEdit(tx, actor, dept.showId, { kind: 'department', id: input.departmentId })
    const [doc] = await tx
      .select({ showId: documents.showId, currentVersionId: documents.currentVersionId })
      .from(documents)
      .where(eq(documents.id, input.documentId))
    if (!doc || doc.showId !== dept.showId) throw notFound('Document not found')

    const rows = await tx
      .select({ id: cues.id, major: cues.major, minor: cues.minor, anchor: cues.anchor })
      .from(cues)
      .where(and(eq(cues.showId, dept.showId), eq(cues.departmentId, input.departmentId)))
    const inDocument = rows
      .filter((r) => r.anchor?.documentId === input.documentId)
      .map((r) => ({
        id: r.id,
        major: r.major,
        minor: r.minor,
        anchor: r.anchor ? { pageIndex: r.anchor.pageIndex, y: r.anchor.y } : null,
        groupKey: null,
        // Cues left on an older version are numbered after the current ones.
        stale:
          doc.currentVersionId !== null && r.anchor?.documentVersionId !== doc.currentVersionId,
      }))

    const result = renumberByBlocks(inDocument, { blockSize })
    for (const change of result.changes) {
      await updateCue(tx, actor, {
        cueId: change.id,
        patch: { major: change.major, minor: change.minor },
        batchId,
      })
    }
    return {
      changed: result.changes.length,
      flagged: result.flagged.map((f) => ({ cueId: f.id, reason: f.reason })),
    }
  })
}
