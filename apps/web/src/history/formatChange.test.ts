import type { HistoryEntry } from '@binder/shared'
import { describe, expect, test } from 'vitest'
import { type ChangeContext, formatChange } from './formatChange'

/** A change log row with just what a test names; the rest is filler. */
function entryOf(partial: Partial<HistoryEntry>): HistoryEntry {
  return {
    seq: 1,
    serverTs: '2026-03-02T10:15:00.000Z',
    clientTs: null,
    userId: 'u1',
    userName: 'Ada',
    via: 'sync',
    agent: null,
    batchId: 'b1',
    table: 'cues',
    rowId: 'r1',
    op: 'update',
    before: null,
    after: null,
    layer: null,
    ...partial,
  }
}

const lx: ChangeContext = { departmentCode: 'LX', numberFormat: 'decimal' }
const anchor = (pageIndex: number) => ({
  documentId: 'd',
  documentVersionId: 'v',
  pageIndex,
  x: 10,
  y: 20,
  status: 'ok',
})

test.each([
  [
    { op: 'update', before: { anchor: { pageIndex: 8 } }, after: { anchor: { pageIndex: 9 } } },
    ['Moved p.9 → p.10'],
  ],
  [
    { op: 'update', before: { major: 12, minor: 0 }, after: { major: 12, minor: 50 } },
    ['Renumbered LX 12 → LX 12.5'],
  ],
  [
    { op: 'update', before: { label: 'Fly out' }, after: { label: 'Fly in' } },
    ['Label "Fly out" → "Fly in"'],
  ],
  [{ op: 'insert', before: null, after: { anchor: null } }, ['Added (unplaced)']],
] as Array<[Partial<HistoryEntry>, string[]]>)('formats %j', (entry, lines) => {
  expect(formatChange(entryOf(entry), lx)).toEqual(lines)
})

describe('cues', () => {
  test('a move within a page says so', () => {
    const e = entryOf({ before: { anchor: anchor(8) }, after: { anchor: anchor(8) } })
    expect(formatChange(e, lx)).toEqual(['Moved on p.9'])
  })

  test('placing and unplacing', () => {
    expect(
      formatChange(entryOf({ before: { anchor: null }, after: { anchor: anchor(2) } }), lx),
    ).toEqual(['Placed on p.3'])
    expect(
      formatChange(entryOf({ before: { anchor: anchor(2) }, after: { anchor: null } }), lx),
    ).toEqual(['Unplaced'])
  })

  test('an insert names its page; a delete says Deleted', () => {
    expect(formatChange(entryOf({ op: 'insert', after: { anchor: anchor(2) } }), lx)).toEqual([
      'Placed on p.3',
    ])
    expect(formatChange(entryOf({ op: 'delete', before: { anchor: anchor(2) } }), lx)).toEqual([
      'Deleted',
    ])
  })

  test('the type, notes, and several columns at once, in a fixed order', () => {
    const e = entryOf({
      before: { type: 'go', notes: 'a', label: 'x', anchor: anchor(0) },
      after: { type: 'standby', notes: 'b', label: 'y', anchor: anchor(1) },
    })
    expect(formatChange(e, lx)).toEqual([
      'Moved p.1 → p.2',
      'Label "x" → "y"',
      'Type go → standby',
      'Notes edited',
    ])
  })

  test('numbers follow the department format and omit a missing code', () => {
    const e = entryOf({ before: { major: 14, minor: 0 }, after: { major: 14, minor: 50 } })
    expect(formatChange(e, { departmentCode: 'SND', numberFormat: 'point' })).toEqual([
      'Renumbered SND 14 → SND 14.50',
    ])
    expect(formatChange(e, { departmentCode: null, numberFormat: 'decimal' })).toEqual([
      'Renumbered 14 → 14.5',
    ])
  })

  test('a log row holds only the changed columns: the unchanged major comes from the context', () => {
    const e = entryOf({ before: { minor: 0 }, after: { minor: 50 } })
    expect(formatChange(e, { ...lx, numberAfter: { major: 12, minor: 50 } })).toEqual([
      'Renumbered LX 12 → LX 12.5',
    ])
    // Without it the number is not known, and the line still reads.
    expect(formatChange(e, lx)).toEqual(['Renumbered'])
  })

  test('a quote in a label is kept as it is', () => {
    const e = entryOf({ before: { label: '' }, after: { label: 'The "big" one' } })
    expect(formatChange(e, lx)).toEqual(['Label "" → "The "big" one"'])
  })

  test('bookkeeping columns alone read as a plain edit', () => {
    expect(
      formatChange(entryOf({ before: { updatedAt: 'a' }, after: { updatedAt: 'b' } }), lx),
    ).toEqual(['Edited'])
  })
})

describe('annotations', () => {
  const annotation = (partial: Partial<HistoryEntry>) =>
    entryOf({ table: 'annotations', ...partial })

  test('text, geometry, and style', () => {
    expect(formatChange(annotation({ before: { text: 'a' }, after: { text: 'b' } }), lx)).toEqual([
      'Text edited',
    ])
    expect(
      formatChange(
        annotation({ before: { geometry: { w: 1 } }, after: { geometry: { w: 2 } } }),
        lx,
      ),
    ).toEqual(['Resized'])
    expect(
      formatChange(
        annotation({ before: { style: { colour: 'a' } }, after: { style: { colour: 'b' } } }),
        lx,
      ),
    ).toEqual(['Restyled'])
  })

  test('an insert is placed on its page; a delete is Deleted', () => {
    expect(formatChange(annotation({ op: 'insert', after: { anchor: anchor(0) } }), lx)).toEqual([
      'Placed on p.1',
    ])
    expect(formatChange(annotation({ op: 'delete', before: { anchor: anchor(0) } }), lx)).toEqual([
      'Deleted',
    ])
  })

  test('a layer change copes with a redacted personal layer id', () => {
    const e = annotation({
      before: { layerKind: 'personal', layerId: null },
      after: { layerKind: 'department', layerId: 'd1' },
    })
    expect(formatChange(e, lx)).toEqual(['Layer Personal → a department layer'])
    const named = formatChange(e, {
      ...lx,
      layerName: (kind, id) => (kind === 'department' && id === 'd1' ? 'LX' : null),
    })
    expect(named).toEqual(['Layer Personal → LX'])
  })
})

