import type { Db } from '@binder/db'
import type { Actor } from '@binder/shared'
import { AppError, type ErrorCode } from '../errors'
import type { Tx } from '../services/executor'
import { type CrudOp, SYNC_TABLES } from './policy'

export type { CrudOp } from './policy'

export interface CrudEntry {
  table: string
  id: string
  op: CrudOp
  data?: Record<string, unknown> | null
  clientTs?: string
}

export interface UploadRequest {
  batchId: string
  entries: CrudEntry[]
}

export type RejectReason =
  | 'unknown_table'
  | 'unsupported_op'
  | 'forbidden'
  | 'not_found'
  | 'invalid'

export interface Rejection {
  index: number
  table: string
  id: string
  reason: RejectReason
  message: string
}

/** Service errors that mean "this operation can never succeed": reject it and keep the queue moving. */
const REJECTABLE: Partial<Record<ErrorCode, RejectReason>> = {
  forbidden: 'forbidden',
  not_found: 'not_found',
  invalid: 'invalid',
}

class Rejected extends Error {
  constructor(
    readonly reason: RejectReason,
    message: string,
  ) {
    super(message)
  }
}

function parseClientTs(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    throw new Rejected('invalid', 'clientTs is not a valid timestamp')
  return date
}

async function applyEntry(db: Tx, actor: Actor, batchId: string, entry: CrudEntry): Promise<void> {
  if (!Object.hasOwn(SYNC_TABLES, entry.table)) {
    throw new Rejected('unknown_table', `table ${entry.table} is not writable through sync`)
  }
  const policy = SYNC_TABLES[entry.table]
  // M0 implements column patches only; PUT and DELETE arrive with the tables that need them.
  if (entry.op !== 'PATCH' || !policy.ops.includes(entry.op)) {
    throw new Rejected('unsupported_op', `${entry.op} is not allowed on ${entry.table}`)
  }
  const clientTs = parseClientTs(entry.clientTs)
  await policy.patch(db, actor, { id: entry.id, data: entry.data ?? {}, batchId, clientTs })
}

/**
 * Applies a PowerSync upload batch in one transaction, each entry in its own savepoint so a
 * rejected entry rolls back only itself. Permission and validation failures become rejections;
 * any other error aborts the whole batch and propagates so the client retries it.
 */
export async function applyCrudBatch(
  db: Db,
  actor: Actor,
  req: UploadRequest,
): Promise<{ applied: number; rejected: Rejection[] }> {
  return db.transaction(async (tx) => {
    let applied = 0
    const rejected: Rejection[] = []
    for (const [index, entry] of req.entries.entries()) {
      try {
        await tx.transaction((sp) => applyEntry(sp, actor, req.batchId, entry))
        applied++
      } catch (err) {
        const reason =
          err instanceof Rejected
            ? err.reason
            : err instanceof AppError
              ? REJECTABLE[err.code]
              : undefined
        if (!reason) throw err
        const message = err instanceof Error ? err.message : String(err)
        rejected.push({ index, table: entry.table, id: entry.id, reason, message })
      }
    }
    return { applied, rejected }
  })
}
