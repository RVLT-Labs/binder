import { type LayerRef, layerKey, parseLayerKey } from '@binder/shared'
import { useQuery } from '@powersync/react'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Field, FieldError, Note, SelectField, Swatch } from '../panel/fields'
import { useBreakpoint } from '../shell/useBreakpoint'
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
  /** Phone: closes the drawer. Draws the red Done beside Delete (the mockup's sheet actions). */
  onDone?: () => void
}

/**
 * The selected annotation's fields: text (a note's words, a stamp from the show's set), colour,
 * stroke width, font size, layer, and for a highlight "Re-select words". Text fields save when they
 * lose focus; choices save at once. An annotation on a layer the user cannot edit, a locked layer,
 * or in an archived show is read-only. Render it with `key={annotationId}`.
 */
export function AnnotationEditor({ annotationId, onDone }: AnnotationEditorProps) {
  const session = useMarkupSession()
  const phone = useBreakpoint() === 'phone'
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
  // Shared markup cannot move onto a personal layer (it would vanish for everyone else), so a
  // department annotation's picker leaves the personal layer out.
  const choices = session.editable.filter((l) => layer.kind === 'personal' || l.kind !== 'personal')
  const layers = [layer, ...choices.filter((l) => layerKey(l) !== layerKey(layer))]
  const sortedLayers = choices.some((l) => layerKey(l) === layerKey(layer)) ? choices : layers
  const layerColour = session.layerColour(layer)
  const hasStroke = ['rect', 'ellipse', 'line', 'arrow', 'stamp', 'ink'].includes(a.type)
  const hasFont = a.type === 'note' || a.type === 'stamp'
  const stamps = session.stamps.includes(a.text) ? session.stamps : [...session.stamps, a.text]

  const saveStyle = (next: Style) => void session.editAnnotation(annotationId, { style: next })
  const rebinding = rebind === annotationId

  return (
    <section
      className="cue-editor annotation-editor flex flex-col gap-3.5"
      aria-label="Annotation editor"
      onKeyDown={leaveFieldOnEscape}
    >
      <h2 className="m-0 flex items-center gap-1.5 font-sans text-[13px] font-semibold text-ink max-md:min-h-8">
        <Swatch colour={layerColour} />
        <span>
          {session.layerName(layer)} {a.type}
        </span>
      </h2>
      {!editable && <Note>{reason}</Note>}
      <fieldset disabled={!editable} className="m-0 grid min-w-0 gap-3.5 border-0 p-0">
        {a.type === 'note' && (
          <Field label="Text" htmlFor={`${ids}-text`}>
            <CommitInput
              id={`${ids}-text`}
              multiline
              value={a.text}
              onCommit={(text) =>
                text !== a.text && void session.editAnnotation(annotationId, { text })
              }
            />
          </Field>
        )}
        {a.type === 'stamp' && (
          <Field label="Stamp" htmlFor={`${ids}-stamp`}>
            <SelectField
              id={`${ids}-stamp`}
              value={a.text}
              onChange={(e) => void session.editAnnotation(annotationId, { text: e.target.value })}
            >
              {stamps.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectField>
          </Field>
        )}
        {a.type === 'highlight' && (
          <>
            <Field
              label={a.anchor.text && a.anchor.text.wordStart >= 0 ? 'Words' : 'Words not found'}
            >
              <p
                className="cue-quote m-0 rounded-r-[8px] border-l-2 bg-card px-2.5 py-2 font-mono text-[11.5px] leading-snug text-ink-2"
                style={{ borderColor: layerColour }}
              >
                {a.anchor.text && a.anchor.text.wordStart >= 0 ? (
                  <>“{a.anchor.text.quote}”</>
                ) : (
                  <>
                    <span className="font-sans text-muted">
                      Its words were not found in this version:
                    </span>{' '}
                    “{a.anchor.text?.quote}”
                  </>
                )}
              </p>
            </Field>
            <Button
              type="button"
              variant="line"
              size="sm"
              aria-pressed={rebinding}
              className="justify-self-start aria-pressed:before:border-ink"
              onClick={() => (rebinding ? endRebind() : startRebind(annotationId))}
            >
              {rebinding ? 'Cancel re-select' : 'Re-select words'}
            </Button>
            {rebinding && <Note>Drag across the words to highlight.</Note>}
          </>
        )}
        <Field label="Colour" htmlFor={`${ids}-colour`}>
          <div className="flex items-center gap-2">
            <ColourField
              id={`${ids}-colour`}
              value={style.colour ?? layerColour}
              onCommit={(colour) => saveStyle({ ...style, colour })}
            />
            {style.colour && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted hover:text-ink"
                onClick={() => {
                  const { colour: _dropped, ...rest } = style
                  saveStyle(rest)
                }}
              >
                Use layer colour
              </Button>
            )}
          </div>
        </Field>
        {(hasStroke || hasFont) && (
          <div className="flex gap-3">
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
                value={
                  style.fontSize ?? (a.type === 'note' ? DEFAULT_NOTE_FONT : DEFAULT_STAMP_FONT)
                }
                min={6}
                max={72}
                hint={FONT_HINT}
                onCommit={(fontSize) => saveStyle({ ...style, fontSize })}
              />
            )}
          </div>
        )}
        <Field label="Layer" htmlFor={`${ids}-layer`}>
          <SelectField
            id={`${ids}-layer`}
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
          </SelectField>
        </Field>
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant={phone ? 'line' : 'ghost'}
            size="sm"
            aria-label="Delete annotation"
            className={cn(phone ? 'w-28' : 'text-muted hover:text-ink')}
            onClick={() => void session.removeAnnotation(annotationId)}
          >
            Delete
          </Button>
          {onDone && (
            <Button type="button" className="flex-1" onClick={onDone}>
              Done
            </Button>
          )}
        </div>
      </fieldset>
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
    <Field label={label} htmlFor={id} className="min-w-0 flex-1">
      <CommitInput
        id={id}
        className="font-mono tabular-nums"
        value={String(value)}
        onCommit={commit}
        onCancel={() => setError(null)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </Field>
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
export function ColourField({ id, value, onCommit }: ColourFieldProps) {
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
      style={{ minHeight: 44, minWidth: 44 }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className="h-12 w-16 cursor-pointer rounded-[12px] border-2 border-input bg-paper p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-45 md:h-[30px] md:rounded-[9px] md:p-[3px]"
    />
  )
}
