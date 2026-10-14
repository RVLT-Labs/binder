import type { CueType } from '@binder/shared'
import { useId } from 'react'
import { useMarkupSession } from './MarkupSession'
import { setTool, useTool } from './tools'

/** The viewer toolbar's markup controls: select, the cue tool and the type it places, and snapping. */
export function MarkupTools() {
  const session = useMarkupSession()
  const { tool, cueType } = useTool()
  const hintId = useId()
  const disabled = 'disabled' in session.cueTarget ? session.cueTarget.disabled : null

  return (
    <fieldset className="markup-tools" aria-label="Markup tools">
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
    </fieldset>
  )
}
