import type { AnnotationType, CueType } from '@binder/shared'
import { useSyncExternalStore } from 'react'

export type Tool = 'select' | 'cue' | AnnotationType
export interface ToolState {
  tool: Tool
  cueType: CueType
}

let state: ToolState = { tool: 'select', cueType: 'go' }
const listeners = new Set<() => void>()

/** Changes the tool and/or the type of cue it places; unspecified fields keep their value. */
export function setTool(tool: Tool, cueType?: CueType): void {
  const next = { tool, cueType: cueType ?? state.cueType }
  if (next.tool === state.tool && next.cueType === state.cueType) return
  state = next
  for (const fn of [...listeners]) fn()
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useTool(): ToolState {
  return useSyncExternalStore(subscribe, () => state)
}
