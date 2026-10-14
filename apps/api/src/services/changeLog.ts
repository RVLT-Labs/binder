import { changeLog } from '@binder/db'
import type { Actor } from '@binder/shared'
import type { Executor } from './executor'

export interface ChangeEntry {
  showId: string
  actor: Actor
  batchId: string
  table: string
  rowId: string
  op: 'insert' | 'update' | 'delete'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  clientTs?: Date
}

/** Append one change log row. Call inside the same transaction as the write it describes. */
export async function logChange(tx: Executor, e: ChangeEntry): Promise<void> {
  await tx.insert(changeLog).values({
    showId: e.showId,
    userId: e.actor.userId,
    via: e.actor.via,
    agent: e.actor.agent,
    clientTs: e.clientTs ?? null,
    batchId: e.batchId,
    tableName: e.table,
    rowId: e.rowId,
    op: e.op,
    before: e.before,
    after: e.after,
  })
}
