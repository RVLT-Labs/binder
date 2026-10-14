import { useSyncExternalStore } from 'react'

export interface Notice {
  id: number
  kind: 'rejection' | 'error'
  message: string
}

let notices: readonly Notice[] = []
let nextId = 1
const listeners = new Set<() => void>()

function set(next: readonly Notice[]) {
  notices = next
  for (const listener of listeners) listener()
}

export function pushNotice(notice: Omit<Notice, 'id'>): void {
  set([...notices, { ...notice, id: nextId++ }])
}

export function dismissNotice(id: number): void {
  set(notices.filter((n) => n.id !== id))
}

export function clearNotices(): void {
  set([])
}

export function getNotices(): readonly Notice[] {
  return notices
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useNotices(): readonly Notice[] {
  return useSyncExternalStore(subscribe, getNotices)
}
