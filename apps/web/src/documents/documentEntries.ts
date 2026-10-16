/**
 * What the Documents screen and the overview's Scripts card draw, worked out from the local rows.
 * Only what the data knows is shown (the version's status and error, its page rows): a version is
 * queued, processing, ready or failed, so the processing steps are derived from that, not reported
 * by the pipeline, and the progress bar is ready pages over pages or, with no page rows yet, unknown.
 */

import { describeFailure, isFailureCode } from '@binder/shared'

export interface DocumentSource {
  id: string
  title: string | null
  kind: string | null
  current_version_id: string | null
}

export interface VersionSource {
  id: string
  document_id: string | null
  version_number: number | null
  label: string | null
  status: string | null
  error: string | null
  page_count: number | null
  searchable_key: string | null
  /** The uploaded file's size; null for a version uploaded before it was recorded. */
  original_size_bytes: number | null
  /** Why a failed version failed (see `describeFailure`); null for a legacy failure. */
  failure_code: string | null
  /** The scan resolution behind a `low_resolution` failure. */
  failure_dpi: number | null
}

export interface PageProgress {
  ready: number
  total: number
}

export interface EntryContext {
  /** Page rows per version, with how many are ready. */
  pages: ReadonlyMap<string, PageProgress>
  /** Cues anchored to each version: what a new version re-anchors. */
  cuesByVersion: ReadonlyMap<string, number>
}

export interface VersionStep {
  key: 'upload' | 'extract' | 'layer' | 'reanchor'
  label: string
  state: 'done' | 'current' | 'pending'
}

export interface ReadyEntry {
  kind: 'ready'
  /** Unique within the list. */
  key: string
  docId: string
  title: string
  docKind: string | null
  version: {
    id: string
    number: number
    label: string | null
    pageCount: number | null
    /** There is a searchable PDF to find text in. */
    searchable: boolean
  }
  /** The ready version just before this one, still on the device. */
  kept: { number: number; pageCount: number | null } | null
  /** Two or more ready versions to compare: the previous and the current. */
  compare: { from: number; to: number } | null
}

export interface ProcessingEntry {
  kind: 'processing'
  key: string
  docId: string
  /** Absent only while the version row has not synced yet. */
  versionId: string | null
  title: string
  /** The number of the new version when the document already had one; null for a first upload. */
  versionNumber: number | null
  /** The version still in use meanwhile, for a new version. */
  currentNumber: number | null
  /** `reanchoring`: the version is ready, but the document still uses the one before it while its cues move. */
  status: 'queued' | 'processing' | 'reanchoring'
  /** Ready pages of the pages known; null when page rows have not appeared. */
  progress: PageProgress | null
  steps: VersionStep[]
  /** The upload's size, for "12 MB uploaded"; null when it was not recorded. */
  sizeBytes: number | null
  /** The version is queued or processing, so Cancel can stop it; not the re-anchoring wait, nor before the row syncs. */
  canCancel: boolean
}

export interface FailedEntry {
  kind: 'failed'
  key: string
  docId: string
  versionId: string
  title: string
  versionNumber: number | null
  currentNumber: number | null
  /** The recorded failure code; null for a legacy row that has none. */
  code: string | null
  /** The pill: `describeFailure(code).title`, or a stock one for a legacy row. */
  pill: string
  /** What went wrong in plain words: the code's copy, or for a legacy row the pipeline's sentence without the tool output after it. */
  reason: string
  /** The full recorded error, when it says more than `reason` (tool output); null otherwise. */
  detail: string | null
  /** A new version of a document that already had one (so "upload again" is another version). */
  isNewVersion: boolean
  /** Running the same file again can succeed: "Try again" retries in place. Otherwise it opens the upload for a replacement. */
  canRetryInPlace: boolean
}

export type DocumentEntry = ReadyEntry | ProcessingEntry | FailedEntry

export const FAILED_FALLBACK = 'Binder could not process this file.'
/** The pill of a legacy failure, which has no code. */
export const LEGACY_FAILED_TITLE = 'couldn’t be processed'

/**
 * The pipeline writes "<plain sentence> (<tool output>)" (documentJob.markVersionFailed), so the
 * plain part is what comes before the first " (". An error with no plain part gets a stock line.
 */
export function splitFailure(error: string | null): { reason: string; detail: string | null } {
  const text = error?.trim() ?? ''
  const at = text.indexOf(' (')
  const plain = (at < 0 ? text : text.slice(0, at)).trim()
  if (!plain || plain.startsWith('(')) {
    return { reason: FAILED_FALLBACK, detail: text || null }
  }
  return { reason: plain, detail: at < 0 ? null : text }
}

