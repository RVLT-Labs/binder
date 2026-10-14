import { type LayerRef, layerKey, parseLayerKey } from '@binder/shared'
import { useQuery } from '@powersync/react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { DEFAULT_NOTE_FONT, DEFAULT_STAMP_FONT, DEFAULT_STROKE } from './AnnotationShape'
import { CommitInput, leaveFieldOnEscape } from './CommitInput'
import { useMarkupSession } from './MarkupSession'
import { fromAnnotationRow } from './mutations'
import { takeFresh } from './selection'
import { endRebind, startRebind, useTool } from './tools'

export const STROKE_HINT = 'Stroke width is 0.5 to 12.'
export const FONT_HINT = 'Font size is 6 to 72.'

type Style = { colour?: string; strokeWidth?: number; fontSize?: number }
type Row = Record<string, unknown> & { id: string }

export interface AnnotationEditorProps {
  annotationId: string
  /** Filled by the annotation's history (Task 12). */
  historySlot?: ReactNode
}

/**
 * The selected annotation's fields: text (a note's words, a stamp from the show's set), colour,
 * stroke width, font size, layer, and for a highlight "Re-select words". Text fields save when they
 * lose focus; choices save at once. An annotation on a layer the user cannot edit, a locked layer,
 * or in an archived show is read-only. Render it with `key={annotationId}`.
 */
