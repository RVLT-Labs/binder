import type { Anchor, CueFields } from '@binder/shared'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { clearNotices, getNotices } from '../components/noticeStore'
import { insertCue } from '../markup/mutations'
import { realDb } from '../test/realDb'

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
}))
vi.mock('@powersync/react', () => ({ usePowerSync: () => h.db }))
vi.mock('../markup/MarkupSession', () => ({ useMarkupSession: () => h.session }))

import { useUndo } from './useUndo'

const anchor: Anchor = {
  documentId: 'd',
  documentVersionId: 'v',
  pageIndex: 0,
  x: 1,
  y: 2,
  status: 'ok',
}
const fields: CueFields = {
  departmentId: 'lx',
  major: 10,
  minor: 0,
  label: 'Go',
  type: 'go',
  notes: '',
  colour: null,
  anchor,
}
const ctx = {
  showId: 'hook-show',
  userId: 'u1',
  scope: { role: 'owner' as const, departments: ['*'] },
}
const session = (why: string | null) => ({
  showId: 'hook-show',
  userId: 'u1',
  whyCantEdit: () => why,
  whyCantEditAnnotation: () => why,
})

let real: ReturnType<typeof realDb>
beforeEach(() => {
  real = realDb()
  h.db = real.db
  h.session = session(null)
  clearNotices()
})
afterEach(cleanup)

test('undo checks the live session after a re-render: a layer locked since is blocked and nothing is written', async () => {
  const { result, rerender } = renderHook(() => useUndo('hook-show'))
  await act(async () => {
    await insertCue(real.db, ctx, fields)
  })
  expect(result.current.canUndo).toBe(true)

  h.session = session('The LX layer is locked.')
  rerender()
  let outcome: unknown
  await act(async () => {
    outcome = await result.current.undo()
  })
  expect(outcome).toEqual({ status: 'blocked', reason: 'not-editable' })
  expect(real.all('SELECT id FROM cues')).toHaveLength(1)
  expect(getNotices().map((n) => n.message)).toEqual(["Can't undo: The LX layer is locked."])
})

test('a remounted hook checks its own session, not the first mount’s', async () => {
  const first = renderHook(() => useUndo('hook-show'))
  await act(async () => {
    await insertCue(real.db, ctx, { ...fields, major: 20 })
  })
  first.unmount()

  h.session = session('This show is archived, so its markup is read-only.')
  const second = renderHook(() => useUndo('hook-show'))
  expect(second.result.current.canUndo).toBe(true)
  let outcome: unknown
  await act(async () => {
    outcome = await second.result.current.undo()
  })
  expect(outcome).toEqual({ status: 'blocked', reason: 'not-editable' })
  expect(real.all('SELECT id FROM cues')).toHaveLength(1)
})

test('on a version that is not current, undo and redo apply nothing and say the view is read-only', async () => {
  const { result, rerender } = renderHook(() => useUndo('hook-show'))
  await act(async () => {
    await insertCue(real.db, ctx, { ...fields, major: 30 })
  })
  expect(result.current.canUndo).toBe(true)

  h.session = session('Viewing v1 — read-only')
  rerender()
  await act(async () => {
    await result.current.undo()
  })
  expect(real.all('SELECT id FROM cues')).toHaveLength(1)
  expect(getNotices().map((n) => n.message)).toEqual(["Can't undo: Viewing v1 — read-only"])
})
