import { afterEach, expect, test, vi } from 'vitest'
import { loadLayerPrefs, loadLocks } from './layerPrefs'
import { layerStore } from './layerState'

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

let n = 0
/** A fresh user per test: stores are shared per user and show for the page's lifetime. */
const user = () => `user-${++n}`

test('one store per user and show, starting from the saved prefs', () => {
  const u = user()
  localStorage.setItem(
    `binder.layers.${u}.s1`,
    JSON.stringify({ hidden: ['department:lx'], active: 'department:snd' }),
  )
  const store = layerStore(u, 's1')
  expect(layerStore(u, 's1')).toBe(store)
  expect(layerStore(u, 's2')).not.toBe(store)
  expect(store.get()).toEqual({
    hidden: ['department:lx'],
    active: 'department:snd',
    locked: [],
    lastDepartment: 'snd',
  })
})

test('hiding and showing a layer is saved for the user and show and tells subscribers', () => {
  const u = user()
  const store = layerStore(u, 's1')
  const heard = vi.fn()
  const off = store.subscribe(heard)
  store.setHidden('department:lx', true)
  store.setHidden('department:lx', true)
  expect(store.get().hidden).toEqual(['department:lx'])
  expect(loadLayerPrefs(u, 's1').hidden).toEqual(['department:lx'])
  store.setHidden('department:lx', false)
  expect(loadLayerPrefs(u, 's1').hidden).toEqual([])
  expect(heard).toHaveBeenCalledTimes(2)
  off()
  store.setHidden('department:snd', true)
  expect(heard).toHaveBeenCalledTimes(2)
})

test('the active layer is saved; the last active department survives a switch to personal', () => {
  const u = user()
  const store = layerStore(u, 's1')
  expect(store.get().lastDepartment).toBeNull()
  store.setActive({ kind: 'department', id: 'snd' })
  store.setActive({ kind: 'personal', id: u })
  expect(store.get()).toMatchObject({ active: `personal:${u}`, lastDepartment: 'snd' })
  expect(loadLayerPrefs(u, 's1').active).toBe(`personal:${u}`)
})

test('locks last for the session only', () => {
  const u = user()
  const store = layerStore(u, 's1')
  store.setLocked('department:lx', true)
  expect(store.get().locked).toEqual(['department:lx'])
  expect(loadLocks('s1')).toEqual(['department:lx'])
  expect(localStorage.length).toBe(0)
  store.setLocked('department:lx', false)
  expect(loadLocks('s1')).toEqual([])
})