export function AnnotationEditor({ annotationId, historySlot }: AnnotationEditorProps) {
  const session = useMarkupSession()
  const { data } = useQuery<Row>('SELECT * FROM annotations WHERE id = ?', [annotationId])
  const { rebind } = useTool()
  const ids = useId()
  const row = data[0]
  const present = row !== undefined

  // A note just placed holds placeholder text: take focus once so the real text is typed next.
  useEffect(() => {
    if (!present || !takeFresh(annotationId)) return
    const text = document.getElementById(`${ids}-text`)
    if (text instanceof HTMLTextAreaElement) {
      text.focus()
      text.select()
    }
  }, [present, annotationId, ids])
  // Leaving the editor (another selection, a delete) ends a pending "Re-select words".
  useEffect(() => endRebind, [])

  if (!row) return null
  const a = fromAnnotationRow(row)
  const style = a.style as Style
  const layer: LayerRef = { kind: a.layerKind, id: a.layerId }
  const reason = session.whyCantEditAnnotation({ layer_kind: a.layerKind, layer_id: a.layerId })
  const editable = reason === null
  const layers = [layer, ...session.editable.filter((l) => layerKey(l) !== layerKey(layer))]
  const sortedLayers = session.editable.some((l) => layerKey(l) === layerKey(layer))
    ? session.editable
    : layers
  const layerColour = session.layerColour(layer)
  const hasStroke = ['rect', 'ellipse', 'line', 'arrow', 'stamp'].includes(a.type)
  const hasFont = a.type === 'note' || a.type === 'stamp'
  const stamps = session.stamps.includes(a.text) ? session.stamps : [...session.stamps, a.text]

  const saveStyle = (next: Style) => void session.editAnnotation(annotationId, { style: next })
  const rebinding = rebind === annotationId

  return (
    <section
      className="cue-editor annotation-editor"
      aria-label="Annotation editor"
      onKeyDown={leaveFieldOnEscape}
    >
      <h2>
        {session.layerName(layer)} {a.type}
      </h2>
      {!editable && <p className="muted">{reason}</p>}
      <fieldset disabled={!editable}>
        {a.type === 'note' && (
          <label htmlFor={`${ids}-text`}>
            Text
            <CommitInput
              id={`${ids}-text`}
              multiline
              value={a.text}
              onCommit={(text) =>
                text !== a.text && void session.editAnnotation(annotationId, { text })
              }
            />
          </label>
        )}
        {a.type === 'stamp' && (
          <label>
            Stamp
            <select
              value={a.text}
              onChange={(e) => void session.editAnnotation(annotationId, { text: e.target.value })}
            >
              {stamps.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        {a.type === 'highlight' && (
          <>
            <p className="cue-quote">
              {a.anchor.text && a.anchor.text.wordStart >= 0 ? (
                <>
                  <span className="muted">Words:</span> “{a.anchor.text.quote}”
                </>
              ) : (
                <>
                  <span className="muted">Its words were not found in this version:</span> “
                  {a.anchor.text?.quote}”
                </>
              )}
            </p>
            <button
              type="button"
              aria-pressed={rebinding}
              onClick={() => (rebinding ? endRebind() : startRebind(annotationId))}
            >
              {rebinding ? 'Cancel re-select' : 'Re-select words'}
            </button>
            {rebinding && <p className="muted">Drag across the words to highlight.</p>}
          </>
        )}
        <label htmlFor={`${ids}-colour`}>
          Colour
          <ColourField
            id={`${ids}-colour`}
            value={style.colour ?? layerColour}
            onCommit={(colour) => saveStyle({ ...style, colour })}
          />
        </label>
        {style.colour && (
          <button
            type="button"
            onClick={() => {
              const { colour: _dropped, ...rest } = style
              saveStyle(rest)
            }}
          >
            Use layer colour
          </button>
        )}
        {hasStroke && (
          <NumberField
            label="Stroke width"
            value={style.strokeWidth ?? DEFAULT_STROKE}
            min={0.5}
            max={12}
            hint={STROKE_HINT}
            onCommit={(strokeWidth) => saveStyle({ ...style, strokeWidth })}
          />
        )}
        {hasFont && (
          <NumberField
            label="Font size"
            value={style.fontSize ?? (a.type === 'note' ? DEFAULT_NOTE_FONT : DEFAULT_STAMP_FONT)}
            min={6}
            max={72}
            hint={FONT_HINT}
            onCommit={(fontSize) => saveStyle({ ...style, fontSize })}
          />
        )}
        <label>
          Layer
          <select
            value={layerKey(layer)}
            onChange={(e) => {
              const next = parseLayerKey(e.target.value)
              if (next)
                void session.editAnnotation(annotationId, {
                  layerKind: next.kind,
                  layerId: next.id,
                })
            }}
          >
            {sortedLayers.map((l) => (
              <option key={layerKey(l)} value={layerKey(l)}>
                {session.layerName(l)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="danger"
          onClick={() => void session.removeAnnotation(annotationId)}
        >
          Delete annotation
        </button>
      </fieldset>
      {historySlot}
    </section>
  )
}

interface NumberFieldProps {
  label: string
  value: number
  min: number
  max: number
  hint: string
  onCommit: (value: number) => void
}

/** A number in a range, saved on blur or Enter; out of range or not a number shows `hint`. */
function NumberField({ label, value, min, max, hint, onCommit }: NumberFieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const [error, setError] = useState<string | null>(null)
  function commit(text: string) {
    const n = Number(text)
    if (text.trim() === '' || !Number.isFinite(n) || n < min || n > max) {
      setError(hint)
      return
    }
    setError(null)
    if (n !== value) onCommit(n)
  }
  return (
    <>
      <label htmlFor={id}>
        {label}
        <CommitInput
          id={id}
          value={String(value)}
          onCommit={commit}
          onCancel={() => setError(null)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </label>
      {error && (
        <p id={errorId} role="alert" className="field-error">
          {error}
        </p>
      )}
    </>
  )
}

interface ColourFieldProps {
  id: string
  value: string
  onCommit: (colour: string) => void
}

/**
 * A colour swatch. Dragging in the picker only previews; the colour is saved when the picker closes
 * (the input's native change event), so one choice is one write.
 */
function ColourField({ id, value, onCommit }: ColourFieldProps) {
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(value.toLowerCase())
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setDraft(value.toLowerCase())
  }, [value, focused])
  // The latest callback and stored value, read when the event arrives.
  const latest = useRef({ onCommit, value })
  latest.current = { onCommit, value }
  useEffect(() => {
    const el = input.current
    if (!el) return
    const onChange = () => {
      if (el.value.toLowerCase() !== latest.current.value.toLowerCase()) {
        latest.current.onCommit(el.value.toLowerCase())
      }
    }
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [])
  return (
    <input
      ref={input}
      id={id}
      type="color"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  )
}
