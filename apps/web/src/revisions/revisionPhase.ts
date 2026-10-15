export interface UploadedVersion {
  status: string | null
  error: string | null
}

export type RevisionPhase =
  | { phase: 'processing' }
  | { phase: 'reanchoring' }
  | { phase: 'done' }
  | { phase: 'failed'; error: string }

/**
 * Where an uploaded revision is, from the rows sync brings: the version's own status while it is
 * processed, then "re-anchoring" from the moment it is ready until the document's current version
 * becomes it, which is the only thing that ends the wait. A failed version ends it with its error.
 */
export function revisionPhase(input: {
  newVersionId: string
  currentVersionId: string | null
  version: UploadedVersion | null
}): RevisionPhase {
  const { version } = input
  if (input.currentVersionId === input.newVersionId && version?.status !== 'failed') {
    return { phase: 'done' }
  }
  if (!version) return { phase: 'processing' }
  if (version.status === 'failed')
    return { phase: 'failed', error: version.error || 'processing failed' }
  if (version.status === 'ready') return { phase: 'reanchoring' }
  return { phase: 'processing' }
}
