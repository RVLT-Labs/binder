import { processDocumentVersion } from '../src/processing/documentJob'
import { processPage } from '../src/processing/pageJob'
import type { ProcessingDeps } from '../src/processing/types'
import type { RecordingJobs } from './helpers'
import { findMissingTools } from './tools'

/** The external PDF tools processing needs that are not runnable here; skip suites when non-empty. */
export const missingTools: string[] = findMissingTools([
  ['pdfinfo', ['-v']],
  ['pdftoppm', ['-v']],
  ['pdftotext', ['-v']],
  ['pdfimages', ['-v']],
  ['ocrmypdf', ['--version']],
])

/** The document job, then every page job it enqueued, as the workers would. `deps.jobs` must record. */
export async function processVersion(
  deps: ProcessingDeps & { jobs: RecordingJobs },
  versionId: string,
): Promise<void> {
  await processDocumentVersion(deps, versionId)
  await Promise.all(deps.jobs.enqueuedPages.map((id) => processPage(deps, id)))
}
