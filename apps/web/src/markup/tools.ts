import type { AnnotationType, CueMark, CueType } from '@binder/shared'
import { useSyncExternalStore } from 'react'

export type Tool = 'select' | 'cue' | AnnotationType

/** What the cue tool is set to: one mark for every placement, or `auto`, where the gesture decides. */
export type CueMarkChoice = CueMark | 'auto'

/** The mark a click places: Auto draws a line at the click. */
export const clickMark = (choice: CueMarkChoice): CueMark => (choice === 'auto' ? 'line' : choice)

/**
 * The mark a press-and-drag over words places: Auto highlights them. Line and pointer have no range,
 * so they return null and a drag does nothing special.
 */
export function dragMark(choice: CueMarkChoice): 'underline' | 'highlight' | null {
  if (choice === 'auto') return 'highlight'
  return choice === 'underline' || choice === 'highlight' ? choice : null
}

export interface ToolState {
  tool: Tool
  cueType: CueType
  /** How the cue tool marks its words: Auto (the default), underline, highlight, line or line with pointer. */
  cueMark: CueMarkChoice
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

let state: ToolState = {
  tool: 'select',
  cueType: 'go',
  cueMark: 'auto',
  stamp: null,
  rebind: null,
}
const listeners = new Set<() => void>()

function set(next: ToolState): void {
  if (
    next.tool === state.tool &&
    next.cueType === state.cueType &&
    next.cueMark === state.cueMark &&
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

/** Chooses how the cue tool marks its words; changing tool or cue type keeps it. */
export function setCueMark(cueMark: CueMarkChoice): void {
  set({ ...state, cueMark })
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
