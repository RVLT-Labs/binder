import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { clearSelection, select } from '../markup/selection'
import { usePanelState } from './usePanelState'

afterEach(() => act(() => clearSelection()))

const setup = (review = false) => {
  const onReviewHandled = vi.fn()
  const hook = renderHook(
    (props: { review: boolean }) => usePanelState({ review: props.review, onReviewHandled }),
    { initialProps: { review } },
  )
  return { ...hook, onReviewHandled }
}

test('it starts closed on the Cue tab', () => {
  const { result } = setup()
  expect(result.current.open).toBe(false)
  expect(result.current.tab).toBe('cue')
})

test('selecting a cue opens the panel on the Cue tab, and deselecting closes what that opened', () => {
  const { result } = setup()
  act(() => result.current.setTab('layers'))
  act(() => select('cues', 'c1'))
  expect(result.current.open).toBe(true)
  expect(result.current.tab).toBe('cue')
  act(() => clearSelection())
  expect(result.current.open).toBe(false)
})

test('a panel opened by choosing a tab stays when the selection goes', () => {
  const { result } = setup()
  act(() => result.current.openTab('layers'))
  act(() => select('cues', 'c1'))
  act(() => clearSelection())
  expect(result.current.open).toBe(true)
})

test('selecting while Review is showing leaves the Review tab where it is', () => {
  const { result } = setup()
  act(() => result.current.openTab('review'))
  act(() => select('cues', 'c1'))
  expect(result.current.tab).toBe('review')
})

test('closing a panel a selection opened deselects it, so the tag can open it again', () => {
  const { result } = setup()
  act(() => select('annotations', 'a1'))
  act(() => result.current.onOpenChange(false))
  expect(result.current.open).toBe(false)
  act(() => select('annotations', 'a1'))
  expect(result.current.open).toBe(true)
})

test('?review= opens the Review tab once and says it has been handled', () => {
  const { result, onReviewHandled, rerender } = setup(false)
  rerender({ review: true })
  expect(result.current.open).toBe(true)
  expect(result.current.tab).toBe('review')
  expect(onReviewHandled).toHaveBeenCalledTimes(1)
  // the address drops it; nothing else happens
  rerender({ review: false })
  expect(onReviewHandled).toHaveBeenCalledTimes(1)
})

test('the toggle flips the sheet', () => {
  const { result } = setup()
  act(() => result.current.toggle())
  expect(result.current.open).toBe(true)
  act(() => result.current.toggle())
  expect(result.current.open).toBe(false)
})

test('it says who opened the panel: a selection, or a choice', () => {
  const { result } = setup()
  act(() => select('cues', 'c1'))
  expect(result.current.openedBy()).toBe('selection')
  act(() => result.current.onOpenChange(false))
  act(() => result.current.openTab('layers'))
  expect(result.current.openedBy()).toBe('choice')
})