describe('other tables', () => {
  test('are described by their op', () => {
    expect(formatChange(entryOf({ table: 'documents', op: 'insert' }), lx)).toEqual(['Added'])
    expect(formatChange(entryOf({ table: 'documents', op: 'delete' }), lx)).toEqual(['Deleted'])
    expect(
      formatChange(
        entryOf({ table: 'documents', before: { title: 'a' }, after: { title: 'b' } }),
        lx,
      ),
    ).toEqual(['Edited'])
  })
})

describe('a restyle reads as a restyle, not a move', () => {
  const at = (extra: Record<string, unknown>, text?: Record<string, unknown>) => ({
    ...anchor(2),
    ...(text ? { text: { quote: 'or', wordStart: 2, wordEnd: 2, ...text } } : {}),
    ...extra,
  })
  const lines = (before: unknown, after: unknown) =>
    formatChange(entryOf({ before: { anchor: before }, after: { anchor: after } }), lx)

  test('a mark change names both marks', () => {
    expect(lines(at({}, {}), at({ mark: 'highlight' }, {}))).toEqual(['Mark Underline → Highlight'])
    expect(
      lines(at({ mark: 'highlight' }, {}), at({ mark: 'pointer', x: 14 }, { offset: 1 })),
    ).toEqual(['Mark Highlight → Line with pointer'])
    expect(
      lines(
        at({ mark: 'line', x: 14 }, { offset: 1 }),
        at({ mark: 'pointer', x: 20 }, { offset: 2 }),
      ),
    ).toEqual(['Mark Line → Line with pointer'])
  })

  test('dragging a line along its text, the same mark with a new offset, reads Moved', () => {
    expect(
      lines(at({ mark: 'line', x: 14 }, { offset: 1 }), at({ mark: 'line', x: 20 }, { offset: 2 })),
    ).toEqual(['Moved on p.3'])
    expect(
      lines(at({ mark: 'pointer' }, { offset: 0 }), at({ mark: 'pointer' }, { offset: 2 })),
    ).toEqual(['Moved on p.3'])
  })

  test('anchors held as JSON text read the same', () => {
    expect(
      lines(JSON.stringify(at({}, {})), JSON.stringify(at({ mark: 'line' }, { offset: 0 }))),
    ).toEqual(['Mark Underline → Line'])
  })

  test('a real move, even of a styled cue, still reads Moved', () => {
    expect(
      lines(at({ mark: 'highlight' }, {}), { ...at({ mark: 'highlight' }, {}), pageIndex: 3 }),
    ).toEqual(['Moved p.3 → p.4'])
    expect(
      lines(at({ mark: 'highlight' }, {}), { ...at({ mark: 'highlight' }, {}), y: 99 }),
    ).toEqual(['Moved on p.3'])
  })

  test('an annotation anchor change is never a restyle', () => {
    const e = entryOf({
      table: 'annotations',
      before: { anchor: anchor(2) },
      after: { anchor: { ...anchor(2), y: 99 } },
    })
    expect(formatChange(e, lx)).toEqual(['Moved on p.3'])
  })
})

describe('a bubble moved on the page', () => {
  const lines = (before: unknown, after: unknown) =>
    formatChange(entryOf({ before: { anchor: before }, after: { anchor: after } }), lx)

  test('setting or changing the tag reads Bubble moved', () => {
    expect(lines(anchor(2), { ...anchor(2), tag: { dx: 5, dy: -9 } })).toEqual(['Bubble moved'])
    expect(
      lines({ ...anchor(2), tag: { dx: 5, dy: -9 } }, { ...anchor(2), tag: { dx: 8, dy: -9 } }),
    ).toEqual(['Bubble moved'])
  })

  test('removing the tag reads Bubble back in the margin', () => {
    expect(lines({ ...anchor(2), tag: { dx: 5, dy: -9 } }, anchor(2))).toEqual([
      'Bubble back in the margin',
    ])
    expect(lines({ ...anchor(2), tag: { dx: 5, dy: -9 } }, { ...anchor(2), tag: null })).toEqual([
      'Bubble back in the margin',
    ])
  })

  test('anchors held as JSON text read the same', () => {
    expect(
      lines(JSON.stringify(anchor(2)), JSON.stringify({ ...anchor(2), tag: { dx: 1, dy: 1 } })),
    ).toEqual(['Bubble moved'])
  })

  test('a tag change together with a real move still reads Moved', () => {
    expect(lines(anchor(2), { ...anchor(2), y: 99, tag: { dx: 5, dy: -9 } })).toEqual([
      'Moved on p.3',
    ])
  })

  test('an annotation anchor change is never a bubble move', () => {
    const e = entryOf({
      table: 'annotations',
      before: { anchor: anchor(2) },
      after: { anchor: { ...anchor(2), tag: { dx: 1, dy: 1 } } },
    })
    expect(formatChange(e, lx)).toEqual(['Moved on p.3'])
  })
})
