import {
  newId,
  type SyncCrudEntry,
  type SyncCrudOp,
  type SyncUploadRequest,
  type SyncUploadResponse,
} from '@binder/shared'
import type {
  CommonPowerSyncDatabase,
  CrudEntry,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from '@powersync/web'
import { UpdateType } from '@powersync/web'
import { ApiError, api } from '../api/client'
import { pushNotice } from '../components/noticeStore'

/** The upload wire entry, renamed here so it does not clash with PowerSync's own CrudEntry. */
export type CrudEntryWire = SyncCrudEntry

const OPS: Record<UpdateType, SyncCrudOp> = {
  [UpdateType.PUT]: 'PUT',
  [UpdateType.PATCH]: 'PATCH',
  [UpdateType.DELETE]: 'DELETE',
}

export function toCrudEntries(crud: CrudEntry[]): CrudEntryWire[] {
  return crud.map((entry) => ({
    table: entry.table,
    id: entry.id,
    op: OPS[entry.op],
    ...(entry.opData ? { data: entry.opData } : {}),
  }))
}

const NOUNS: Record<string, string> = { shows: 'show', documents: 'document' }

export class ApiConnector implements PowerSyncBackendConnector {
  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    try {
      const { token, expiresAt, endpoint } = await api.get<{
        token: string
        expiresAt: string
        endpoint: string
      }>('/sync/token')
      return { endpoint, token, expiresAt: new Date(expiresAt) }
    } catch (err) {
      // Signed out: PowerSync stops trying. Anything else (offline, 5xx) throws so it retries.
      if (err instanceof ApiError && err.status === 401) return null
      throw err
    }
  }

  async uploadData(db: CommonPowerSyncDatabase): Promise<void> {
    const tx = await db.getNextCrudTransaction()
    if (!tx) return
    const body: SyncUploadRequest = {
      batchId: tx.transactionId === undefined ? newId() : String(tx.transactionId),
      entries: toCrudEntries(tx.crud),
    }
    // Non-2xx throws, so PowerSync keeps the transaction queued and retries it.
    const { rejected } = await api.post<SyncUploadResponse>('/sync/upload', body)
    for (const r of rejected) {
      pushNotice({
        kind: 'rejection',
        message: `Your change to a ${NOUNS[r.table] ?? r.table} was not saved: ${r.message}`,
      })
    }
    // Rejected entries are dropped locally; the sync stream then restores the server's value.
    await tx.complete()
  }
}
