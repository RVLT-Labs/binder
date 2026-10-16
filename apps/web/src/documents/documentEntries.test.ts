import { describe, expect, it } from 'vitest'
import {
  buildDocumentEntries,
  type DocumentSource,
  type PageProgress,
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
      isNewVersion: false,
    })
    expect(entries[1]).toMatchObject({ kind: 'failed', reason: 'Processing failed.' })
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
