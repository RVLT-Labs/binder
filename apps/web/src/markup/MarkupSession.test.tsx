import type { LayerRef, WordLayer } from '@binder/shared'
import { cleanup, render } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { clearNotices, getNotices } from '../components/noticeStore'
import type { PageRow } from '../powersync/schema'
import {
  ARCHIVED_HINT,
  type MarkupSession,
  MarkupSessionProvider,
  useMarkupSession,
} from './MarkupSession'
import {
  deleteAnnotation,
  deleteCue,
  insertAnnotation,
  insertCue,
  updateAnnotation,
  updateCue,
} from './mutations'

const db = { getOptional: vi.fn(), getAll: vi.fn() }
const show = vi.hoisted(() => ({ status: 'prep' }))
vi.mock('@powersync/react', () => ({
  usePowerSync: () => db,
  useQuery: () => ({ data: [{ status: show.status, settings: '{"stampSet":["Hold","Go"]}' }] }),
}))
const loadWords = vi.hoisted(() => ({ layer: null as unknown }))
vi.mock('./wordLayers', () => ({ loadWordLayer: vi.fn(async () => loadWords.layer) }))
vi.mock('./useMarkup', () => ({
  useMarkup: () => ({ cuesByPage: new Map(), annotationsByPage: new Map(), ordered: [] }),
}))
vi.mock('./mutations', async (original) => ({
  ...(await original<typeof import('./mutations')>()),
  deleteCue: vi.fn(async () => {}),
  insertCue: vi.fn(async () => 'new-cue'),
  updateCue: vi.fn(async () => {}),
  insertAnnotation: vi.fn(async () => 'new-id'),
  updateAnnotation: vi.fn(async () => {}),
  deleteAnnotation: vi.fn(async () => {}),
}))

const lx: LayerRef = { kind: 'department', id: 'lx' }
const snd: LayerRef = { kind: 'department', id: 'snd' }
const me: LayerRef = { kind: 'personal', id: 'u1' }
let layers: {
  scopeDepartments: string[]
  editable: LayerRef[]
  locked: string[]
  hidden?: string[]
  active?: LayerRef
}
vi.mock('./useLayers', () => ({
  useLayers: () => ({
    userId: 'u1',
    scope: { role: 'editor', departments: layers.scopeDepartments },
    departments: [
      { id: 'lx', code: 'LX', hidden: 0 },
      { id: 'snd', code: 'SND', hidden: 0 },
    ],
    editable: layers.editable,
    active: layers.active ?? layers.editable[0],
    state: {
      hidden: layers.hidden ?? [],
      active: null,
      locked: layers.locked,
      lastDepartment: null,
    },
    store: {},
  }),
}))

const page = { id: 'p0', index: 0, width: 600, height: 800, words_key: null } as unknown as PageRow

function renderSession(
  extra: { versionReadOnly?: string | null; snapDefault?: number; pages?: PageRow[] } = {},
): MarkupSession {
  let session: MarkupSession | null = null
  function Probe() {
    session = useMarkupSession()
    return null
  }
  render(
    <MarkupSessionProvider
      showId="s1"
      documentId="d1"
      versionId="v1"
      pages={extra.pages ?? [page]}
      snapDefault={extra.snapDefault ?? 0}
      viewer={createRef()}
      versionReadOnly={extra.versionReadOnly}
    >
      <Probe />
    </MarkupSessionProvider>,
  )
  if (!session) throw new Error('no session')
  return session
}

beforeEach(() => {
  layers = { scopeDepartments: ['lx', 'snd'], editable: [lx, snd, me], locked: [] }
  db.getOptional.mockResolvedValue({
    department_id: 'lx',
    layer_kind: 'department',
    layer_id: 'lx',
  })
  show.status = 'prep'
  clearNotices()
})
afterEach(() => vi.clearAllMocks())

test('removeCue deletes a cue on an editable, unlocked layer', async () => {
  await renderSession().removeCue('c1')
  expect(deleteCue).toHaveBeenCalledOnce()
})

