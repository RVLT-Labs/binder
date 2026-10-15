import type { LayerRef } from '@binder/shared'
import { render } from '@testing-library/react'
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
  updateAnnotation,
  updateCue,
} from './mutations'

const db = { getOptional: vi.fn(), getAll: vi.fn() }
const show = vi.hoisted(() => ({ status: 'prep' }))
vi.mock('@powersync/react', () => ({
  usePowerSync: () => db,
  useQuery: () => ({ data: [{ status: show.status, settings: '{"stampSet":["Hold","Go"]}' }] }),
}))
vi.mock('./useMarkup', () => ({
  useMarkup: () => ({ cuesByPage: new Map(), annotationsByPage: new Map(), ordered: [] }),
}))
vi.mock('./mutations', async (original) => ({
  ...(await original<typeof import('./mutations')>()),
  deleteCue: vi.fn(async () => {}),
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

function renderSession(extra: { versionReadOnly?: string | null } = {}): MarkupSession {
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
      pages={[page]}
      snapDefault={0}
      viewer={createRef()}
      {...extra}
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
