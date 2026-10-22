import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, test } from 'vitest'
import { clickMark, dragMark, setCueMark, setTool, useTool } from './tools'

beforeEach(() => {
  setTool('select', 'go')
  setCueMark('auto')
})

test('the cue mark defaults to auto and setCueMark changes it', () => {
  const { result } = renderHook(() => useTool())
  expect(result.current.cueMark).toBe('auto')
  act(() => setCueMark('pointer'))
  expect(result.current.cueMark).toBe('pointer')
})

test('changing the tool or the cue type keeps the chosen mark', () => {
  const { result } = renderHook(() => useTool())
  act(() => setCueMark('highlight'))
  act(() => setTool('rect'))
  expect(result.current.cueMark).toBe('highlight')
  act(() => setTool('cue', 'warn'))
  expect(result.current).toMatchObject({ tool: 'cue', cueType: 'warn', cueMark: 'highlight' })
})

test('auto clicks to a line and drags to a highlight; the explicit marks keep their own gesture', () => {
  expect(clickMark('auto')).toBe('line')
  expect(dragMark('auto')).toBe('highlight')
  for (const mark of ['underline', 'highlight', 'line', 'pointer'] as const)
    expect(clickMark(mark)).toBe(mark)
  expect(dragMark('underline')).toBe('underline')
  expect(dragMark('highlight')).toBe('highlight')
  // a line has no range to drag out
  expect(dragMark('line')).toBeNull()
  expect(dragMark('pointer')).toBeNull()
})
