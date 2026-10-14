import type { Db } from '@binder/db'
import type {
  Actor,
  SyncCrudEntry,
  SyncRejection,
  SyncRejectReason,
  SyncUploadRequest,
  SyncUploadResponse,
} from '@binder/shared'
import { AppError, type ErrorCode } from '../errors'
import type { Tx } from '../services/executor'
import { SYNC_TABLES } from './policy'

/** Service errors that mean "this operation can never succeed": reject it and keep the queue moving. */
const REJECTABLE: Partial<Record<ErrorCode, SyncRejectReason>> = {
  forbidden: 'forbidden',
  not_found: 'not_found',
  invalid: 'invalid',
}

class Rejected extends Error {
  constructor(
    readonly reason: SyncRejectReason,
    message: string,
  ) {
    super(message)
  }
}

// Postgres timestamptz refuses some dates JavaScript accepts; anything outside this window is a
// broken client clock, rejected so it cannot fail the write and loop the batch.
const CLIENT_TS_MIN = Date.parse('2000-01-01T00:00:00Z')
const CLIENT_TS_MAX = Date.parse('2100-01-01T00:00:00Z')

function parseClientTs(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined
  const ms = new Date(value).getTime()
  if (Number.isNaN(ms) || ms < CLIENT_TS_MIN || ms > CLIENT_TS_MAX) {
    throw new Rejected('invalid', 'clientTs must be a timestamp between 2000 and 2100')
  }
  return new Date(ms)
}

async function applyEntry(
  db: Tx,
  actor: Actor,
  batchId: string,
  entry: SyncCrudEntry,
): Promise<void> {
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
  req: SyncUploadRequest,
): Promise<SyncUploadResponse> {
  return db.transaction(async (tx) => {
    let applied = 0
    const rejected: SyncRejection[] = []
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
