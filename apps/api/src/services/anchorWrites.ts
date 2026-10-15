import { columnEqual } from '@binder/core'
import { annotations, cues } from '@binder/db'
import { type Actor, type Anchor, layerKey } from '@binder/shared'
import { eq } from 'drizzle-orm'
import { notFound } from '../errors'
import { logChange } from './changeLog'
import type { Executor } from './executor'

/**
 * Internal (never in the services barrel, so not an MCP operation): sets one cue's or annotation's
 * anchor and logs it, with none of the permission, layer or archived-show checks of the owning
 * services. Only the re-anchoring job and the revert of its run use it, both of which act on a
 * document as a whole. The row is read `FOR UPDATE` and the log row carries the row's own layer
 * (`department:<id>` or `personal:<userId>`), so history privacy filtering still applies to it.
 * A write that leaves the anchor unchanged writes and logs nothing.
 */
export async function writeAnchorUnchecked(
  tx: Executor,
  actor: Actor,
  table: 'cues' | 'annotations',
  rowId: string,
  anchor: Anchor,
  batchId: string,
): Promise<void> {
  const target = table === 'cues' ? cues : annotations
  const [row] = await tx.select().from(target).where(eq(target.id, rowId)).for('update')
  if (!row) throw notFound(table === 'cues' ? 'Cue not found' : 'Annotation not found')
  const before = row.anchor as Anchor | null
  if (before !== null && columnEqual(before, anchor)) return

  await tx.update(target).set({ anchor, updatedBy: actor.userId }).where(eq(target.id, rowId))
  const layer =
    'departmentId' in row
      ? layerKey({ kind: 'department', id: row.departmentId })
      : layerKey({ kind: row.layerKind, id: row.layerId })
  await logChange(tx, {
    showId: row.showId,
    actor,
    batchId,
    table,
    rowId,
    op: 'update',
    before: { anchor: before },
    after: { anchor },
    layer,
  })
}
