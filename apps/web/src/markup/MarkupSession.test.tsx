import type { LayerRef } from '@binder/shared'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { clearNotices, getNotices } from '../components/noticeStore'
import type { PageRow } from '../powersync/schema'
import { type MarkupSession, MarkupSessionProvider, useMarkupSession } from './MarkupSession'
import { deleteCue, updateCue } from './mutations'

const db = { getOptional: vi.fn(), getAll: vi.fn() }
vi.mock('@powersync/react', () => ({
  usePowerSync: () => db,
  useQuery: () => ({ data: [{ status: 'prep' }] }),
}))
vi.mock('./useMarkup', () => ({
  useMarkup: () => ({ cuesByPage: new Map(), annotationsByPage: new Map(), ordered: [] }),
}))
vi.mock('./mutations', async (original) => ({
  ...(await original<typeof import('./mutations')>()),
  deleteCue: vi.fn(async () => {}),
  updateCue: vi.fn(async () => {}),
}))

const lx: LayerRef = { kind: 'department', id: 'lx' }
const snd: LayerRef = { kind: 'department', id: 'snd' }
const me: LayerRef = { kind: 'personal', id: 'u1' }
let layers: { scopeDepartments: string[]; editable: LayerRef[]; locked: string[] }
vi.mock('./useLayers', () => ({
  useLayers: () => ({
    userId: 'u1',
    scope: { role: 'editor', departments: layers.scopeDepartments },
    departments: [
      { id: 'lx', code: 'LX', hidden: 0 },
      { id: 'snd', code: 'SND', hidden: 0 },
    ],
    editable: layers.editable,
    active: layers.editable[0],
    state: { hidden: [], active: null, locked: layers.locked, lastDepartment: null },
    store: {},
  }),
}))

const page = { id: 'p0', index: 0, width: 600, height: 800, words_key: null } as unknown as PageRow

function renderSession(): MarkupSession {
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
    >
      <Probe />
    </MarkupSessionProvider>,
  )
  if (!session) throw new Error('no session')
  return session
}

beforeEach(() => {
  layers = { scopeDepartments: ['lx', 'snd'], editable: [lx, snd, me], locked: [] }
  db.getOptional.mockResolvedValue({ department_id: 'lx' })
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

test('a cue that has gone (deleted by someone else) is left alone without a notice', async () => {
  db.getOptional.mockResolvedValue(null)
  const session = renderSession()
  await session.moveCue('c1', 0, { x: 10, y: 20 })
  await session.removeCue('c1')
  expect(updateCue).not.toHaveBeenCalled()
  expect(deleteCue).not.toHaveBeenCalled()
  expect(getNotices()).toEqual([])
})
