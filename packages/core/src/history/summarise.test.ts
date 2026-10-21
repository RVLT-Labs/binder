import { describe, expect, test } from 'vitest'
import { actorLabel, cardSentence, type SummaryRow, summariseBatch } from './summarise'

const cue = (
  op: SummaryRow['op'],
  code: string | null,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): SummaryRow => ({ table: 'cues', op, before, after, departmentCode: code })

const anchor = { pageIndex: 1, y: 100 }
const moves = (n: number, code: string) =>
  Array.from({ length: n }, () =>
    cue('update', code, { anchor }, { anchor: { pageIndex: 2, y: 5 } }),
  )
const relabel = (code: string) => cue('update', code, { label: 'a' }, { label: 'b' })
const placed = (n: number, code: string) =>
  Array.from({ length: n }, () => cue('insert', code, null, { label: 'x', anchor }))
const added = (n: number, code: string | null) =>
  Array.from({ length: n }, () => cue('insert', code, null, { label: 'x', anchor: null }))
const deleted = (n: number, code: string) =>
  Array.from({ length: n }, () => cue('delete', code, { label: 'x' }, null))

describe('summariseBatch', () => {
  test('three moves and one relabel of TM cues', () =>
    expect(summariseBatch([...moves(3, 'TM'), relabel('TM')])).toBe(
      'moved 3 TM cues and relabelled 1',
    ))

  test('forty-two TM cues placed', () =>
    expect(summariseBatch(placed(42, 'TM'))).toBe('placed 42 TM cues'))

  test('one unplaced LX cue added', () =>
    expect(summariseBatch(added(1, 'LX'))).toBe('added 1 LX cue'))

  test('two departments', () =>
    expect(summariseBatch([...moves(2, 'LX'), ...deleted(1, 'SND')])).toBe(
      'moved 2 LX cues; deleted 1 SND cue',
    ))

  test('three verbs join with commas and a final and, in the fixed verb order', () =>
    expect(
      summariseBatch([
        ...deleted(1, 'LX'),
        cue('update', 'LX', { notes: '' }, { notes: 'n' }),
        relabel('LX'),
        cue('update', 'LX', { major: 1 }, { major: 2 }),
      ]),
    ).toBe('renumbered 1 LX cue, relabelled 1, edited 1 and deleted 1'))

  test('an update counts once per verb it triggers', () =>
    expect(
      summariseBatch([cue('update', 'SND', { major: 1, label: 'a' }, { major: 2, label: 'b' })]),
    ).toBe('renumbered 1 SND cue and relabelled 1'))

  test('groups appear in order of first appearance and cues of one department stay together', () =>
    expect(summariseBatch([...deleted(1, 'SND'), ...moves(1, 'LX'), ...deleted(1, 'SND')])).toBe(
      'deleted 2 SND cues; moved 1 LX cue',
    ))

  test('a cue update of anything else is edited, including a department change', () =>
    expect(
      summariseBatch([cue('update', 'SND', { departmentId: 'a' }, { departmentId: 'b' })]),
    ).toBe('edited 1 SND cue'))

  test('a cue without a department code omits the code', () =>
    expect(summariseBatch(added(2, null))).toBe('added 2 cues'))

  describe('restyled', () => {
    const base = {
      documentId: 'd',
      documentVersionId: 'v',
      pageIndex: 1,
      x: 10,
      y: 100,
      status: 'ok',
      text: { quote: 'hello', wordStart: 2, wordEnd: 3 },
    }
    const update = (before: unknown, after: unknown) =>
      cue('update', 'LX', { anchor: before }, { anchor: after })

    test('a mark-only anchor change reads "restyled 1 LX cue"', () =>
      expect(summariseBatch([update(base, { ...base, mark: 'highlight' })])).toBe(
        'restyled 1 LX cue',
      ))

    test('a mark change that also moves the anchor reads moved', () =>
      expect(summariseBatch([update(base, { ...base, mark: 'highlight', pageIndex: 2 })])).toBe(
        'moved 1 LX cue',
      ))

    test('an offset-only change with the same mark reads moved: the caret is draggable', () =>
      expect(
        summariseBatch([
          update(
            { ...base, mark: 'line', text: { ...base.text, offset: 0 } },
            { ...base, mark: 'line', text: { ...base.text, offset: 3 } },
          ),
        ]),
      ).toBe('moved 1 LX cue'))

    test('switching to a line changes x without moving the cue', () =>
      expect(
        summariseBatch([
          update(base, { ...base, mark: 'line', x: 42, text: { ...base.text, offset: 0 } }),
        ]),
      ).toBe('restyled 1 LX cue'))

    test('x still counts as a move between two non-caret marks', () =>
      expect(summariseBatch([update(base, { ...base, mark: 'highlight', x: 42 })])).toBe(
        'moved 1 LX cue',
      ))

    test('a restyle and a relabel in one update counts both', () =>
      expect(
        summariseBatch([
          cue(
            'update',
            'LX',
            { anchor: base, label: 'a' },
            { anchor: { ...base, mark: 'highlight' }, label: 'b' },
          ),
        ]),
      ).toBe('restyled 1 LX cue and relabelled 1'))

    test('the verb sits after moved', () =>
      expect(
        summariseBatch([update(base, { ...base, mark: 'highlight' }), ...moves(1, 'LX')]),
      ).toBe('moved 1 LX cue and restyled 1'))
  })

  describe('bubble moved', () => {
    const base = {
      documentId: 'd',
      documentVersionId: 'v',
      pageIndex: 1,
      x: 10,
      y: 100,
      status: 'ok',
      text: { quote: 'hello', wordStart: 2, wordEnd: 3 },
    }
    const update = (before: unknown, after: unknown) =>
      cue('update', 'LX', { anchor: before }, { anchor: after })

    test('a tag-only anchor change reads "bubble moved 1 LX cue"', () =>
      expect(summariseBatch([update(base, { ...base, tag: { dx: 5, dy: -3 } })])).toBe(
        'bubble moved 1 LX cue',
      ))

    test('clearing the tag reads the same', () =>
      expect(summariseBatch([update({ ...base, tag: { dx: 5, dy: -3 } }, base)])).toBe(
        'bubble moved 1 LX cue',
      ))

    test('a tag change that also moves the anchor reads moved', () =>
      expect(summariseBatch([update(base, { ...base, y: 50, tag: { dx: 5, dy: -3 } })])).toBe(
        'moved 1 LX cue',
      ))

    test('the verb sits after restyled', () =>
      expect(
        summariseBatch([
          update(base, { ...base, tag: { dx: 5, dy: -3 } }),
          update(base, { ...base, mark: 'highlight' }),
        ]),
      ).toBe('restyled 1 LX cue and bubble moved 1'))

    test('the show card leads with the department', () =>
      expect(cardSentence([update(base, { ...base, tag: { dx: 5, dy: -3 } })])).toBe(
        'LX bubble moved 1 cue',
      ))
  })

  test('annotations: added, moved by anchor or geometry, edited, deleted', () => {
    const ann = (
      op: SummaryRow['op'],
      before: Record<string, unknown> | null,
      after: Record<string, unknown> | null,
    ): SummaryRow => ({ table: 'annotations', op, before, after, departmentCode: 'LX' })
    expect(
      summariseBatch([
        ann('insert', null, { type: 'note' }),
        ann('update', { geometry: {} }, { geometry: { x: 1 } }),
        ann('update', { anchor }, { anchor: { pageIndex: 3 } }),
        ann('update', { text: 'a' }, { text: 'b' }),
        ann('delete', { type: 'note' }, null),
      ]),
    ).toBe('added 1 LX annotation, moved 2, edited 1 and deleted 1')
  })

  test('other tables use added, updated, deleted and the singular table name', () => {
    const row = (table: string, op: SummaryRow['op']): SummaryRow => ({
      table,
      op,
      before: op === 'insert' ? null : { a: 1 },
      after: op === 'delete' ? null : { a: 2 },
      departmentCode: null,
    })
    expect(summariseBatch([row('departments', 'update'), row('departments', 'update')])).toBe(
      'updated 2 departments',
    )
    expect(summariseBatch([row('shows', 'update')])).toBe('updated 1 show')
    // a membership is a member to a person, and no table name leaks with its underscore
    expect(summariseBatch([row('show_memberships', 'insert')])).toBe('added 1 member')
    expect(summariseBatch([row('stamp_sets', 'update')])).toBe('updated 1 stamp set')
  })

  test('an upload reads as "uploaded", with the nouns document and revision', () => {
    const doc = (op: SummaryRow['op']): SummaryRow => ({
      table: 'documents',
      op,
      before: op === 'insert' ? null : { title: 'a' },
      after: op === 'delete' ? null : { title: 'b' },
      departmentCode: null,
    })
    const version = (n: number, op: SummaryRow['op'] = 'insert'): SummaryRow => ({
      table: 'document_versions',
      op,
      before: op === 'insert' ? null : { label: 'a' },
      after: op === 'delete' ? null : { versionNumber: n, label: 'b' },
      departmentCode: null,
    })
    expect(summariseBatch([doc('insert')])).toBe('uploaded 1 document')
    expect(summariseBatch([doc('insert'), doc('insert')])).toBe('uploaded 2 documents')
    expect(summariseBatch([version(2)])).toBe('uploaded 1 revision')
    expect(summariseBatch([version(2), version(3)])).toBe('uploaded 2 revisions')
    expect(summariseBatch([doc('update')])).toBe('updated 1 document')
    expect(summariseBatch([version(2, 'update')])).toBe('updated 1 revision')
    expect(summariseBatch([version(2), { ...doc('update'), table: 'shows' }])).toBe(
      'uploaded 1 revision; updated 1 show',
    )
  })

  test('uploads count a first version once with its document', () => {
    const docInsert: SummaryRow = {
      table: 'documents',
      op: 'insert',
      before: null,
      after: { title: 'Libretto' },
      departmentCode: null,
    }
    const v1: SummaryRow = {
      table: 'document_versions',
      op: 'insert',
      before: null,
      after: { versionNumber: 1 },
      departmentCode: null,
    }
    expect(summariseBatch([docInsert, v1])).toBe('uploaded 1 document')
    // A version 1 on its own (no document insert in the batch) is still an upload.
    expect(summariseBatch([v1])).toBe('uploaded 1 revision')
  })

  describe('processing controls', () => {
    const cancel: SummaryRow = {
      table: 'document_versions',
      op: 'update',
      before: { status: 'processing', failureCode: null },
      after: { status: 'failed', failureCode: 'cancelled' },
      departmentCode: null,
    }
    const retry: SummaryRow = {
      table: 'document_versions',
      op: 'update',
      before: { status: 'failed', failureCode: 'timeout' },
      after: { status: 'queued', failureCode: null },
      departmentCode: null,
    }
    const removeVersion: SummaryRow = {
      table: 'document_versions',
      op: 'delete',
      before: { versionNumber: 1, status: 'failed', failureCode: 'unreadable' },
      after: null,
      departmentCode: null,
    }
    const removeDocument: SummaryRow = {
      table: 'documents',
      op: 'delete',
      before: { title: 'Libretto' },
      after: null,
      departmentCode: null,
    }

    test('cancelled, retried and removed read "1 upload"', () => {
      expect(summariseBatch([cancel])).toBe('cancelled 1 upload')
      expect(summariseBatch([retry])).toBe('retried 1 upload')
      expect(summariseBatch([removeVersion])).toBe('removed 1 upload')
      expect(summariseBatch([cancel, cancel])).toBe('cancelled 2 uploads')
    })

    test("removing an only version counts the document's own version once", () => {
      expect(summariseBatch([removeVersion, removeDocument])).toBe('removed 1 upload')
    })

    test('other updates to a version are still "updated"', () => {
      const relabelled: SummaryRow = {
        ...cancel,
        before: { label: 'a' },
        after: { label: 'b' },
      }
      expect(summariseBatch([relabelled])).toBe('updated 1 revision')
    })

    test('the new verbs join other clauses without repeating the noun', () => {
      const uploaded: SummaryRow = {
        table: 'document_versions',
        op: 'insert',
        before: null,
        after: { versionNumber: 2 },
        departmentCode: null,
      }
      expect(summariseBatch([uploaded, cancel])).toBe('uploaded 1 revision and cancelled 1')
    })
  })

  test('an empty batch is an empty sentence', () => expect(summariseBatch([])).toBe(''))
})

