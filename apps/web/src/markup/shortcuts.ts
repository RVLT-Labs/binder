import type { Tool } from './tools'

/** The keys that choose a tool (DESIGN 10). `c` is not here: it places a cue at the pointer. */
export const TOOL_KEYS: Readonly<Record<string, Tool>> = {
  v: 'select',
  h: 'highlight',
  n: 'note',
  r: 'rect',
  a: 'arrow',
  s: 'stamp',
}

export type ShortcutAction =
  | { kind: 'tool'; tool: Tool }
  | { kind: 'focusSearch' }
  | { kind: 'nextCue' }
  | { kind: 'prevCue' }
  | { kind: 'placeCue' }
  | { kind: 'jumpToPage' }
  | { kind: 'activeLayer'; index: number }
  | { kind: 'delete' }
  | { kind: 'deselect' }
  | { kind: 'undo' }
  | { kind: 'redo' }

export interface ShortcutKey {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  /** The event target is a text field or other editable element. */
  editableTarget: boolean
}

/** Maps a key press to an action. In an editable target only Escape counts. */
export function resolveShortcut(e: ShortcutKey): ShortcutAction | null {
  if (e.key === 'Escape') return { kind: 'deselect' }
  if (e.editableTarget) return null
  const mod = e.metaKey || e.ctrlKey
  if (mod && !e.altKey) {
    if (e.key.toLowerCase() === 'z') return e.shiftKey ? { kind: 'redo' } : { kind: 'undo' }
    return null
  }
  if (e.altKey) return null
  switch (e.key) {
    case ']':
      return { kind: 'nextCue' }
    case '[':
      return { kind: 'prevCue' }
    case 'Delete':
    case 'Backspace':
      return { kind: 'delete' }
  }
  if (/^[1-9]$/.test(e.key)) return { kind: 'activeLayer', index: Number(e.key) - 1 }
  const lower = e.key.toLowerCase()
  if (lower === 'c') return { kind: 'placeCue' }
  if (lower === 'g') return { kind: 'jumpToPage' }
  if (e.key === '/') return { kind: 'focusSearch' }
  const tool = TOOL_KEYS[lower]
  if (tool) return { kind: 'tool', tool }
  return null
}
