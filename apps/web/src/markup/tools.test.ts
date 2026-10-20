import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, test } from 'vitest'
import { setCueMark, setTool, useTool } from './tools'

beforeEach(() => {
  setTool('select', 'go')
  setCueMark('underline')
})

test('the cue mark defaults to underline and setCueMark changes it', () => {
  const { result } = renderHook(() => useTool())
  expect(result.current.cueMark).toBe('underline')
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
