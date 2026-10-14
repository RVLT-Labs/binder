import type { Db } from '@binder/db'
import type { JobWithMetadata, PgBoss } from 'pg-boss'
import type { BlobStore } from '../blob/BlobStore'
import { markVersionFailed, processDocumentVersion } from './documentJob'
import { markPageFailed, processPage } from './pageJob'
import type { JobQueue, ProcessingDeps } from './types'

export const DOCUMENT_QUEUE = 'document-process'
export const PAGE_QUEUE = 'page-process'
/** pg-boss moves a job here once it has failed or expired on every retry (R45). */
export const DOCUMENT_DEAD_QUEUE = 'document-process-dead'
export const PAGE_DEAD_QUEUE = 'page-process-dead'

const QUEUES = [
  { name: DOCUMENT_DEAD_QUEUE, options: { retryLimit: 5, retryDelay: 10, retryBackoff: true } },
  { name: PAGE_DEAD_QUEUE, options: { retryLimit: 5, retryDelay: 10, retryBackoff: true } },
  {
    name: DOCUMENT_QUEUE,
    options: {
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 30 * 60,
      deadLetter: DOCUMENT_DEAD_QUEUE,
    },
  },
  {
    name: PAGE_QUEUE,
    options: {
      retryLimit: 3,
      retryDelay: 10,
      retryBackoff: true,
      expireInSeconds: 5 * 60,
      deadLetter: PAGE_DEAD_QUEUE,
    },
  },
] as const

/** A dead-lettered job: its original data and the original job's last output (usually its error). */
export interface DeadLetter<T> {
  data: T
  sourceOutput: object | null
}

/** pg-boss records an expiry as `{ value: { message: 'job timed out' } }` and a throw as the error. */
function lastFailure(output: object | null): { timedOut: boolean; message: string | null } {
  const o = output as { message?: unknown; value?: { message?: unknown } } | null
  const message = typeof o?.message === 'string' ? o.message : o?.value?.message
  const text = typeof message === 'string' ? message : null
  return { timedOut: text === 'job timed out', message: text }
}

function afterRetries(what: string, output: object | null): string {
  const { timedOut, message } = lastFailure(output)
  if (timedOut) return `${what} timed out after retries.`
  return message ? `${what} failed after retries: ${message}` : `${what} failed after retries.`
}

export async function handleDocumentDeadLetter(
  deps: Pick<ProcessingDeps, 'db'>,
  job: DeadLetter<{ versionId: string }>,
): Promise<void> {
  await markVersionFailed(deps.db, job.data.versionId, afterRetries('Processing', job.sourceOutput))
}

export async function handlePageDeadLetter(
  deps: Pick<ProcessingDeps, 'db'>,
  job: DeadLetter<{ pageId: string }>,
): Promise<void> {
  await markPageFailed(deps.db, job.data.pageId, afterRetries('Page processing', job.sourceOutput))
}

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
      for (const { name, options } of QUEUES) {
        await boss.createQueue(name, options)
        // createQueue leaves an existing queue alone; this applies changed settings to it.
        await boss.updateQueue(name, options)
      }
      await boss.work<{ versionId: string }>(
        DOCUMENT_QUEUE,
        { localConcurrency: 1, batchSize: 1 },
        async ([job]) => {
          if (job) await processDocumentVersion(processing, job.data.versionId)
        },
      )
      await boss.work<{ pageId: string }>(
        PAGE_QUEUE,
        { localConcurrency: 2, batchSize: 1 },
        async ([job]) => {
          if (job) await processPage(processing, job.data.pageId)
        },
      )
      await boss.work(
        DOCUMENT_DEAD_QUEUE,
        { batchSize: 1, includeMetadata: true },
        async ([job]: JobWithMetadata<{ versionId: string }>[]) => {
          if (job) await handleDocumentDeadLetter(deps, job)
        },
      )
      await boss.work(
        PAGE_DEAD_QUEUE,
        { batchSize: 1, includeMetadata: true },
        async ([job]: JobWithMetadata<{ pageId: string }>[]) => {
          if (job) await handlePageDeadLetter(deps, job)
        },
      )
    },
  }
  const processing: ProcessingDeps = { ...deps, jobs: queue }
  return queue
}
