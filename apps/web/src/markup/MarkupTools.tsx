import type { CueType } from '@binder/shared'
import { useId } from 'react'
import { useUndo } from '../undo/useUndo'
import { useMarkupSession } from './MarkupSession'
import { StampPicker } from './StampPicker'
import { setStamp, setTool, type Tool, useTool } from './tools'

const ANNOTATION_TOOLS: Array<{ tool: Tool; label: string }> = [
  { tool: 'rect', label: 'Rect' },
  { tool: 'ellipse', label: 'Ellipse' },
  { tool: 'line', label: 'Line' },
  { tool: 'arrow', label: 'Arrow' },
  { tool: 'note', label: 'Note' },
  { tool: 'stamp', label: 'Stamp' },
  { tool: 'highlight', label: 'Highlight' },
]

/**
 * The viewer toolbar's markup controls: select, the cue tool and the type it places, the annotation
 * tools (which draw on the active layer) and the stamp they place, and snapping.
 */
export function MarkupTools() {
  const session = useMarkupSession()
  const { tool, cueType, stamp } = useTool()
  const undo = useUndo(session.showId)
  const hintId = useId()
  const annotationHintId = useId()
  const disabled = 'disabled' in session.cueTarget ? session.cueTarget.disabled : null
  const annotationDisabled =
    'disabled' in session.annotationTarget ? session.annotationTarget.disabled : null
  // One hint element serves both groups when the reason is the same (an archived show).
  const annotationHint = annotationDisabled === disabled ? hintId : annotationHintId

  return (
    <fieldset className="markup-tools" aria-label="Markup tools">
      <button
        type="button"
        aria-label="Undo"
        disabled={!undo.canUndo || session.versionReadOnly !== null}
        title={session.versionReadOnly ?? undefined}
        onClick={() => void undo.undo()}
      >
        Undo
      </button>
      <button
        type="button"
        aria-label="Redo"
        disabled={!undo.canRedo || session.versionReadOnly !== null}
        title={session.versionReadOnly ?? undefined}
        onClick={() => void undo.redo()}
      >
        Redo
      </button>
      <button type="button" aria-pressed={tool === 'select'} onClick={() => setTool('select')}>
        Select
      </button>
      <button
        type="button"
        aria-label="Cue tool"
        aria-pressed={tool === 'cue' && !disabled}
        aria-describedby={disabled ? hintId : undefined}
        disabled={disabled !== null}
        onClick={() => setTool(tool === 'cue' ? 'select' : 'cue')}
      >
        Cue
      </button>
      <select
        aria-label="Cue type"
        value={cueType}
        disabled={disabled !== null}
        onChange={(e) => setTool(tool, e.target.value as CueType)}
      >
        <option value="go">Go</option>
        <option value="standby">Standby</option>
        <option value="warn">Warning</option>
      </select>
      {ANNOTATION_TOOLS.map(({ tool: t, label }) => (
        <button
          key={t}
          type="button"
          aria-label={`${label} tool`}
          aria-pressed={tool === t && !annotationDisabled}
          aria-describedby={annotationDisabled ? annotationHint : undefined}
          disabled={annotationDisabled !== null}
          onClick={() => setTool(tool === t ? 'select' : t)}
        >
          {label}
        </button>
      ))}
      {tool === 'stamp' && (
        <StampPicker
          stamps={session.stamps}
          value={stamp}
          onChange={setStamp}
          disabled={annotationDisabled !== null}
        />
      )}
      <label className="snap-toggle">
        <input
          type="checkbox"
          checked={session.snap}
          onChange={(e) => session.setSnap(e.target.checked)}
        />
        Snap to text
      </label>
      {disabled && (
        <span id={hintId} className="tool-hint">
          {disabled}
        </span>
      )}
      {annotationDisabled && annotationDisabled !== disabled && (
        <span id={annotationHintId} className="tool-hint">
          {annotationDisabled}
        </span>
      )}
    </fieldset>
  )
}
