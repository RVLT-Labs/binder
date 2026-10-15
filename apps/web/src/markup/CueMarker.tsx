import {
  cueMarkerBox,
  formatCueNumber,
  helveticaWidth,
  MARKER_FONT_SIZE,
  MARKER_PADDING,
  markerStyle,
  markerText,
} from '@binder/core'
import type { CueType, NumberFormat } from '@binder/shared'
import type { KeyboardEvent, PointerEventHandler } from 'react'
import { SvgText } from './SvgText'

export { MARKER_FONT_SIZE }

const FONT_FAMILY = 'Helvetica, Arial, sans-serif'

export interface MarkerCue {
  id: string
  type: CueType | string | null
  label: string | null
  major: number | null
  minor: number | null
  anchor: { pageIndex: number; x: number; y: number }
  dept_code: string
  dept_colour: string
  dept_number_format: NumberFormat
}

export interface CueMarkerProps {
  cue: MarkerCue
  selected: boolean
  /** Drawn with a move cursor: the user may drag it. */
  movable?: boolean
  onPointerDown?: PointerEventHandler<SVGGElement>
  /** Enter or Space on the focused marker: select it. */
  onActivate?: () => void
}

const asType = (t: MarkerCue['type']): CueType => (t === 'standby' || t === 'warn' ? t : 'go')

/** The marker's text: `LX 10`, `SB LX 10.5`. */
function textOf(cue: MarkerCue): string {
  return markerText(
    asType(cue.type),
    cue.dept_code,
    formatCueNumber(cue.major ?? 0, cue.minor ?? 0, cue.dept_number_format),
  )
}

/** The marker's box on its page, in displayed points: what a selection outline goes around. */
export function cueBox(cue: MarkerCue) {
  return cueMarkerBox(cue.anchor.x, cue.anchor.y, helveticaWidth(textOf(cue), MARKER_FONT_SIZE))
}

/** What a screen reader says for a marker: `LX 10, Sunrise, page 2`. */
export function cueAccessibleName(cue: MarkerCue): string {
  return [textOf(cue), cue.label, `page ${cue.anchor.pageIndex + 1}`].filter(Boolean).join(', ')
}

/**
 * Moves keyboard focus to a cue's marker once it is drawn: after a scroll its page may mount a
 * few frames later. Gives up quietly if it never appears (a hidden layer, another version).
 */
export function focusCueMarker(id: string, frames = 30): void {
  const el = document.querySelector<SVGGElement>(`[data-cue-id="${CSS.escape(id)}"]`)
  if (el) el.focus({ preventScroll: true })
  else if (frames > 0) requestAnimationFrame(() => focusCueMarker(id, frames - 1))
}

/**
 * A cue on the page, in displayed space: a box at the anchor in the department colour holding the
 * department code and number, with the cue's label to its right in the same colour.
 */
export function CueMarker({
  cue,
  selected,
  movable = false,
  onPointerDown,
  onActivate,
}: CueMarkerProps) {
  const type = asType(cue.type)
  const text = textOf(cue)
  const box = cueMarkerBox(cue.anchor.x, cue.anchor.y, helveticaWidth(text, MARKER_FONT_SIZE))
  const style = markerStyle(type)
  const colour = cue.dept_colour
  const solid = style.fill === 'solid'
  return (
    // biome-ignore lint/a11y/useSemanticElements: an SVG marker cannot be an HTML <button>; it carries the button role, focus and keys itself
    <g
      className="cue-marker"
      role="button"
      tabIndex={0}
      aria-label={cueAccessibleName(cue)}
      aria-pressed={selected}
      onKeyDown={(e: KeyboardEvent<SVGGElement>) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onActivate?.()
      }}
      data-cue-id={cue.id}
      data-cue-label={text}
      data-selected={selected ? 'true' : undefined}
      // A movable marker keeps touch drags for itself instead of scrolling the page.
      style={{
        pointerEvents: 'auto',
        cursor: movable ? 'move' : 'pointer',
        touchAction: movable ? 'none' : undefined,
      }}
      onPointerDown={onPointerDown}
    >
      {selected && (
        <rect
          className="cue-marker-selection"
          x={box.x - 2}
          y={box.y - 2}
          width={box.w + 4}
          height={box.h + 4}
          fill="none"
          stroke="#111827"
          strokeWidth={1}
          strokeDasharray="2 1.5"
        />
      )}
      <rect
        className="cue-marker-box"
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={2}
        // An outline marker keeps a white backing so its number reads over the script's text.
        fill={solid ? colour : '#fff'}
        fillOpacity={solid ? undefined : 0.85}
        stroke={style.stroke === 'none' ? undefined : colour}
        strokeWidth={style.stroke === 'none' ? undefined : 1.25}
        strokeDasharray={style.stroke === 'dashed' ? '3 2' : undefined}
      />
      <SvgText
        x={box.x + MARKER_PADDING / 2}
        y={cue.anchor.y}
        fill={solid ? '#fff' : colour}
        fontFamily={FONT_FAMILY}
        fontSize={MARKER_FONT_SIZE}
        dominantBaseline="central"
      >
        {text}
      </SvgText>
      {cue.label && (
        <SvgText
          x={box.x + box.w + 3}
          y={cue.anchor.y}
          fill={colour}
          stroke="#fff"
          strokeWidth={3}
          strokeLinejoin="round"
          paintOrder="stroke"
          fontFamily={FONT_FAMILY}
          fontSize={MARKER_FONT_SIZE}
          dominantBaseline="central"
        >
          {cue.label}
        </SvgText>
      )}
    </g>
  )
}
