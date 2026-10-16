import { act, renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
import { useCuePanel } from './useCuePanel'

test('nothing is selected and nothing is open to start with', () => {
  const { result } = renderHook(() => useCuePanel())
  expect(result.current.selectedId).toBeNull()
  expect(result.current.open).toBe(false)
  expect(result.current.tab).toBe('cue')
})

test('selecting a cue opens the panel on the Cue tab, even from History', () => {
  const { result } = renderHook(() => useCuePanel())
  act(() => result.current.setTab('history'))
  act(() => result.current.select('a'))
  expect(result.current.selectedId).toBe('a')
  expect(result.current.open).toBe(true)
  expect(result.current.tab).toBe('cue')
})

test('selecting another cue keeps the panel open on the new cue', () => {
  const { result } = renderHook(() => useCuePanel())
  act(() => result.current.select('a'))
  act(() => result.current.select('b'))
  expect(result.current.selectedId).toBe('b')
  expect(result.current.open).toBe(true)
})

test('closing the sheet deselects, so the same row can open it again', () => {
  const { result } = renderHook(() => useCuePanel())
  act(() => result.current.select('a'))
  act(() => result.current.onOpenChange(false))
  expect(result.current.open).toBe(false)
  expect(result.current.selectedId).toBeNull()
  expect(result.current.lastSelectedId).toBe('a')
  act(() => result.current.select('a'))
  expect(result.current.open).toBe(true)
})

test('clear drops the selection and closes', () => {
  const { result } = renderHook(() => useCuePanel())
  act(() => result.current.select('a'))
  act(() => result.current.clear())
  expect(result.current.selectedId).toBeNull()
  expect(result.current.open).toBe(false)
})