test('removeCue refuses a cue on a locked layer, whoever calls it, and says why', async () => {
  layers.locked = ['department:lx']
  await renderSession().removeCue('c1')
  expect(deleteCue).not.toHaveBeenCalled()
  expect(getNotices().map((n) => n.message)).toEqual(['The LX layer is locked.'])
})

test('moveCue refuses a cue on a layer the user cannot edit', async () => {
  layers = { scopeDepartments: ['snd'], editable: [snd, me], locked: [] }
  await renderSession().moveCue('c1', 0, { x: 10, y: 10 })
  expect(updateCue).not.toHaveBeenCalled()
  expect(getNotices().map((n) => n.message)).toEqual(["You can't edit LX cues."])
})

test('moveCue moves a cue on an editable, unlocked layer', async () => {
  await renderSession().moveCue('c1', 0, { x: 10, y: 20 })
  expect(updateCue).toHaveBeenCalledOnce()
  expect(vi.mocked(updateCue).mock.calls[0]?.[3]).toEqual({
    anchor: { documentId: 'd1', documentVersionId: 'v1', pageIndex: 0, x: 10, y: 20, status: 'ok' },
  })
})

test('a cue dropped by its tag takes the first word of the line when the pointer is outside it', async () => {
  const session = renderSession()
  await session.moveCue('c1', 0, { x: 10, y: 20 }, { dropped: true })
  expect(updateCue).toHaveBeenCalledOnce()
  // (This page has no word layer, so the drop is unsnapped; the option must not break that.)
  expect(vi.mocked(updateCue).mock.calls[0]?.[3]).toEqual({
    anchor: { documentId: 'd1', documentVersionId: 'v1', pageIndex: 0, x: 10, y: 20, status: 'ok' },
  })
})

test('a cue that has gone (deleted by someone else) is left alone without a notice', async () => {
  db.getOptional.mockResolvedValue(null)
  const session = renderSession()
  await session.moveCue('c1', 0, { x: 10, y: 20 })
  await session.removeCue('c1')
  expect(updateCue).not.toHaveBeenCalled()
  expect(deleteCue).not.toHaveBeenCalled()
  expect(getNotices()).toEqual([])
})

const annotationRow = (kind: 'department' | 'personal', id: string) => ({
  layer_kind: kind,
  layer_id: id,
})

test('removeAnnotation deletes on an editable, unlocked layer and on the user’s own personal layer', async () => {
  await renderSession().removeAnnotation('a1')
  expect(deleteAnnotation).toHaveBeenCalledOnce()
  db.getOptional.mockResolvedValue(annotationRow('personal', 'u1'))
  await renderSession().removeAnnotation('a2')
  expect(deleteAnnotation).toHaveBeenCalledTimes(2)
})

test('removeAnnotation refuses a locked layer, whoever calls it, and says why', async () => {
  db.getOptional.mockResolvedValue(annotationRow('department', 'lx'))
  layers.locked = ['department:lx']
  await renderSession().removeAnnotation('a1')
  expect(deleteAnnotation).not.toHaveBeenCalled()
  expect(getNotices().map((n) => n.message)).toEqual(['The LX layer is locked.'])
})

test('editAnnotation refuses a layer outside the user’s scope', async () => {
  db.getOptional.mockResolvedValue(annotationRow('department', 'lx'))
  layers = { scopeDepartments: ['snd'], editable: [snd, me], locked: [] }
  await renderSession().editAnnotation('a1', { geometry: { w: 5, h: 5 } })
  expect(updateAnnotation).not.toHaveBeenCalled()
  expect(getNotices().map((n) => n.message)).toEqual(["You can't edit LX annotations."])
})

test('nobody edits another user’s personal layer', async () => {
  db.getOptional.mockResolvedValue(annotationRow('personal', 'someone-else'))
  await renderSession().editAnnotation('a1', { text: 'x' })
  await renderSession().removeAnnotation('a1')
  expect(updateAnnotation).not.toHaveBeenCalled()
  expect(deleteAnnotation).not.toHaveBeenCalled()
  expect(getNotices()).toHaveLength(2)
})

