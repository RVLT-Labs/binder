import type { AnnotationType, CueType } from '@binder/shared'
import { useSyncExternalStore } from 'react'

export type Tool = 'select' | 'cue' | AnnotationType
export interface ToolState {
  tool: Tool
  cueType: CueType
  /** The stamp the stamp tool places; null until one is chosen (the picker then offers its first). */
  stamp: string | null
  /** The highlight whose words the next word drag replaces ("Re-select words"). */
  rebind: string | null
}

/** The tools that draw by dragging across the page. */
export const DRAG_TOOLS = ['rect', 'ellipse', 'line', 'arrow', 'highlight'] as const
export type DragTool = (typeof DRAG_TOOLS)[number]
/** The tools that place by a click. */
export const CLICK_TOOLS = ['note', 'stamp'] as const

export const isDragTool = (tool: Tool): tool is DragTool =>
  (DRAG_TOOLS as readonly string[]).includes(tool)
export const isAnnotationTool = (tool: Tool): tool is AnnotationType =>
  tool !== 'select' && tool !== 'cue'

let state: ToolState = { tool: 'select', cueType: 'go', stamp: null, rebind: null }
const listeners = new Set<() => void>()

function set(next: ToolState): void {
  if (
    next.tool === state.tool &&
    next.cueType === state.cueType &&
    next.stamp === state.stamp &&
    next.rebind === state.rebind
  )
    return
  state = next
  for (const fn of [...listeners]) fn()
}

/** Changes the tool and/or the type of cue it places; unspecified fields keep their value. */
export function setTool(tool: Tool, cueType?: CueType): void {
  set({ ...state, tool, cueType: cueType ?? state.cueType, rebind: null })
}

/** Chooses the stamp the stamp tool places. */
export function setStamp(stamp: string): void {
  set({ ...state, stamp })
}

/** Makes the next word drag rebind this highlight instead of drawing a tool's shape. */
export function startRebind(id: string): void {
  set({ ...state, rebind: id })
}

export function endRebind(): void {
  set({ ...state, rebind: null })
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
