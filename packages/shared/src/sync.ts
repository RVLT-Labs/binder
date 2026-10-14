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

export interface SyncUploadRequest {
  batchId: string
  entries: SyncCrudEntry[]
}

export type SyncRejectReason =
  | 'unknown_table'
  | 'unsupported_op'
  | 'forbidden'
  | 'not_found'
  | 'invalid'

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
}