describe('cardSentence', () => {
  const upload = (
    table: 'documents' | 'document_versions',
    versionNumber?: number,
  ): SummaryRow => ({
    table,
    op: 'insert',
    before: null,
    after: versionNumber === undefined ? { title: 'Libretto' } : { versionNumber },
    departmentCode: null,
  })

  test('one department group leads with the code', () => {
    expect(cardSentence([relabel('LX'), relabel('LX'), relabel('LX')])).toBe('LX relabelled 3 cues')
    expect(cardSentence([...moves(3, 'LX'), relabel('LX')])).toBe(
      'LX moved 3 cues and relabelled 1',
    )
    expect(cardSentence(placed(1, 'SND'))).toBe('SND placed 1 cue')
  })

  test('annotations lead with the code too, and a cue without a code has none', () => {
    const note: SummaryRow = {
      table: 'annotations',
      op: 'insert',
      before: null,
      after: { type: 'note' },
      departmentCode: 'LX',
    }
    expect(cardSentence([note, note])).toBe('LX added 2 annotations')
    expect(cardSentence(added(2, null))).toBe('added 2 cues')
  })

  test('revision insert', () => {
    expect(cardSentence([upload('document_versions', 2)])).toBe('revision uploaded')
    expect(cardSentence([upload('document_versions', 2), upload('document_versions', 3)])).toBe(
      '2 revisions uploaded',
    )
  })

  test('document insert, with its first version counted once', () => {
    expect(cardSentence([upload('documents'), upload('document_versions', 1)])).toBe(
      'document uploaded',
    )
    expect(cardSentence([upload('documents'), upload('documents')])).toBe('2 documents uploaded')
  })

  test('mixed groups falls back to summariseBatch', () => {
    const mixed = [...moves(2, 'LX'), ...placed(1, 'SND')]
    expect(cardSentence(mixed)).toBe(summariseBatch(mixed))
    expect(cardSentence(mixed)).toBe('moved 2 LX cues; placed 1 SND cue')
    const withRevision = [upload('document_versions', 2), relabel('LX')]
    expect(cardSentence(withRevision)).toBe('uploaded 1 revision; relabelled 1 LX cue')
  })

  test('cancelled, retried and removed read "upload cancelled" and so on', () => {
    const version = (
      op: SummaryRow['op'],
      before: Record<string, unknown> | null,
      after: Record<string, unknown> | null,
    ): SummaryRow => ({ table: 'document_versions', op, before, after, departmentCode: null })
    const cancel = version(
      'update',
      { status: 'queued', failureCode: null },
      { status: 'failed', failureCode: 'cancelled' },
    )
    const retry = version(
      'update',
      { status: 'failed', failureCode: 'unknown' },
      { status: 'queued', failureCode: null },
    )
    const remove = version('delete', { versionNumber: 2, status: 'failed' }, null)
    expect(cardSentence([cancel])).toBe('upload cancelled')
    expect(cardSentence([cancel, cancel])).toBe('2 uploads cancelled')
    expect(cardSentence([retry])).toBe('upload retried')
    expect(cardSentence([remove])).toBe('upload removed')
    const removeDocument: SummaryRow = {
      table: 'documents',
      op: 'delete',
      before: { title: 'Libretto' },
      after: null,
      departmentCode: null,
    }
    expect(cardSentence([remove, removeDocument])).toBe('upload removed')
    // Mixed verbs fall back to the feed sentence.
    expect(cardSentence([cancel, retry])).toBe('cancelled 1 upload and retried 1')
  })

  test('an update to a document is not an upload and falls back', () => {
    const row: SummaryRow = {
      table: 'documents',
      op: 'update',
      before: { title: 'a' },
      after: { title: 'b' },
      departmentCode: null,
    }
    expect(cardSentence([row])).toBe('updated 1 document')
  })

  test('an empty batch is an empty sentence', () => expect(cardSentence([])).toBe(''))
})

describe('actorLabel', () => {
  test('a person alone', () => expect(actorLabel('Jayden', null)).toBe('Jayden'))
  test('agent label drops the version', () =>
    expect(actorLabel('Jayden', 'Claude Code/2.1.0')).toBe('Jayden via Claude Code'))
  test('an agent without a version is used whole', () =>
    expect(actorLabel('Jayden', 'test-client')).toBe('Jayden via test-client'))
  test('known client ids read as their product names', () => {
    expect(actorLabel('Jayden', 'claude-code/2.1.76 (cli)')).toBe('Jayden via Claude Code')
    expect(actorLabel('Jayden', 'claude-desktop/1.4')).toBe('Jayden via Claude Desktop')
    expect(actorLabel('Jayden', 'claude-ai')).toBe('Jayden via Claude')
    expect(actorLabel('Jayden', 'Claude-Code/2')).toBe('Jayden via Claude Code')
  })
  test('an unknown agent keeps its own name, and an empty one is the person alone', () => {
    expect(actorLabel('Jayden', 'cursor/0.5')).toBe('Jayden via cursor')
    expect(actorLabel('Jayden', '/1.0')).toBe('Jayden')
  })
})