/** The failed entry's words: from the code when there is one, else the legacy sentence split from the tool output. */
export function failureWords(
  v: Pick<VersionSource, 'error' | 'failure_code' | 'failure_dpi'>,
): Pick<FailedEntry, 'code' | 'pill' | 'reason' | 'detail' | 'canRetryInPlace'> {
  const split = splitFailure(v.error)
  if (!v.failure_code) {
    return {
      code: null,
      pill: LEGACY_FAILED_TITLE,
      reason: split.reason,
      detail: split.detail,
      // We do not know why it failed, so the same file may fail again: ask for another upload.
      canRetryInPlace: false,
    }
  }
  const described = describeFailure(v.failure_code, { dpi: v.failure_dpi })
  const code = isFailureCode(v.failure_code) ? v.failure_code : 'unknown'
  const text = v.error?.trim() || null
  return {
    code,
    pill: described.title,
    reason: described.message,
    // The coded copy says it all; only tool output is worth a Details disclosure. An `unknown`
    // failure sends the reader there ("Details says why"), so it shows whatever was recorded.
    detail: split.detail ?? (code === 'unknown' ? text : null),
    canRetryInPlace: described.retryable,
  }
}

const num = (v: VersionSource) => v.version_number ?? 0

/** Documents in the order given, each as its ready entry and, if a newer version is not ready, a second one for it. */
export function buildDocumentEntries(
  documents: readonly DocumentSource[],
  versions: readonly VersionSource[],
  context: EntryContext,
): DocumentEntry[] {
  const byDocument = new Map<string, VersionSource[]>()
  for (const v of versions) {
    if (!v.document_id) continue
    byDocument.set(v.document_id, [...(byDocument.get(v.document_id) ?? []), v])
  }

  const entries: DocumentEntry[] = []
  for (const d of documents) {
    const title = d.title ?? ''
    const all = [...(byDocument.get(d.id) ?? [])].sort((a, b) => num(a) - num(b))
    const ready = all.filter((v) => v.status === 'ready')
    const current =
      all.find((v) => v.id === d.current_version_id && v.status === 'ready') ?? ready.at(-1)
    const newest = all.at(-1)

    if (current) {
      const before = ready.filter((v) => num(v) < num(current)).at(-1)
      entries.push({
        kind: 'ready',
        key: `${d.id}:${current.id}`,
        docId: d.id,
        title,
        docKind: d.kind,
        version: {
          id: current.id,
          number: num(current),
          label: current.label,
          pageCount: current.page_count,
          searchable: Boolean(current.searchable_key),
        },
        kept: before ? { number: num(before), pageCount: before.page_count } : null,
        compare: before ? { from: num(before), to: num(current) } : null,
      })
    }

    // Only the newest version can be in flight; an older failure that a later version replaced is gone.
    // A newest version that is ready but not yet the document's current one is the re-anchoring wait.
    if (newest && (!current || num(newest) > num(current))) {
      const isNew = current !== undefined
      if (newest.status === 'failed') {
        entries.push({
          kind: 'failed',
          key: `${d.id}:${newest.id}`,
          docId: d.id,
          versionId: newest.id,
          title,
          versionNumber: isNew ? num(newest) : null,
          currentNumber: current ? num(current) : null,
          ...failureWords(newest),
          isNewVersion: isNew,
        })
      } else {
        entries.push(processing(d, title, newest, current, context))
      }
    } else if (!newest) {
      entries.push(processing(d, title, undefined, undefined, context))
    }
  }
  return entries
}

function processing(
  d: DocumentSource,
  title: string,
  version: VersionSource | undefined,
  current: VersionSource | undefined,
  { pages, cuesByVersion }: EntryContext,
): ProcessingEntry {
  const isNew = current !== undefined
  const known = version ? pages.get(version.id) : undefined
  const progress: PageProgress | null = known
    ? { ready: known.ready, total: version?.page_count ?? known.total }
    : null
  const cues = current ? (cuesByVersion.get(current.id) ?? 0) : 0
  const reanchoring = version?.status === 'ready'
  const steps: VersionStep[] = [
    { key: 'upload', label: 'Upload', state: 'done' },
    { key: 'extract', label: 'Extract text', state: reanchoring ? 'done' : 'current' },
    { key: 'layer', label: 'Build word layer', state: reanchoring ? 'done' : 'pending' },
  ]
  if (isNew) {
    steps.push({
      key: 'reanchor',
      label: `Re-anchor ${cues} ${cues === 1 ? 'cue' : 'cues'}`,
      state: reanchoring ? 'current' : 'pending',
    })
  }
  return {
    kind: 'processing',
    key: `${d.id}:${version?.id ?? 'new'}`,
    docId: d.id,
    versionId: version?.id ?? null,
    title,
    versionNumber: isNew && version ? num(version) : null,
    currentNumber: current ? num(current) : null,
    status: reanchoring
      ? 'reanchoring'
      : version?.status === 'processing'
        ? 'processing'
        : 'queued',
    progress: reanchoring ? null : progress,
    steps,
    sizeBytes: version?.original_size_bytes ?? null,
    canCancel: version !== undefined && !reanchoring,
  }
}
