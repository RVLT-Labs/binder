import type { Via } from './types'

export const HISTORY_DEFAULT_LIMIT = 50
export const HISTORY_MAX_LIMIT = 200

/** One change-log row as a reader may see it (spec 4.12). `before` and `after` hold only the changed columns. */
export interface HistoryEntry {
  seq: number
  serverTs: string
  clientTs: string | null
  userId: string
  userName: string
  via: Via
  agent: string | null
  batchId: string | null
  table: string
  rowId: string
  op: 'insert' | 'update' | 'delete'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  layer: string | null
}

/** A run of consecutive entries by one user in one batch, as the activity feed shows it. */
export interface ActivityGroup {
  batchId: string | null
  userId: string
  /** `Jayden`, or `Jayden via Claude Code` for an agent. */
  label: string
  /** For example `moved 3 TM cues and relabelled 1`. */
  summary: string
  /** The group's newest `server_ts`. */
  at: string
  fromSeq: number
  toSeq: number
  count: number
  via: Via
  agent: string | null
}

export interface RevertResult {
  /** The new batch the revert was written in. */
  batchId: string
  reverted: number
  skipped: Array<{ seq: number; reason: 'row-gone' | 'already-reverted' }>
}

/**
 * Personal-layer redaction. An annotation moved from a personal layer onto a department layer is
 * logged on the destination layer with `before: { layerKind: 'personal', layerId: <owner> }`. Anyone
 * but that owner sees `layerKind: 'personal'` kept and `layerId` replaced with `null` (the same
 * rule applies to `after`), so another user's personal layer id never leaves the server.
 */
export function redactPersonalLayer(
  columns: Record<string, unknown> | null,
  viewerId: string,
): Record<string, unknown> | null {
  if (!columns) return columns
  if (columns.layerKind !== 'personal') return columns
  if (columns.layerId === undefined || columns.layerId === viewerId) return columns
  return { ...columns, layerId: null }
}

/**
 * The privacy predicate for a change log row's `layer` (spec 4.11): rows outside layers and on
 * department layers are visible to every member; a row on a personal layer only to its owner. It
 * fails closed: any layer starting with `personal:` is private unless it is exactly
 * `personal:<viewer id>`, so a malformed `personal:` is private to everyone. The history SQL
 * filter (`apps/api/src/services/history.ts`) expresses the same rule and the two must agree.
 */
export function isLayerVisibleTo(layer: string | null, viewerId: string): boolean {
  if (layer === null || !layer.startsWith('personal:')) return true
  return viewerId !== '' && layer === `personal:${viewerId}`
}
