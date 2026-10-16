import {
  asCueType,
  type CueTagLayout,
  formatCueNumber,
  LEADER_WIDTH,
  markerText,
  SELECTED_FILL_OPACITY,
  TAG_FONT_SIZE,
  TAG_RADIUS,
  UNDERLINE_WIDTH,
} from '@binder/core'
import type { CueType, NumberFormat } from '@binder/shared'
import type { KeyboardEvent, PointerEventHandler } from 'react'
import { SvgText } from './SvgText'

/** The mockup's `.sel`: a 2 screen-px red outline (non-scaling), 2 px clear of the tag, 4 px radius (stroke centre 3 out). */
const SELECTION_WIDTH = 2
const SELECTION_OFFSET = 3
const SELECTION_RADIUS = 6

const FONT_FAMILY = 'Helvetica, Arial, sans-serif'
/** The number is dark bold page ink; the code beside it is in the department colour. */
const INK = 'var(--page-ink)'

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
  /** Where the tag goes: from `layoutPageCues`, shared with print. */
  tag: CueTagLayout
  selected: boolean
  /** Drawn with a move cursor: the user may drag it. */
  movable?: boolean
  onPointerDown?: PointerEventHandler<SVGGElement>
  /** Enter or Space on the focused tag: select it. */
  onActivate?: () => void
  /** The pointer entered or left the tag: its trigger words fill while it is over. */
  onHover?: (over: boolean) => void
}

/** The marker's text: `LX 10`, `SB LX 10.5`. */
function textOf(cue: MarkerCue): string {
  return markerText(
    asCueType(cue.type),
    cue.dept_code,
    formatCueNumber(cue.major ?? 0, cue.minor ?? 0, cue.dept_number_format),
  )
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

export interface CueTriggerProps {
  cue: MarkerCue
  tag: CueTagLayout
  /** The pointer selects the cue by its words; false while another tool is using the page. */
  interactive: boolean
  /** The cue is selected or hovered: its trigger words get a light fill (on screen only). */
  filled?: boolean
  onActivate?: () => void
  onHover?: (over: boolean) => void
}

/**
 * A cue's trigger on the page: its words underlined in the department colour (or a tick when
 * unbound) and the connector that joins them to the tag. Hidden from assistive technology, which
 * has the tag; clicking the words selects the cue. Drawn under the annotations so they stay
 * clickable.
 */
export function CueTrigger({
  cue,
  tag,
  interactive,
  filled = false,
  onActivate,
  onHover,
}: CueTriggerProps) {
  const colour = cue.dept_colour
  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a plain SVG group is never focusable
    <g className="cue-trigger" aria-hidden="true" data-cue-trigger={cue.id} pointerEvents="none">
      {tag.triggerBoxes.map((b, i) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: the words are a pointer shortcut to selecting the cue; the tag is the keyboard control
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: the boxes are positional, one per line
          key={i}
          className="cue-highlight"
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          fill={colour}
          fillOpacity={filled ? SELECTED_FILL_OPACITY : 0}
          style={{ pointerEvents: interactive ? 'auto' : 'none', cursor: 'pointer' }}
          onClick={onActivate}
          onPointerEnter={() => onHover?.(true)}
          onPointerLeave={() => onHover?.(false)}
        />
      ))}
      {tag.underlines.map((u, i) => (
        <line
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines are positional, one per line of text
          key={i}
          className="cue-underline"
          x1={u.x1}
          x2={u.x2}
          y1={u.y}
          y2={u.y}
          stroke={colour}
          strokeWidth={UNDERLINE_WIDTH}
        />
      ))}
      {tag.tick && (
        <line
          className="cue-tick"
          x1={tag.tick.x}
          x2={tag.tick.x}
          y1={tag.tick.y1}
          y2={tag.tick.y2}
          stroke={colour}
          strokeWidth={UNDERLINE_WIDTH}
        />
      )}
      {tag.leader && (
        <polyline
          className="cue-leader"
          points={tag.leader.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={colour}
          strokeWidth={LEADER_WIDTH}
          strokeLinejoin="miter"
        />
      )}
    </g>
  )
}

/**
 * A cue's tag on the page, in displayed space: an opaque white pill in the margin outlined in the
 * department colour, with the department code in that colour and the number in bold. It is the
 * focusable, labelled control; the cue's label is in its accessible name and hover title, never
 * drawn on the page.
 */
export function CueMarker({
  cue,
  tag,
  selected,
  movable = false,
  onPointerDown,
  onActivate,
  onHover,
}: CueMarkerProps) {
  const colour = cue.dept_colour
  const box = tag.tag
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
      data-cue-label={textOf(cue)}
      data-selected={selected ? 'true' : undefined}
      // A movable marker keeps touch drags for itself instead of scrolling the page.
      style={{
        pointerEvents: 'auto',
        cursor: movable ? 'move' : 'pointer',
        touchAction: movable ? 'none' : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerEnter={() => onHover?.(true)}
      onPointerLeave={() => onHover?.(false)}
    >
      <title>{[textOf(cue), cue.label].filter(Boolean).join(', ')}</title>
      {selected && (
        <rect
          className="cue-marker-selection"
          x={box.x - SELECTION_OFFSET}
          y={box.y - SELECTION_OFFSET}
          width={box.w + 2 * SELECTION_OFFSET}
          height={box.h + 2 * SELECTION_OFFSET}
          rx={SELECTION_RADIUS}
          fill="none"
          stroke="var(--red)"
          strokeWidth={SELECTION_WIDTH}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
      <rect
        className="cue-tag-body"
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={TAG_RADIUS}
        // Opaque white: the script never shows through the tag.
        fill="var(--page)"
        stroke={colour}
        strokeWidth={tag.outlineWidth}
        strokeDasharray={tag.dash ? '3 2' : undefined}
      />
      {tag.lead && (
        <SvgText
          className="cue-tag-lead"
          x={tag.leadX}
          y={tag.centreY}
          fill={colour}
          fontFamily={FONT_FAMILY}
          fontSize={TAG_FONT_SIZE}
          dominantBaseline="central"
        >
          {tag.lead}
        </SvgText>
      )}
      <SvgText
        className="cue-tag-number"
        x={tag.numberX}
        y={tag.centreY}
        fill={INK}
        fontFamily={FONT_FAMILY}
        fontSize={TAG_FONT_SIZE}
        fontWeight={700}
        dominantBaseline="central"
      >
        {tag.number}
      </SvgText>
    </g>
  )
}
