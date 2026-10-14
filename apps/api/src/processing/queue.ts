import type { Db } from '@binder/db'
import type { PgBoss } from 'pg-boss'
import type { BlobStore } from '../blob/BlobStore'
import { markVersionFailed, processDocumentVersion } from './documentJob'
import { processPage } from './pageJob'
import type { JobQueue, ProcessingDeps } from './types'

export const DOCUMENT_QUEUE = 'document-process'
export const PAGE_QUEUE = 'page-process'

const DOCUMENT_RETRY_LIMIT = 2

/**
 * The pg-boss backed JobQueue (spec 3.6). `start()` creates both queues and starts this process's
 * workers: one document job at a time (OCR is heavy), two page jobs.
 */
export function createJobQueue(
  boss: PgBoss,
  deps: { db: Db; blobs: BlobStore },
): JobQueue & { start(): Promise<void> } {
  const queue: JobQueue & { start(): Promise<void> } = {
    async enqueueDocumentProcess(versionId) {
      const id = await boss.send(DOCUMENT_QUEUE, { versionId })
      if (!id) throw new Error(`pg-boss did not accept the document job for ${versionId}`)
    },

    async enqueuePageProcess(pageIds) {
      if (pageIds.length === 0) return
      await boss.insert(
        PAGE_QUEUE,
        pageIds.map((pageId) => ({ data: { pageId } })),
      )
    },

    async start() {
      await boss.createQueue(DOCUMENT_QUEUE, {
        retryLimit: DOCUMENT_RETRY_LIMIT,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 30 * 60,
      })
      await boss.createQueue(PAGE_QUEUE, {
        retryLimit: 3,
        retryDelay: 10,
        retryBackoff: true,
        expireInSeconds: 5 * 60,
      })
      await boss.work<{ versionId: string }>(
        DOCUMENT_QUEUE,
        { localConcurrency: 1, batchSize: 1 },
        async ([job]) => {
          if (!job) return
          try {
            await processDocumentVersion(processing, job.data.versionId)
          } catch (err) {
            if (job.retryCount >= DOCUMENT_RETRY_LIMIT) {
              const message = err instanceof Error ? err.message : String(err)
              await markVersionFailed(deps.db, job.data.versionId, message)
            }
            throw err
          }
        },
      )
      await boss.work<{ pageId: string }>(
        PAGE_QUEUE,
        { localConcurrency: 2, batchSize: 1 },
        async ([job]) => {
          if (job) await processPage(processing, job.data.pageId)
        },
      )
    },
  }
  const processing: ProcessingDeps = { ...deps, jobs: queue }
  return queue
}