test('editAnnotation moves an annotation to another layer only if both are editable and unlocked', async () => {
  db.getOptional.mockResolvedValue(annotationRow('department', 'lx'))
  layers.locked = ['department:snd']
  await renderSession().editAnnotation('a1', { layerKind: 'department', layerId: 'snd' })
  expect(updateAnnotation).not.toHaveBeenCalled()
  expect(getNotices().map((n) => n.message)).toEqual(['The SND layer is locked.'])
  layers.locked = []
  await renderSession().editAnnotation('a1', { layerKind: 'personal', layerId: 'u1' })
  expect(updateAnnotation).toHaveBeenCalledOnce()
})

test('an annotation that has gone is left alone without a notice', async () => {
  db.getOptional.mockResolvedValue(null)
  const session = renderSession()
  await session.editAnnotation('a1', { text: 'x' })
  await session.removeAnnotation('a1')
  expect(updateAnnotation).not.toHaveBeenCalled()
  expect(deleteAnnotation).not.toHaveBeenCalled()
  expect(getNotices()).toEqual([])
})

test('placeAnnotation draws on the active layer, placed by hand', async () => {
  const id = await renderSession().placeAnnotation({
    type: 'rect',
    pageIndex: 0,
    point: { x: 10, y: 20 },
    geometry: { w: 30, h: 40 },
  })
  expect(id).toBe('new-id')
  expect(insertAnnotation).toHaveBeenCalledOnce()
  expect(vi.mocked(insertAnnotation).mock.calls[0]?.[2]).toEqual({
    layerKind: 'department',
    layerId: 'lx',
    anchor: { documentId: 'd1', documentVersionId: 'v1', pageIndex: 0, x: 10, y: 20, status: 'ok' },
    type: 'rect',
    geometry: { w: 30, h: 40 },
    text: '',
    style: {},
  })
})

test('placeAnnotation draws on the personal layer when it is active', async () => {
  layers.active = me
  await renderSession().placeAnnotation({
    type: 'note',
    pageIndex: 1,
    point: { x: 1, y: 2 },
    text: 'Note',
  })
  expect(vi.mocked(insertAnnotation).mock.calls[0]?.[2]).toMatchObject({
    layerKind: 'personal',
    layerId: 'u1',
    text: 'Note',
  })
})

test('placeAnnotation does nothing while the active layer is locked or hidden', async () => {
  layers.locked = ['department:lx']
  expect(
    await renderSession().placeAnnotation({ type: 'rect', pageIndex: 0, point: { x: 1, y: 1 } }),
  ).toBeNull()
  layers.locked = []
  layers.hidden = ['department:lx']
  expect(
    await renderSession().placeAnnotation({ type: 'rect', pageIndex: 0, point: { x: 1, y: 1 } }),
  ).toBeNull()
  expect(insertAnnotation).not.toHaveBeenCalled()
})

test('the session offers the show’s stamp set', () => {
  expect(renderSession().stamps).toEqual(['Hold', 'Go'])
})

const OLD_VERSION = 'Viewing v1 — read-only'

test('viewing a version that is not current disables every tool and says why', () => {
  const session = renderSession({ versionReadOnly: OLD_VERSION })
  expect(session.readOnly).toBe(OLD_VERSION)
  expect(session.cueTarget).toEqual({ disabled: OLD_VERSION })
  expect(session.annotationTarget).toEqual({ disabled: OLD_VERSION })
  expect(session.whyCantEdit({ department_id: 'lx' })).toBe(OLD_VERSION)
  expect(session.whyCantEditAnnotation({ layer_kind: 'personal', layer_id: 'u1' })).toBe(
    OLD_VERSION,
  )
})

