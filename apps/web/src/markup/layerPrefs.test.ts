import { layerKey } from '@binder/shared'
import { afterEach, expect, test, vi } from 'vitest'
import {
  editableLayers,
  loadLayerPrefs,
  loadLocks,
  resolveActiveLayer,
  saveLayerPrefs,
  saveLocks,
} from './layerPrefs'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

const D = (id: string, hidden = false) => ({ id, hidden })
const dept = (id: string) => ({ kind: 'department' as const, id })
const personal = (id: string) => ({ kind: 'personal' as const, id })

test('layer prefs round-trip per user and show', () => {
  saveLayerPrefs('u1', 's1', { hidden: ['department:lx'], active: 'department:snd' })
  expect(loadLayerPrefs('u1', 's1')).toEqual({
    hidden: ['department:lx'],
    active: 'department:snd',
  })
  expect(loadLayerPrefs('u2', 's1')).toEqual({ hidden: [], active: null })
  expect(loadLayerPrefs('u1', 's2')).toEqual({ hidden: [], active: null })
  expect(localStorage.getItem('binder.layers.u1.s1')).not.toBeNull()
})

test('unreadable stored prefs give the defaults', () => {
  for (const bad of ['not json', '[]', '{"hidden":"x","active":3}']) {
    localStorage.setItem('binder.layers.u1.s1', bad)
    expect(loadLayerPrefs('u1', 's1')).toEqual({ hidden: [], active: null })
  }
})

test('a throwing storage gives defaults and never throws', () => {
  const boom = () => {
    throw new Error('blocked')
  }
  vi.stubGlobal('localStorage', { getItem: boom, setItem: boom })
  vi.stubGlobal('sessionStorage', { getItem: boom, setItem: boom })
  expect(loadLayerPrefs('u1', 's1')).toEqual({ hidden: [], active: null })
  expect(() => saveLayerPrefs('u1', 's1', { hidden: [], active: null })).not.toThrow()
  expect(loadLocks('s1')).toEqual([])
  expect(() => saveLocks('s1', ['department:lx'])).not.toThrow()
})

test('locks live in session storage per show', () => {
  saveLocks('s1', ['department:lx'])
  expect(loadLocks('s1')).toEqual(['department:lx'])
  expect(loadLocks('s2')).toEqual([])
  expect(sessionStorage.getItem('binder.locks.s1')).not.toBeNull()
  expect(localStorage.getItem('binder.locks.s1')).toBeNull()
})

test('editableLayers for an SND-scoped editor is [SND, personal]; for a viewer [personal]', () => {
  const deps = [D('lx'), D('snd'), D('tm')]
  expect(editableLayers({ role: 'editor', departments: ['snd'] }, 'u1', deps)).toEqual([
    dept('snd'),
    personal('u1'),
  ])
  expect(editableLayers({ role: 'viewer', departments: [] }, 'u1', deps)).toEqual([personal('u1')])
})

test('editableLayers skips hidden departments and keeps the given order; owners get all', () => {
  const deps = [D('tm'), D('lx', true), D('snd')]
  expect(editableLayers({ role: 'owner', departments: ['*'] }, 'u1', deps)).toEqual([
    dept('tm'),
    dept('snd'),
    personal('u1'),
  ])
})

test('the active layer falls back to the first editable department, then personal', () => {
  const editable = [dept('snd'), dept('lx'), personal('u1')]
  expect(resolveActiveLayer({ hidden: [], active: layerKey(dept('lx')) }, editable)).toEqual(
    dept('lx'),
  )
  expect(resolveActiveLayer({ hidden: [], active: layerKey(dept('tm')) }, editable)).toEqual(
    dept('snd'),
  )
  expect(resolveActiveLayer({ hidden: [], active: null }, editable)).toEqual(dept('snd'))
  expect(resolveActiveLayer({ hidden: [], active: layerKey(personal('u1')) }, editable)).toEqual(
    personal('u1'),
  )
  expect(
    resolveActiveLayer({ hidden: [], active: layerKey(dept('lx')) }, [personal('u1')]),
  ).toEqual(personal('u1'))
})
