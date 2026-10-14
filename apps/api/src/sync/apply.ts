import { createHash } from 'node:crypto'
import { type Db, syncAppliedChunks } from '@binder/db'
import type {
  Actor,
  SyncCrudEntry,
  SyncRejection,
  SyncRejectReason,
  SyncUploadRequest,
  SyncUploadResponse,
} from '@binder/shared'
import { lt, sql } from 'drizzle-orm'
import { AppError, type ErrorCode, IdTaken } from '../errors'
import type { Executor, Tx } from '../services/executor'
import { SYNC_TABLES, type WriteInput } from './policy'

/** Service errors that mean "this operation can never succeed": reject it and keep the queue moving. */
const REJECTABLE: Partial<Record<ErrorCode, SyncRejectReason>> = {
  forbidden: 'forbidden',
  not_found: 'not_found',
  invalid: 'invalid',
  conflict: 'conflict',
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
  const unsupported = () =>
    new Rejected('unsupported_op', `${entry.op} is not allowed on ${entry.table}`)
  if (!policy.ops.includes(entry.op)) throw unsupported()
  const input: WriteInput = {
    id: entry.id,
    data: entry.data ?? {},
    batchId,
    clientTs: parseClientTs(entry.clientTs),
  }

  if (entry.op === 'PATCH') {
    if (!policy.patch) throw unsupported()
    await policy.patch(db, actor, input)
  } else if (entry.op === 'DELETE') {
    if (!policy.remove) throw unsupported()
    await policy.remove(db, actor, input)
  } else {
    if (!policy.put) throw unsupported()
    const put = (sp: Tx) => (policy.put as NonNullable<typeof policy.put>)(sp, actor, input)
    try {
      await db.transaction(put)
    } catch (err) {
      // Another transaction created this id between our read and our insert (a concurrent replay):
      // retry once in a fresh savepoint, where the row exists and the PUT is treated as its replay.
      if (!(err instanceof IdTaken)) throw err
      await db.transaction(put)
    }
  }
}

/** JSON with object keys sorted at every level, so equal content always serialises the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** What a chunk's record remembers of its content. */
export const chunkDigest = (entries: SyncCrudEntry[]): string =>
  createHash('sha256').update(canonicalJson(entries)).digest('hex')

/**
 * Applies one chunk of a PowerSync upload batch in one transaction, each entry in its own savepoint
 * so a rejected entry rolls back only itself. Permission and validation failures become rejections;
 * any other error aborts the chunk and propagates so the client retries it.
 *
 * `req.batchId` is the logged, user-scoped id (`<userId>:<clientBatchId>`). Each chunk of it is
 * recorded in `sync_applied_chunks` in the same transaction as its writes, so a chunk sent again (a
 * lost response, or a retry of the whole transaction after a later chunk failed) applies nothing.
 * The record keeps a digest of the entries: the same key with other entries (the transaction retried
 * under different chunk boundaries) is not a replay, so it is applied and the digest replaced. That is
 * safe because entries are idempotent: PUT is create-or-replay, PATCH last writer wins, DELETE of a
 * missing row is applied.
 */
export async function applyCrudBatch(
  db: Db,
  actor: Actor,
  req: SyncUploadRequest,
): Promise<SyncUploadResponse> {
  return db.transaction(async (tx) => {
    // A concurrent copy of this chunk waits here until the first commits, then sees the conflict.
    // A row comes back when the chunk is new or its content differs from what the key recorded.
    const digest = chunkDigest(req.entries)
    const recorded = await tx
      .insert(syncAppliedChunks)
      .values({ batchKey: req.batchId, chunkIndex: req.chunk?.index ?? 0, digest })
      .onConflictDoUpdate({
        target: [syncAppliedChunks.batchKey, syncAppliedChunks.chunkIndex],
        set: { digest, appliedAt: sql`now()` },
        setWhere: sql`${syncAppliedChunks.digest} <> excluded.digest`,
      })
      .returning({ batchKey: syncAppliedChunks.batchKey })
    if (recorded.length === 0) return { applied: 0, rejected: [], replay: true }

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

/** How long a chunk is remembered: far longer than any client keeps retrying one upload. */
export const APPLIED_CHUNK_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Forgets applied chunks recorded before `cutoff`; returns how many were deleted. */
export async function deleteAppliedChunksBefore(db: Executor, cutoff: Date): Promise<number> {
  const deleted = await db
    .delete(syncAppliedChunks)
    .where(lt(syncAppliedChunks.appliedAt, cutoff))
    .returning({ batchKey: syncAppliedChunks.batchKey })
  return deleted.length
}
