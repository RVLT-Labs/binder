/** Hands a freshly uploaded document version to the background processing pipeline. */
export interface JobQueue {
  enqueueDocumentProcess(versionId: string): Promise<void>
}
