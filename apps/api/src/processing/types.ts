import type { Db } from '@binder/db'
import type { BlobStore } from '../blob/BlobStore'

/** Hands work to the background processing pipeline (spec 3.6, 5.1). */
export interface JobQueue {
  /** Queue the document job for a freshly uploaded version. */
  enqueueDocumentProcess(versionId: string): Promise<void>
  /** Queue one page job per page row; called by the document job. */
  enqueuePageProcess(pageIds: string[]): Promise<void>
  /** Queue the re-anchoring run for a ready revision; repeats for one version coalesce. */
  enqueueReanchor(versionId: string): Promise<void>
}

export interface ProcessingDeps {
  db: Db
  blobs: BlobStore
  jobs: JobQueue
}
