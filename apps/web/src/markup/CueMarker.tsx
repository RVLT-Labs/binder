import {
  type CueTagLayout,
  formatCueNumber,
  GRIP_RADIUS,
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_OUTLINE,
  LEADER_WIDTH,
  markerLead,
  markerText,
  TAG_FONT_SIZE,
  TAG_OUTLINE,
  TAG_RADIUS,
} from '@binder/core'
import type { CueType, NumberFormat } from '@binder/shared'
import type { KeyboardEvent, PointerEventHandler } from 'react'
import { SvgText } from './SvgText'

const FONT_FAMILY = 'Helvetica, Arial, sans-serif'
/** Tag text is dark so it reads on white whatever the department colour. */
const INK = '#111827'

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
  /** The pointer selects the cue by its highlight; false while another tool is using the page. */
  interactive: boolean
  onActivate?: () => void
}

/**
 * A cue's trigger on the page: its words highlighted (or a tick when unbound) and the leader that
 * joins them to the tag. Hidden from assistive technology, which has the tag; clicking the
 * highlight selects the cue. Drawn under the annotations so they stay clickable.
 */
export function CueTrigger({ cue, tag, interactive, onActivate }: CueTriggerProps) {
  const colour = cue.dept_colour
  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a plain SVG group is never focusable
    <g className="cue-trigger" aria-hidden="true" data-cue-trigger={cue.id} pointerEvents="none">
      {tag.triggerBoxes.map((b, i) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: the highlight is a pointer shortcut to selecting the cue; the tag is the keyboard control
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: the boxes are positional, one per line
          key={i}
          className="cue-highlight"
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx={1}
          fill={colour}
          fillOpacity={HIGHLIGHT_OPACITY}
          stroke={colour}
          strokeWidth={HIGHLIGHT_OUTLINE}
          style={{ pointerEvents: interactive ? 'auto' : 'none', cursor: 'pointer' }}
          onClick={onActivate}
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
          strokeWidth={LEADER_WIDTH * 1.5}
        />
      )}
      {tag.leader && (
        <line
          className="cue-leader"
          x1={tag.leader.x1}
          x2={tag.leader.x2}
          y1={tag.leader.y}
          y2={tag.leader.y}
          stroke={colour}
          strokeWidth={LEADER_WIDTH}
        />
      )}
    </g>
  )
}

/**
 * A cue's tag on the page, in displayed space: an opaque white label in the margin with the
 * department colour on its outer edge, the department code, a divider and the number. It is the
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
}: CueMarkerProps) {
  const type = asType(cue.type)
  const colour = cue.dept_colour
  const { tag: box, bar } = tag
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
    >
      <title>{[textOf(cue), cue.label].filter(Boolean).join(', ')}</title>
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
        className="cue-tag-body"
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={TAG_RADIUS}
        // Opaque white: the script never shows through the tag.
        fill="#fff"
        stroke={colour}
        strokeWidth={TAG_OUTLINE}
        strokeDasharray={tag.dash ? '3 2' : undefined}
      />
      <rect
        className="cue-tag-bar"
        x={bar.x}
        y={bar.y}
        width={bar.w}
        height={bar.h}
        fill={colour}
      />
      {tag.grips.map((g) => (
        <circle key={g.y} className="cue-tag-grip" cx={g.x} cy={g.y} r={GRIP_RADIUS} fill="#fff" />
      ))}
      <rect
        className="cue-tag-divider"
        x={tag.divider.x}
        y={tag.divider.y}
        width={tag.divider.w}
        height={tag.divider.h}
        fill={colour}
      />
      <SvgText
        className="cue-tag-lead"
        x={tag.leadX}
        y={tag.centreY}
        fill={INK}
        fontFamily={FONT_FAMILY}
        fontSize={TAG_FONT_SIZE}
        dominantBaseline="central"
      >
        {markerLead(type, cue.dept_code)}
      </SvgText>
      <SvgText
        className="cue-tag-number"
        x={tag.numberX}
        y={tag.centreY}
        fill={INK}
        fontFamily={FONT_FAMILY}
        fontSize={TAG_FONT_SIZE}
        dominantBaseline="central"
      >
        {formatCueNumber(cue.major ?? 0, cue.minor ?? 0, cue.dept_number_format)}
      </SvgText>
    </g>
  )
}
