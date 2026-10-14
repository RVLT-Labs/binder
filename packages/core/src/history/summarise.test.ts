import { describe, expect, test } from 'vitest'
import { actorLabel, type SummaryRow, summariseBatch } from './summarise'

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
    expect(summariseBatch([row('documents', 'insert')])).toBe('added 1 document')
    expect(summariseBatch([row('shows', 'update')])).toBe('updated 1 show')
    expect(summariseBatch([row('document_versions', 'insert'), row('shows', 'update')])).toBe(
      'added 1 document_version; updated 1 show',
    )
  })

  test('an empty batch is an empty sentence', () => expect(summariseBatch([])).toBe(''))
})

describe('actorLabel', () => {
  test('a person alone', () => expect(actorLabel('Jayden', null)).toBe('Jayden'))
  test('agent label drops the version', () =>
    expect(actorLabel('Jayden', 'Claude Code/2.1.0')).toBe('Jayden via Claude Code'))
  test('an agent without a version is used whole', () =>
    expect(actorLabel('Jayden', 'test-client')).toBe('Jayden via test-client'))
})
