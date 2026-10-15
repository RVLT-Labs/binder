import type { Db } from '@binder/db'
import type { JobWithMetadata, PgBoss } from 'pg-boss'
import type { BlobStore } from '../blob/BlobStore'
import { APPLIED_CHUNK_TTL_MS, deleteAppliedChunksBefore } from '../sync/apply'
import { markVersionFailed, processDocumentVersion } from './documentJob'
import { OCRMYPDF_TIMEOUT_MS } from './ocrmypdf'
import { markPageFailed, processPage } from './pageJob'
import { adoptVersionWithoutReanchoring, reanchorVersion } from './reanchorJob'
import type { JobQueue, ProcessingDeps } from './types'

export const DOCUMENT_QUEUE = 'document-process'
export const PAGE_QUEUE = 'page-process'
/** pg-boss moves a job here once it has failed or expired on every retry (R45). */
export const DOCUMENT_DEAD_QUEUE = 'document-process-dead'
export const PAGE_DEAD_QUEUE = 'page-process-dead'
/** Moves cue and annotation anchors onto a revised version, then makes it current (spec 5.4). */
export const REANCHOR_QUEUE = 'document-reanchor'
export const REANCHOR_DEAD_QUEUE = 'document-reanchor-dead'
/** Maintenance: forgets applied sync chunks once no client could still be retrying them. */
export const SYNC_CHUNK_GC_QUEUE = 'sync-chunk-gc'
/** Daily at 03:17 UTC. */
export const SYNC_CHUNK_GC_CRON = '17 3 * * *'

/**
 * The document job runs OCRmyPDF (killed at its own timeout) plus pdfimages, the copy fallback,
 * pdfinfo, the blob write and a transaction. Expiring only after a margin past the OCR timeout keeps
 * pg-boss from retrying a job whose first worker is still running (R46).
 */
export const DOCUMENT_JOB_EXPIRE_SECONDS = OCRMYPDF_TIMEOUT_MS / 1000 + 10 * 60

type QueueSettings = NonNullable<Parameters<PgBoss['createQueue']>[1]>

const QUEUES: ReadonlyArray<{
  name: string
  options: QueueSettings
  /** Settings pg-boss accepts only when it creates the queue (it refuses to change them later). */
  creation?: { policy: 'short' }
}> = [
  { name: DOCUMENT_DEAD_QUEUE, options: { retryLimit: 5, retryDelay: 10, retryBackoff: true } },
  { name: PAGE_DEAD_QUEUE, options: { retryLimit: 5, retryDelay: 10, retryBackoff: true } },
  { name: REANCHOR_DEAD_QUEUE, options: { retryLimit: 5, retryDelay: 10, retryBackoff: true } },
  {
    name: DOCUMENT_QUEUE,
    options: {
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: DOCUMENT_JOB_EXPIRE_SECONDS,
      deadLetter: DOCUMENT_DEAD_QUEUE,
    },
  },
  { name: SYNC_CHUNK_GC_QUEUE, options: { retryLimit: 2, retryDelay: 60 } },
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
  {
    name: REANCHOR_QUEUE,
    options: {
      retryLimit: 3,
      retryDelay: 10,
      retryBackoff: true,
      expireInSeconds: 10 * 60,
      deadLetter: REANCHOR_DEAD_QUEUE,
    },
    // `short`: at most one queued job per singleton key, so repeats for one version coalesce.
    creation: { policy: 'short' },
  },
]

/** Creates every queue (and applies changed settings to existing ones). Idempotent. */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const { name, options, creation } of QUEUES) {
    await boss.createQueue(name, { ...options, ...creation })
    // createQueue leaves an existing queue alone; this applies changed settings to it.
    await boss.updateQueue(name, options)
  }
}

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
  deps: Pick<ProcessingDeps, 'db' | 'jobs'>,
  job: DeadLetter<{ pageId: string }>,
): Promise<void> {
  await markPageFailed(deps, job.data.pageId, afterRetries('Page processing', job.sourceOutput))
}

/**
 * The re-anchoring job's dead-letter action (R45): pg-boss gave up after retries or expiry. The
 * version still becomes current, without its anchors moved, so it never stays ready but not
 * current; the anchors left on older versions surface in the review list.
 */
export async function handleReanchorDeadLetter(
  deps: Pick<ProcessingDeps, 'db'>,
  job: DeadLetter<{ versionId: string }>,
): Promise<void> {
  const { message } = lastFailure(job.sourceOutput)
  console.error(
    `re-anchoring ${job.data.versionId} failed after retries: ${message ?? 'no detail'}`,
  )
  await adoptVersionWithoutReanchoring(deps, job.data.versionId)
}

export async function handleSyncChunkGc(
  deps: Pick<ProcessingDeps, 'db'>,
  now: Date = new Date(),
): Promise<void> {
  await deleteAppliedChunksBefore(deps.db, new Date(now.getTime() - APPLIED_CHUNK_TTL_MS))
}

/**
 * The pg-boss backed JobQueue (spec 3.6). `start()` creates the queues and starts this process's
 * workers: one document job at a time (OCR is heavy), two page jobs, the dead letters, and the daily
 * `sync-chunk-gc` maintenance job (pg-boss runs a schedule once however many processes declare it).
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

    async enqueueReanchor(versionId) {
      // A job already queued for this version coalesces this one: boss.send then returns null.
      await boss.send(REANCHOR_QUEUE, { versionId }, { singletonKey: versionId })
    },

    async start() {
      await ensureQueues(boss)
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
      await boss.work<{ versionId: string }>(
        REANCHOR_QUEUE,
        { localConcurrency: 1, batchSize: 1 },
        async ([job]) => {
          if (job) await reanchorVersion(processing, job.data.versionId)
        },
      )
      await boss.work(
        REANCHOR_DEAD_QUEUE,
        { batchSize: 1, includeMetadata: true },
        async ([job]: JobWithMetadata<{ versionId: string }>[]) => {
          if (job) await handleReanchorDeadLetter(deps, job)
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
          if (job) await handlePageDeadLetter(processing, job)
        },
      )
      await boss.schedule(SYNC_CHUNK_GC_QUEUE, SYNC_CHUNK_GC_CRON)
      await boss.work(SYNC_CHUNK_GC_QUEUE, { batchSize: 1 }, async () => {
        await handleSyncChunkGc(deps)
      })
    },
  }
  const processing: ProcessingDeps = { ...deps, jobs: queue }
  return queue
}
