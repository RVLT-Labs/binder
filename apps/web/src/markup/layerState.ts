import { type LayerRef, layerKey } from '@binder/shared'
import { useSyncExternalStore } from 'react'
import { loadLayerPrefs, loadLocks, saveLayerPrefs, saveLocks } from './layerPrefs'

/** One user's layer choices for one show on this device (spec 4.11): all keys are layer keys. */
export interface LayerState {
  hidden: readonly string[]
  /** The stored active layer; `resolveActiveLayer` decides whether it still applies. */
  active: string | null
  locked: readonly string[]
  /** The department most recently made active, which the cue tool uses while personal is active. */
  lastDepartment: string | null
}

export interface LayerStore {
  get(): LayerState
  subscribe(fn: () => void): () => void
  setHidden(key: string, hidden: boolean): void
  setActive(layer: LayerRef): void
  setLocked(key: string, locked: boolean): void
}

const toggled = (list: readonly string[], key: string, on: boolean): readonly string[] | null => {
  if (list.includes(key) === on) return null
  return on ? [...list, key] : list.filter((k) => k !== key)
}

function createStore(userId: string, showId: string): LayerStore {
  const prefs = loadLayerPrefs(userId, showId)
  const stored = prefs.active?.startsWith('department:')
    ? prefs.active.slice('department:'.length)
    : null
  let state: LayerState = {
    hidden: prefs.hidden,
    active: prefs.active,
    locked: loadLocks(showId),
    lastDepartment: stored,
  }
  const listeners = new Set<() => void>()
  const set = (next: LayerState) => {
    state = next
    for (const fn of [...listeners]) fn()
  }
  const savePrefs = () =>
    saveLayerPrefs(userId, showId, { hidden: [...state.hidden], active: state.active })

  return {
    get: () => state,
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    setHidden(key, hidden) {
      const next = toggled(state.hidden, key, hidden)
      if (!next) return
      set({ ...state, hidden: next })
      savePrefs()
    },
    setActive(layer) {
      const key = layerKey(layer)
      if (key === state.active) return
      const lastDepartment = layer.kind === 'department' ? layer.id : state.lastDepartment
      set({ ...state, active: key, lastDepartment })
      savePrefs()
    },
    setLocked(key, locked) {
      const next = toggled(state.locked, key, locked)
      if (!next) return
      set({ ...state, locked: next })
      saveLocks(showId, [...next])
    },
  }
}

const stores = new Map<string, LayerStore>()

/** The layer store for a user and show, shared by every component on the page. */
export function layerStore(userId: string, showId: string): LayerStore {
  const id = `${userId}\u0000${showId}`
  let store = stores.get(id)
  if (!store) {
    store = createStore(userId, showId)
    stores.set(id, store)
  }
  return store
}

export function useLayerState(userId: string, showId: string): LayerState & { store: LayerStore } {
  const store = layerStore(userId, showId)
  const state = useSyncExternalStore(store.subscribe, store.get)
  return { ...state, store }
}
