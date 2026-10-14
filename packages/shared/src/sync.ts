/**
 * Wire format of PowerSync uploads (POST /api/sync/upload), shared by the web connector and the
 * API's sync route. Keys in `data` are Postgres column names (snake_case) with SQLite encodings:
 * jsonb as JSON text, booleans as 0/1.
 */
export type SyncCrudOp = 'PUT' | 'PATCH' | 'DELETE'

export interface SyncCrudEntry {
  table: string
  id: string
  op: SyncCrudOp
  data?: Record<string, unknown> | null
  clientTs?: string
}

/** One part of a PowerSync transaction too large for one request; all parts share the batch id. */
export interface SyncChunk {
  index: number
  count: number
}

export interface SyncUploadRequest {
  batchId: string
  /** Absent means the whole transaction in one request: chunk 0 of 1. */
  chunk?: SyncChunk
  entries: SyncCrudEntry[]
}

export type SyncRejectReason =
  | 'unknown_table'
  | 'unsupported_op'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'conflict'

export interface SyncRejection {
  /** Position of the rejected entry in the request's `entries`. */
  index: number
  table: string
  id: string
  reason: SyncRejectReason
  message: string
}

export interface SyncUploadResponse {
  applied: number
  rejected: SyncRejection[]
  /** This chunk of this batch was applied before (a retry after a lost response): nothing was applied now. */
  replay?: true
}
