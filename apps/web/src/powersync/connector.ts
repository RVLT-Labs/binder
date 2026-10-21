import {
  newId,
  type SyncCrudEntry,
  type SyncCrudOp,
  type SyncRejection,
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
import { assertDatabaseOwner, runDatabaseWork } from '../auth/localWork'
import { pushNotice } from '../components/noticeStore'
import { deviceId } from './ownership'
import { rowLabel } from './rowLabel'
import { toUploadChunks } from './uploadChunks'

/** The upload wire entry, renamed here so it does not clash with PowerSync's own CrudEntry. */
export type CrudEntryWire = SyncCrudEntry

const OPS: Record<UpdateType, SyncCrudOp> = {
  [UpdateType.PUT]: 'PUT',
  [UpdateType.PATCH]: 'PATCH',
  [UpdateType.DELETE]: 'DELETE',
}

/**
 * PowerSync's queue entries in the wire format. Every local mutation writes `updated_at`, which
 * travels as the entry's `clientTs`: the time of the edit, not of the upload.
 */
export function toCrudEntries(crud: CrudEntry[]): CrudEntryWire[] {
  return crud.map((entry) => {
    const updatedAt = entry.opData?.updated_at
    return {
      table: entry.table,
      id: entry.id,
      op: OPS[entry.op],
      ...(entry.opData ? { data: entry.opData } : {}),
      ...(typeof updatedAt === 'string' ? { clientTs: updatedAt } : {}),
    }
  })
}

export class ApiConnector implements PowerSyncBackendConnector {
  private readonly uploadNamespace: string

  constructor(
    private readonly claimDb: object,
    private readonly userId: string,
  ) {
    assertDatabaseOwner(claimDb, userId)
    this.uploadNamespace = deviceId()
  }

  private checkClaim(): void {
    assertDatabaseOwner(this.claimDb, this.userId)
  }

  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    this.checkClaim()
    try {
      const { token, expiresAt, endpoint } = await api.get<{
        token: string
        expiresAt: string
        endpoint: string
      }>('/sync/token', { expectedUserId: this.userId })
      this.checkClaim()
      return { endpoint, token, expiresAt: new Date(expiresAt) }
    } catch (err) {
      // Signed out: PowerSync stops trying. Anything else (offline, 5xx) throws so it retries.
      if (err instanceof ApiError && err.status === 401) return null
      throw err
    }
  }

  uploadData(db: CommonPowerSyncDatabase): Promise<void> {
    // The SDK supplies its raw database and disconnect can stop waiting without cancelling us.
    // Register the WHOLE callback before the first SDK/network await. Never nest facade locks.
    return runDatabaseWork(this.claimDb, this.userId, () => this.uploadClaimedData(db))
  }

  private async uploadClaimedData(db: CommonPowerSyncDatabase): Promise<void> {
    const tx = await db.getNextCrudTransaction()
    this.checkClaim()
    if (!tx) return
    // Device-scoped (the server logs it as `${userId}:${batchId}`); the grammar is [A-Za-z0-9_-].
    const batchId = `${this.uploadNamespace}-${tx.transactionId ?? newId()}`
    const chunks = toUploadChunks(toCrudEntries(tx.crud))
    const rejected: SyncRejection[] = []
    // In order, one at a time. Non-2xx throws before `complete()`, so PowerSync keeps the whole
    // transaction queued and retries it; the server recognises chunks it already applied and skips them.
    for (const [index, entries] of chunks.entries()) {
      this.checkClaim()
      const body: SyncUploadRequest = { batchId, chunk: { index, count: chunks.length }, entries }
      const response = await api.post<SyncUploadResponse>('/sync/upload', body, {
        expectedUserId: this.userId,
      })
      this.checkClaim()
      rejected.push(...response.rejected)
    }
    // Named from the local rows, which are still there until the transaction completes.
    const labels = await Promise.all(rejected.map((r) => rowLabel(db, r.table, r.id)))
    this.checkClaim()
    rejected.forEach((r, i) => {
      pushNotice({
        kind: 'rejection',
        message: `Your change to ${labels[i]} was not saved: ${r.message}`,
      })
    })
    // Rejected entries are dropped locally; the sync stream then restores the server's value.
    this.checkClaim()
    await tx.complete()
    this.checkClaim()
  }
}
