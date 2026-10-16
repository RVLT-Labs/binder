import { describe, expect, it } from 'vitest'
import {
  buildDocumentEntries,
  type DocumentSource,
  type PageProgress,
  splitFailure,
  type VersionSource,
} from './documentEntries'

const doc = (id: string, title: string, current: string | null): DocumentSource => ({
  id,
  title,
  kind: 'libretto',
  current_version_id: current,
})
const version = (
  id: string,
  documentId: string,
  number: number,
  status: string,
  over: Partial<VersionSource> = {},
): VersionSource => ({
  id,
  document_id: documentId,
  version_number: number,
  label: null,
  status,
  error: null,
  page_count: null,
  searchable_key: 'k',
  original_size_bytes: null,
  failure_code: null,
  failure_dpi: null,
  ...over,
})

const none = { pages: new Map<string, PageProgress>(), cuesByVersion: new Map<string, number>() }

describe('buildDocumentEntries', () => {
  it('a document with a ready current version is one ready entry; the version before it is "kept"', () => {
    const entries = buildDocumentEntries(
      [doc('d1', 'Libretto', 'v2')],
      [
        version('v1', 'd1', 1, 'ready', { page_count: 48 }),
        version('v2', 'd1', 2, 'ready', { page_count: 43 }),
      ],
      none,
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: 'ready',
      title: 'Libretto',
      version: { id: 'v2', number: 2, pageCount: 43, searchable: true },
      kept: { number: 1, pageCount: 48 },
      compare: { from: 1, to: 2 },
    })
  })

  it('has no compare and nothing kept with a single version', () => {
    const [entry] = buildDocumentEntries(
      [doc('d1', 'Score', 'v1')],
      [version('v1', 'd1', 1, 'ready', { page_count: 188 })],
      none,
    )
    expect(entry).toMatchObject({ kind: 'ready', kept: null, compare: null })
  })

  it('shows a new version in flight beside the current one, with the re-anchor step and its cue count', () => {
    const entries = buildDocumentEntries(
      [doc('d1', 'Libretto', 'v2')],
      [
        version('v1', 'd1', 1, 'ready'),
        version('v2', 'd1', 2, 'ready'),
        version('v3', 'd1', 3, 'processing'),
      ],
      { pages: new Map(), cuesByVersion: new Map([['v2', 96]]) },
    )
    expect(entries.map((e) => e.kind)).toEqual(['ready', 'processing'])
    const processing = entries[1]
    if (processing.kind !== 'processing') throw new Error('expected a processing entry')
    expect(processing).toMatchObject({ title: 'Libretto', versionNumber: 3, currentNumber: 2 })
    expect(processing.steps.map((s) => [s.label, s.state])).toEqual([
      ['Upload', 'done'],
      ['Extract text', 'current'],
      ['Build word layer', 'pending'],
      ['Re-anchor 96 cues', 'pending'],
    ])
  })

  it('leaves the re-anchor step out for a document that never had a version', () => {
    const [entry] = buildDocumentEntries(
      [doc('d1', 'Blocking', null)],
      [version('v1', 'd1', 1, 'queued')],
      none,
    )
    if (entry.kind !== 'processing') throw new Error('expected a processing entry')
    expect(entry.versionNumber).toBeNull()
    expect(entry.steps.map((s) => s.label)).toEqual(['Upload', 'Extract text', 'Build word layer'])
  })

  it('progress is ready pages over the version page count, else over the page rows, else unknown', () => {
    const base = [doc('d1', 'Libretto', null)]
    const v = (over: Partial<VersionSource>) => [version('v1', 'd1', 1, 'processing', over)]
    const progress = (versions: VersionSource[], pages: Array<[string, PageProgress]>) => {
      const [e] = buildDocumentEntries(base, versions, { ...none, pages: new Map(pages) })
      if (e.kind !== 'processing') throw new Error('expected a processing entry')
      return e.progress
    }
    expect(progress(v({ page_count: 40 }), [['v1', { ready: 10, total: 38 }]])).toEqual({
      ready: 10,
      total: 40,
    })
    expect(progress(v({}), [['v1', { ready: 3, total: 12 }]])).toEqual({ ready: 3, total: 12 })
    expect(progress(v({}), [])).toBeNull()
  })

  it('a failed version carries its reason; a failure without one still says so', () => {
    const entries = buildDocumentEntries(
      [doc('d1', 'Blocking notes', null), doc('d2', 'Other', null)],
      [
        version('v1', 'd1', 1, 'failed', { error: 'No text layer and OCR is off' }),
        version('v2', 'd2', 1, 'failed'),
      ],
      none,
    )
    expect(entries[0]).toMatchObject({
      kind: 'failed',
      reason: 'No text layer and OCR is off',
      detail: null,
      isNewVersion: false,
    })
    expect(entries[1]).toMatchObject({
      kind: 'failed',
      reason: 'Binder could not process this file.',
      detail: null,
    })
  })

  it('failed entry copy comes from the code', () => {
    const [low, timeout, cancelled] = buildDocumentEntries(
      [doc('d1', 'Blocking notes.pdf', null), doc('d2', 'Big', null), doc('d3', 'Other', null)],
      [
        version('v1', 'd1', 1, 'failed', {
          error: 'No text could be read from the document (found 0 text characters)',
          failure_code: 'low_resolution',
          failure_dpi: 72,
        }),
        version('v2', 'd2', 1, 'failed', {
          error: 'Processing timed out after retries.',
          failure_code: 'timeout',
        }),
        version('v3', 'd3', 1, 'failed', { error: 'Cancelled', failure_code: 'cancelled' }),
      ],
      none,
    )
    expect(low).toMatchObject({
      kind: 'failed',
      code: 'low_resolution',
      pill: 'couldn’t read text',
      reason:
        'Scanned at 72 dpi, so there is no text to search or anchor to. Try a 300 dpi scan. Or remove this upload, then upload the file again as a new document with Text recognition set to Never, and mark it up by position.',
      detail: 'No text could be read from the document (found 0 text characters)',
      canRetryInPlace: false,
    })
    expect(timeout).toMatchObject({
      code: 'timeout',
      pill: 'couldn’t finish',
      canRetryInPlace: true,
    })
    expect(cancelled).toMatchObject({
      code: 'cancelled',
      pill: 'cancelled',
      detail: null,
      canRetryInPlace: true,
    })
  })

  it('a coded failure keeps the tool output behind Details', () => {
    const raw = 'This file could not be read as a PDF. (pdfinfo exit 1: Syntax Error)'
    const [entry] = buildDocumentEntries(
      [doc('d1', 'Bad', null)],
      [version('v1', 'd1', 1, 'failed', { error: raw, failure_code: 'unreadable' })],
      none,
    )
    expect(entry).toMatchObject({ code: 'unreadable', detail: raw, canRetryInPlace: false })
  })

  it('legacy null code falls back to splitFailure', () => {
    const raw = 'This file could not be read as a PDF. (ocrmypdf exit 2)'
    const [entry] = buildDocumentEntries(
      [doc('d1', 'Old', null)],
      [version('v1', 'd1', 1, 'failed', { error: raw })],
      none,
    )
    expect(entry).toMatchObject({
      code: null,
      pill: 'couldn’t be processed',
      reason: 'This file could not be read as a PDF.',
      detail: raw,
      canRetryInPlace: false,
    })
  })

  it('a processing entry carries the upload size and can be cancelled', () => {
    const [queued, running] = buildDocumentEntries(
      [doc('d1', 'Libretto', null), doc('d2', 'Score', null)],
      [
        version('v1', 'd1', 1, 'queued', { original_size_bytes: 12_400_000 }),
        version('v2', 'd2', 1, 'processing'),
      ],
      none,
    )
    expect(queued).toMatchObject({ kind: 'processing', sizeBytes: 12_400_000, canCancel: true })
    expect(running).toMatchObject({ kind: 'processing', sizeBytes: null, canCancel: true })
  })

  it('canCancel is false while re-anchoring and while the version row has not synced', () => {
    const [, wait] = buildDocumentEntries(
      [doc('d1', 'Libretto', 'v1')],
      [version('v1', 'd1', 1, 'ready'), version('v2', 'd1', 2, 'ready')],
      none,
    )
    expect(wait).toMatchObject({ kind: 'processing', status: 'reanchoring', canCancel: false })
    const [fresh] = buildDocumentEntries([doc('d1', 'New', null)], [], none)
    expect(fresh).toMatchObject({ kind: 'processing', versionId: null, canCancel: false })
  })

  it('a failed new version sits beside the current one and is marked as a new version', () => {
    const entries = buildDocumentEntries(
      [doc('d1', 'Libretto', 'v1')],
      [version('v1', 'd1', 1, 'ready'), version('v2', 'd1', 2, 'failed', { error: 'bad pdf' })],
      none,
    )
    expect(entries.map((e) => e.kind)).toEqual(['ready', 'failed'])
    expect(entries[1]).toMatchObject({ versionNumber: 2, isNewVersion: true })
  })

  it('does not show an old failed version once a newer one is ready', () => {
    const entries = buildDocumentEntries(
      [doc('d1', 'Libretto', 'v3')],
      [
        version('v1', 'd1', 1, 'ready'),
        version('v2', 'd1', 2, 'failed'),
        version('v3', 'd1', 3, 'ready'),
      ],
      none,
    )
    expect(entries.map((e) => e.kind)).toEqual(['ready'])
  })

  it('a newest version that is ready but not yet current is the re-anchoring wait', () => {
    const entries = buildDocumentEntries(
      [doc('d1', 'Libretto', 'v1')],
      [version('v1', 'd1', 1, 'ready'), version('v2', 'd1', 2, 'ready')],
      { pages: new Map(), cuesByVersion: new Map([['v1', 12]]) },
    )
    expect(entries.map((e) => e.kind)).toEqual(['ready', 'processing'])
    const wait = entries[1]
    if (wait.kind !== 'processing') throw new Error('expected a processing entry')
    expect(wait).toMatchObject({ status: 'reanchoring', versionNumber: 2, progress: null })
    expect(wait.steps.map((s) => [s.label, s.state])).toEqual([
      ['Upload', 'done'],
      ['Extract text', 'done'],
      ['Build word layer', 'done'],
      ['Re-anchor 12 cues', 'current'],
    ])
  })

  it('a document with no version row yet is shown as waiting, not dropped', () => {
    const [entry] = buildDocumentEntries([doc('d1', 'New', null)], [], none)
    expect(entry).toMatchObject({ kind: 'processing', title: 'New' })
  })
})

describe('splitFailure', () => {
  const raw =
    "This file could not be read as a PDF. (ocrmypdf exit 2: InputFileError; pdfinfo exit 1: Syntax Error: Couldn't find trailer dictionary)"

  it('keeps the plain sentence before the first " (" and the whole error as detail', () => {
    expect(splitFailure(raw)).toEqual({
      reason: 'This file could not be read as a PDF.',
      detail: raw,
    })
  })

  it('shows an error with no tool output as it is, with no detail', () => {
    expect(splitFailure('Could not queue processing')).toEqual({
      reason: 'Could not queue processing',
      detail: null,
    })
  })

  it('falls back to a stock line when there is no plain part, keeping what was recorded as detail', () => {
    expect(splitFailure('(pdfinfo exit 1)')).toEqual({
      reason: 'Binder could not process this file.',
      detail: '(pdfinfo exit 1)',
    })
    expect(splitFailure(null)).toEqual({
      reason: 'Binder could not process this file.',
      detail: null,
    })
    expect(splitFailure('  ')).toEqual({
      reason: 'Binder could not process this file.',
      detail: null,
    })
  })
})
