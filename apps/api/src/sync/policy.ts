import type { Actor } from '@binder/shared'
import { z } from 'zod'
import { invalid } from '../errors'
import { updateDocument, updateShow } from '../services'
import type { Executor } from '../services/executor'

export type CrudOp = 'PUT' | 'PATCH' | 'DELETE'

export interface PatchInput {
  id: string
  /** Wire columns as replicated: snake_case keys, SQLite encodings. Anything non-writable is ignored. */
  data: Record<string, unknown>
  batchId: string
  clientTs?: Date
}

export interface SyncTablePolicy {
  ops: readonly CrudOp[]
  writable: readonly string[]
  /** Validate the writable columns and hand them to the owning service. Throws AppError on rejection. */
  patch(db: Executor, actor: Actor, input: PatchInput): Promise<void>
}

// Postgres rejects NUL in text and jsonb; a value it would refuse must be rejected, not retried.
const noNul = (s: string) => !s.includes('\u0000')
const title = z.string().trim().min(1).max(200).refine(noNul, 'must not contain NUL')

/** SQLite stores jsonb as JSON text. */
const jsonObject = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v
    try {
      return JSON.parse(v)
    } catch {
      return v
    }
  },
  z.record(z.string(), z.unknown()).refine((o) => noNul(JSON.stringify(o)), 'must not contain NUL'),
)

/** SQLite stores booleans as 0/1. The column is nullable, so null clears it. */
const sqliteBoolean = z.union([
  z.boolean(),
  z.literal(0).transform(() => false),
  z.literal(1).transform(() => true),
  z.null(),
])

const int32 = z.number().int().min(-2147483648).max(2147483647)

function tablePolicy<S extends z.ZodRawShape>(
  ops: readonly CrudOp[],
  shape: S,
  apply: (
    db: Executor,
    actor: Actor,
    input: Omit<PatchInput, 'data'> & { data: Partial<z.output<z.ZodObject<S>>> },
  ) => Promise<unknown>,
): SyncTablePolicy {
  const writable = Object.keys(shape)
  const schema = z.object(shape).partial()
  return {
    ops,
    writable,
    async patch(db, actor, input) {
      const picked = Object.fromEntries(
        writable.filter((k) => Object.hasOwn(input.data, k)).map((k) => [k, input.data[k]]),
      )
      if (Object.keys(picked).length === 0) throw invalid('no writable columns in patch')
      const parsed = schema.safeParse(picked)
      if (!parsed.success) {
        throw invalid(
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        )
      }
      await apply(db, actor, { ...input, data: parsed.data as Partial<z.output<z.ZodObject<S>>> })
    },
  }
}

/** The tables a PowerSync client may write, keyed by Postgres table name. M0 allows column patches only. */
export const SYNC_TABLES: Record<string, SyncTablePolicy> = {
  shows: tablePolicy(
    ['PATCH'],
    {
      title,
      status: z.enum(['prep', 'rehearsal', 'running', 'archived']),
      settings: jsonObject,
    },
    (db, actor, { id, data, batchId, clientTs }) =>
      updateShow(db, actor, { showId: id, patch: data, batchId, clientTs }),
  ),
  documents: tablePolicy(
    ['PATCH'],
    {
      title,
      kind: z.enum(['libretto', 'score', 'blocking', 'other']),
      ocr_mode: z.enum(['auto', 'never']),
      snap_to_text: sqliteBoolean,
      sort_order: int32,
    },
    (db, actor, { id, data, batchId, clientTs }) =>
      updateDocument(db, actor, {
        documentId: id,
        patch: {
          title: data.title,
          kind: data.kind,
          ocrMode: data.ocr_mode,
          snapToText: data.snap_to_text,
          sortOrder: data.sort_order,
        },
        batchId,
        clientTs,
      }),
  ),
}
