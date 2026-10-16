import { useEffect, useRef } from 'react'
import { useUndo } from '../undo/useUndo'
import { useMarkupSession } from './MarkupSession'
import { stepCue } from './markupView'
import { endRelocate, isRelocating } from './relocate'
import { clearSelection, useSelection } from './selection'
import { resolveShortcut } from './shortcuts'
import { setTool, useTool } from './tools'

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

/**
 * True while a modal dialog is open. Everything behind a modal is inert, so the markup keys stay out
 * of it: `s` on a checkbox in Print must not switch the tool behind it, and Escape belongs to the dialog.
 */
export function modalIsOpen(): boolean {
  return document.querySelector('dialog[open]') !== null
}

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
 * a cue at the pointer, `g` jumps to a page, `/` finds in the document, `v` `h` `n` `r` `a` `s`
 * choose a tool, `1`-`9` pick the active layer, Delete removes the
 * selected cue or annotation, Escape deselects, Mod+Z and Mod+Shift+Z undo and redo
 * the user's own edits (never while a text field has focus, where the browser's own undo applies).
 */
export function useMarkupShortcuts(): void {
  const session = useMarkupSession()
  const undo = useUndo(session.showId)
  const current = { session, selection: useSelection(), tool: useTool(), undo }
  // The listener stays attached; it reads what is current when a key arrives.
  const latest = useRef(current)
  latest.current = current

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const { session, selection, tool, undo } = latest.current
      if (e.defaultPrevented || e.repeat || modalIsOpen()) return
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
        case 'focusSearch':
          session.viewer.current?.focusSearch()
          break
        case 'tool': {
          // A tool that cannot place anything (read-only, no layer) is not switched to.
          const blocked = action.tool === 'select' ? false : 'disabled' in session.annotationTarget
          if (blocked) return
          setTool(action.tool)
          break
        }
        case 'activeLayer': {
          const layer = session.editable[action.index]
          if (!layer) return
          session.store.setActive(layer)
          break
        }
        case 'delete': {
          if (selection?.table === 'annotations') {
            const id = selection.id
            let row: { layer_kind: string | null; layer_id: string | null } | undefined
            for (const rows of session.view.annotationsByPage.values()) {
              row = rows.find((r) => r.id === id) ?? row
            }
            if (!row || !session.canEditAnnotation(row)) return
            void session.removeAnnotation(id)
            break
          }
          const cue = selectedCue ? session.view.ordered.find((c) => c.id === selectedCue) : null
          if (!cue || !session.canEditCue(cue)) return
          void session.removeCue(cue.id)
          break
        }
        case 'undo':
        case 'redo':
          // A version that is not current takes no edits, so nothing is applied onto it.
          if (session.versionReadOnly) return
          void (action.kind === 'undo' ? undo.undo() : undo.redo())
          break
        case 'deselect':
          if (isRelocating()) endRelocate()
          else if (!selection) return
          else clearSelection()
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