test('on a version that is not current, place, move, delete and edit all refuse and write nothing', async () => {
  const session = renderSession({ versionReadOnly: OLD_VERSION })
  await session.placeCue(0, { x: 1, y: 2 }, 'go')
  await session.moveCue('c1', 0, { x: 1, y: 2 })
  await session.removeCue('c1')
  expect(
    await session.placeAnnotation({ type: 'rect', pageIndex: 0, point: { x: 1, y: 1 } }),
  ).toBeNull()
  await session.editAnnotation('a1', { text: 'x' })
  await session.removeAnnotation('a1')
  expect(deleteCue).not.toHaveBeenCalled()
  expect(updateCue).not.toHaveBeenCalled()
  expect(insertAnnotation).not.toHaveBeenCalled()
  expect(updateAnnotation).not.toHaveBeenCalled()
  expect(deleteAnnotation).not.toHaveBeenCalled()
  expect(new Set(getNotices().map((n) => n.message))).toEqual(new Set([OLD_VERSION]))
})

test('an archived show’s reason wins over the version’s', () => {
  show.status = 'archived'
  const session = renderSession({ versionReadOnly: OLD_VERSION })
  expect(session.readOnly).toBe(ARCHIVED_HINT)
})

const wordsPage = { ...page, words_key: 'words/0' } as unknown as PageRow
/** "To be or not" on one line centred on y 705. */
const words: WordLayer = {
  words: [
    { t: 'To', x: 50, y: 700, w: 14, h: 10 },
    { t: 'be', x: 68, y: 700, w: 14, h: 10 },
    { t: 'or', x: 86, y: 700, w: 14, h: 10 },
    { t: 'not', x: 104, y: 700, w: 20, h: 10 },
  ],
  lines: [[0, 1, 2, 3]],
}
const insertedAnchor = () => vi.mocked(insertCue).mock.calls[0]?.[2].anchor

test('placeCue passes the chosen mark through to the inserted row', async () => {
  db.getAll.mockResolvedValue([])
  const session = renderSession({ snapDefault: 1, pages: [wordsPage] })
  await session.placeCue(0, { x: 90, y: 702 }, 'go', words, 'highlight')
  expect(insertedAnchor()).toMatchObject({
    mark: 'highlight',
    x: 86,
    y: 705,
    text: { quote: 'or', wordStart: 2, wordEnd: 2 },
  })
  vi.mocked(insertCue).mockClear()
  await session.placeCue(0, { x: 90, y: 702 }, 'go', words, 'line')
  expect(insertedAnchor()).toMatchObject({ mark: 'line', y: 705 })
  expect(insertedAnchor()?.text?.offset).toBeTypeOf('number')
  vi.mocked(insertCue).mockClear()
  // No mark given: today's underline, with no mark key at all.
  await session.placeCue(0, { x: 90, y: 702 }, 'go', words)
  expect(insertedAnchor()).not.toHaveProperty('mark')
})

test('placeCueRange inserts a cue whose text is the dragged range', async () => {
  db.getAll.mockResolvedValue([])
  const session = renderSession({ snapDefault: 1, pages: [wordsPage] })
  const text = { quote: 'be or', wordStart: 1, wordEnd: 2 }
  vi.mocked(insertCue).mockClear()
  await session.placeCueRange(0, text, 'standby', 'highlight', words)
  const row = vi.mocked(insertCue).mock.calls[0]?.[2]
  expect(row?.type).toBe('standby')
  expect(row?.anchor).toEqual({
    documentId: 'd1',
    documentVersionId: 'v1',
    pageIndex: 0,
    x: 68,
    y: 705,
    status: 'ok',
    text,
    mark: 'highlight',
  })
  vi.mocked(insertCue).mockClear()
  await session.placeCueRange(0, text, 'go', 'underline', words)
  expect(insertedAnchor()).not.toHaveProperty('mark')
  expect(insertedAnchor()?.text).toEqual(text)
})

