import { useEffect, useRef } from 'react'
import { useMarkupSession } from './MarkupSession'
import { stepCue } from './markupView'
import { clearSelection, useSelection } from './selection'
import { resolveShortcut } from './shortcuts'
import { useTool } from './tools'

/** Inputs that take no typing: a shortcut pressed while one has focus still counts. */
const NON_TEXT_INPUTS = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'file',
])

/** True for elements that take typed keys (text fields, selects, editable content). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type)
  return (
    target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

/**
 * The viewer's markup keys while a document is open: `]` and `[` walk the shown cues, `c` places
 * a cue at the pointer, `g` jumps to a page, `1`-`9` pick the active layer, Delete removes the
 * selected cue, Escape deselects. Undo and redo arrive with the undo stack.
 */
export function useMarkupShortcuts(): void {
  const current = { session: useMarkupSession(), selection: useSelection(), tool: useTool() }
  // The listener stays attached; it reads what is current when a key arrives.
  const latest = useRef(current)
  latest.current = current

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const { session, selection, tool } = latest.current
      if (e.defaultPrevented || e.repeat) return
      const action = resolveShortcut({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        editableTarget: isEditableTarget(e.target),
      })
      if (!action) return
      const selectedCue = selection?.table === 'cues' ? selection.id : null
      switch (action.kind) {
        case 'nextCue':
        case 'prevCue': {
          const ordered = session.view.ordered
          const id = stepCue(
            ordered.map((c) => c.id),
            selectedCue,
            action.kind === 'nextCue' ? 1 : -1,
          )
          const cue = ordered.find((c) => c.id === id)
          if (cue) session.showCue(cue)
          break
        }
        case 'placeCue': {
          const at = session.hover.current
          if (!at) return
          void session.placeCue(at.pageIndex, at.point, tool.cueType)
          break
        }
        case 'jumpToPage':
          session.viewer.current?.focusPageInput()
          break
        case 'activeLayer': {
          const layer = session.editable[action.index]
          if (!layer) return
          session.store.setActive(layer)
          break
        }
        case 'delete': {
          const cue = selectedCue ? session.view.ordered.find((c) => c.id === selectedCue) : null
          if (!cue || !session.canEditCue(cue)) return
          void session.removeCue(cue.id)
          break
        }
        case 'deselect':
          if (!selection) return
          clearSelection()
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