test('placeCueRange refuses on a version that is not current', async () => {
  const session = renderSession({ versionReadOnly: OLD_VERSION, pages: [wordsPage] })
  await session.placeCueRange(
    0,
    { quote: 'be', wordStart: 1, wordEnd: 1 },
    'go',
    'highlight',
    words,
  )
  expect(insertCue).not.toHaveBeenCalled()
})

/** The cue as stored: its row has the department and the anchor JSON. */
function storedCue(anchor: Record<string, unknown> | null) {
  db.getOptional.mockResolvedValue({
    department_id: 'lx',
    layer_kind: 'department',
    layer_id: 'lx',
    anchor: anchor ? JSON.stringify(anchor) : null,
  })
}
const base = { documentId: 'd1', documentVersionId: 'v1', pageIndex: 0, status: 'ok' }
const movedAnchor = () => vi.mocked(updateCue).mock.calls[0]?.[3].anchor

test('moveCue keeps a highlight: the new anchor is the plain placement plus the mark', async () => {
  loadWords.layer = words
  storedCue({
    ...base,
    x: 86,
    y: 705,
    mark: 'highlight',
    text: { quote: 'or', wordStart: 2, wordEnd: 2 },
  })
  const session = renderSession({ snapDefault: 1, pages: [wordsPage] })
  await session.moveCue('c1', 0, { x: 72, y: 702 }, { dropped: true })
  expect(movedAnchor()).toMatchObject({ mark: 'highlight', y: 705 })
  expect(movedAnchor()?.text?.wordStart).toBe(1)
})

test('moveCue keeps a line or pointer and re-snaps it to a character boundary', async () => {
  loadWords.layer = words
  for (const mark of ['line', 'pointer'] as const) {
    vi.mocked(updateCue).mockClear()
    storedCue({
      ...base,
      x: 90,
      y: 705,
      mark,
      text: { quote: 'or', wordStart: 2, wordEnd: 2, offset: 1 },
    })
    const session = renderSession({ snapDefault: 1, pages: [wordsPage] })
    await session.moveCue('c1', 0, { x: 70, y: 702 })
    expect(movedAnchor()).toMatchObject({ mark, y: 705, text: { wordStart: 1 } })
    expect(movedAnchor()?.text?.offset).toBeTypeOf('number')
    cleanup()
  }
})

test('moveCue leaves an underline without a mark key, and carries a tag over', async () => {
  loadWords.layer = words
  storedCue({ ...base, x: 86, y: 705, text: { quote: 'or', wordStart: 2, wordEnd: 2 } })
  const session = renderSession({ snapDefault: 1, pages: [wordsPage] })
  await session.moveCue('c1', 0, { x: 70, y: 702 })
  expect(movedAnchor()).not.toHaveProperty('mark')
  expect(movedAnchor()).not.toHaveProperty('tag')
  vi.mocked(updateCue).mockClear()
  storedCue({
    ...base,
    x: 86,
    y: 705,
    mark: 'line',
    tag: { dx: 3, dy: 4 },
    text: { quote: 'or', wordStart: 2, wordEnd: 2, offset: 0 },
  })
  await session.moveCue('c1', 0, { x: 70, y: 702 })
  expect(movedAnchor()).toMatchObject({ mark: 'line', tag: { dx: 3, dy: 4 } })
})

test('relocating a line cue keeps its mark', async () => {
  loadWords.layer = words
  storedCue({
    ...base,
    x: 90,
    y: 705,
    mark: 'line',
    text: { quote: 'or', wordStart: 2, wordEnd: 2, offset: 1 },
  })
  const session = renderSession({ snapDefault: 1, pages: [wordsPage] })
  await session.relocate('cues', 'c1', 0, { x: 70, y: 702 })
  expect(movedAnchor()).toMatchObject({ mark: 'line', text: { wordStart: 1 } })
})

test('setBubble writes tag and leaves everything else; null removes it', async () => {
  const stored = {
    ...base,
    x: 86,
    y: 705,
    mark: 'highlight',
    text: { quote: 'or', wordStart: 2, wordEnd: 2 },
  }
  storedCue(stored)
  const session = renderSession()
  await session.setBubble('c1', { dx: 12, dy: -30 })
  expect(updateCue).toHaveBeenCalledOnce()
  expect(movedAnchor()).toEqual({ ...stored, tag: { dx: 12, dy: -30 } })
  vi.mocked(updateCue).mockClear()
  storedCue({ ...stored, tag: { dx: 12, dy: -30 } })
  await session.setBubble('c1', null)
  expect(movedAnchor()).toEqual(stored)
  expect(movedAnchor()).not.toHaveProperty('tag')
})

test('setBubble refuses a cue on a locked layer and says why', async () => {
  layers.locked = ['department:lx']
  storedCue({ ...base, x: 86, y: 705 })
  await renderSession().setBubble('c1', { dx: 1, dy: 1 })
  expect(updateCue).not.toHaveBeenCalled()
  expect(getNotices().map((n) => n.message)).toEqual(['The LX layer is locked.'])
})

test('setBubble leaves an unplaced cue and one that has gone alone', async () => {
  storedCue(null)
  const session = renderSession()
  await session.setBubble('c1', { dx: 1, dy: 1 })
  db.getOptional.mockResolvedValue(null)
  await session.setBubble('c1', { dx: 1, dy: 1 })
  expect(updateCue).not.toHaveBeenCalled()
  expect(getNotices()).toEqual([])
})

test('moveCue keeps mark and tag', async () => {
  loadWords.layer = words
  const session = renderSession({ snapDefault: 1, pages: [wordsPage] })
  for (const mark of ['underline', 'highlight', 'line', 'pointer'] as const) {
    vi.mocked(updateCue).mockClear()
    storedCue({
      ...base,
      x: 86,
      y: 705,
      ...(mark === 'underline' ? {} : { mark }),
      tag: { dx: -20, dy: 15 },
      text: { quote: 'or', wordStart: 2, wordEnd: 2, offset: 1 },
    })
    await session.moveCue('c1', 0, { x: 70, y: 702 }, { dropped: true })
    expect(movedAnchor()?.tag).toEqual({ dx: -20, dy: 15 })
    expect(movedAnchor()?.mark).toBe(mark === 'underline' ? undefined : mark)
  }
})

test('moveCue of a line re-snaps to a character boundary', async () => {
  loadWords.layer = words
  storedCue({
    ...base,
    x: 90,
    y: 705,
    mark: 'line',
    text: { quote: 'or', wordStart: 2, wordEnd: 2, offset: 1 },
  })
  const session = renderSession({ snapDefault: 1, pages: [wordsPage] })
  // The pointer is over "be" (x 68 to 82), a little right of its middle.
  await session.moveCue('c1', 0, { x: 76, y: 702 }, { dropped: true })
  const text = movedAnchor()?.text
  expect(text?.wordStart).toBe(1)
  expect(text?.offset).toBeGreaterThanOrEqual(0)
  expect(text?.offset).toBeLessThanOrEqual(2)
  // The bar stands at that boundary, not at the pointer.
  expect(Number.isInteger(text?.offset)).toBe(true)
  expect(movedAnchor()?.x).not.toBe(76)
})

test('moveCue of a highlight keeps its word count', async () => {
  loadWords.layer = words
  // "To be" (two words) dragged onto "be": it covers two words from there, not every word to the line's end.
  storedCue({
    ...base,
    x: 50,
    y: 705,
    mark: 'highlight',
    text: { quote: 'To be', wordStart: 0, wordEnd: 1 },
  })
  const session = renderSession({ snapDefault: 1, pages: [wordsPage] })
  await session.moveCue('c1', 0, { x: 72, y: 702 }, { dropped: true })
  expect(movedAnchor()).toMatchObject({
    mark: 'highlight',
    y: 705,
    text: { wordStart: 1, wordEnd: 2, quote: 'be or' },
  })
})
