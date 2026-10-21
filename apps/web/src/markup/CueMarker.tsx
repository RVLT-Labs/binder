import {
  asCueType,
  BAR_WIDTH,
  type CueTagLayout,
  formatCueNumber,
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_OPACITY_ACTIVE,
  HIGHLIGHT_RADIUS,
  LEADER_WIDTH,
  markerText,
  POINTER_HEIGHT,
  POINTER_WIDTH,
  SELECTED_FILL_OPACITY,
  TAG_FONT_SIZE,
  TAG_RADIUS,
  UNDERLINE_WIDTH,
} from '@binder/core'
import type { BubbleOffset, CueMark, CueType, NumberFormat, TextAnchor } from '@binder/shared'
import type { KeyboardEvent, PointerEventHandler } from 'react'
import { SvgText } from './SvgText'

/** The mockup's `.sel`: a 2 screen-px red outline (non-scaling), 2 px clear of the tag, 4 px radius (stroke centre 3 out). */
const SELECTION_WIDTH = 2
const SELECTION_OFFSET = 3
const SELECTION_RADIUS = 6

/**
 * A keyboard nudge of the bubble, in page points: Alt+arrow, and Alt+Shift+arrow for the larger step.
 * Alt is required because plain arrows turn the page and focus lands on a marker after `]` or a click,
 * so a stray arrow must never pin a bubble off the margin. Page space is y-up.
 */
const NUDGE = 1
const NUDGE_SHIFT = 10
const NUDGES: Record<string, [number, number] | undefined> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
}

const FONT_FAMILY = 'Helvetica, Arial, sans-serif'
/** The number is dark bold page ink; the code beside it is in the department colour. */
const INK = 'var(--page-ink)'

/** The bar's hit rect is this wide on screen: a finger on a coarse pointer, a cursor on a fine one. */
const BAR_HIT_COARSE_PX = 44
const BAR_HIT_FINE_PX = 12

/** Whether the primary pointer is a finger. False where there is no `matchMedia` (tests, SSR). */
function coarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
  } catch {
    return false
  }
}

export interface MarkerCue {
  id: string
  type: CueType | string | null
  label: string | null
  major: number | null
  minor: number | null
  anchor: {
    pageIndex: number
    x: number
    y: number
    mark?: CueMark
    tag?: BubbleOffset
    text?: TextAnchor
  }
  dept_code: string
  dept_colour: string
  dept_number_format: NumberFormat
}

export interface CueMarkerProps {
  cue: MarkerCue
  /** Where the tag goes: from `layoutPageCues`, shared with print. */
  tag: CueTagLayout
  selected: boolean
  /** Drawn with a move cursor: the user may drag it, and Alt+arrow keys nudge it (plain arrows still turn the page). */
  movable?: boolean
  /** Drawn faded: its bubble is being dragged and a preview shows where it will land. */
  faded?: boolean
  onPointerDown?: PointerEventHandler<SVGGElement>
  /** An Alt+arrow on a movable marker: the bubble moves by this many page points (y up). */
  onNudge?: (dx: number, dy: number) => void
  /** Focus left the marker. */
  onBlur?: () => void
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
  /** The page's zoom (screen px per page point): sizes the bar's hit rect. Default 1. */
  zoom?: number
  /** Override `(pointer: coarse)`: the bar's hit rect is 44 px wide for a finger, 12 for a cursor. */
  coarse?: boolean
  /** The cue is selected and editable: its mark is drawn with a move cursor and takes touch drags. */
  movable?: boolean
  /** A press on the mark (its words, fill or bar); the overlay starts a drag from it. */
  onPointerDown?: PointerEventHandler<SVGElement>
  onActivate?: () => void
  onHover?: (over: boolean) => void
}

/**
 * A cue's trigger on the page, in the department colour: its words underlined or highlighted, a
 * line or pointer between two letters (or a tick or free bar when unbound), and the connector that
 * joins it to the tag. Hidden from assistive technology, which has the tag; clicking the mark
 * selects the cue. Drawn under the annotations so they stay clickable.
 */
export function CueTrigger({
  cue,
  tag,
  interactive,
  filled = false,
  zoom = 1,
  coarse,
  movable = false,
  onPointerDown,
  onActivate,
  onHover,
}: CueTriggerProps) {
  const colour = cue.dept_colour
  const hit = {
    style: {
      pointerEvents: interactive ? 'auto' : 'none',
      cursor: movable ? 'move' : 'pointer',
      // A movable mark keeps touch drags for itself instead of scrolling the page.
      touchAction: movable ? 'none' : undefined,
    } as const,
    onClick: onActivate,
    onPointerDown,
    onPointerEnter: () => onHover?.(true),
    onPointerLeave: () => onHover?.(false),
  }
  const { bar } = tag
  const isCoarse = coarse ?? coarsePointer()
  const hitWidth = (isCoarse ? BAR_HIT_COARSE_PX : BAR_HIT_FINE_PX) / (zoom || 1)
  // A finger needs 44 px to grab a selected cue's words: pad each box out to that, under the visible shapes.
  const touchBoxes =
    movable && isCoarse ? (tag.mark === 'highlight' ? tag.fills : tag.triggerBoxes) : []
  const touchMin = BAR_HIT_COARSE_PX / (zoom || 1)
  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a plain SVG group is never focusable
    <g className="cue-trigger" aria-hidden="true" data-cue-trigger={cue.id} pointerEvents="none">
      {touchBoxes.map((b, i) => {
        const w = Math.max(b.w, touchMin)
        const h = Math.max(b.h, touchMin)
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut to dragging the cue; the tag is the keyboard control
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: the boxes are positional, one per line
            key={i}
            className="cue-touch-hit"
            x={b.x - (w - b.w) / 2}
            y={b.y - (h - b.h) / 2}
            width={w}
            height={h}
            fill="transparent"
            style={hit.style}
            onClick={hit.onClick}
            onPointerDown={hit.onPointerDown}
            onPointerEnter={hit.onPointerEnter}
            onPointerLeave={hit.onPointerLeave}
          />
        )
      })}
      {tag.fills.map((b, i) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: the words are a pointer shortcut to selecting the cue; the tag is the keyboard control
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: the boxes are positional, one per line
          key={i}
          className="cue-fill cue-highlight"
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx={HIGHLIGHT_RADIUS}
          fill={colour}
          fillOpacity={filled ? HIGHLIGHT_OPACITY_ACTIVE : HIGHLIGHT_OPACITY}
          // Multiply keeps the page's text dark under the colour.
          style={{ ...hit.style, mixBlendMode: 'multiply' }}
          onClick={hit.onClick}
          onPointerDown={hit.onPointerDown}
          onPointerEnter={hit.onPointerEnter}
          onPointerLeave={hit.onPointerLeave}
        />
      ))}
      {tag.mark !== 'highlight' &&
        tag.triggerBoxes.map((b, i) => (
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
            style={hit.style}
            onClick={hit.onClick}
            onPointerDown={hit.onPointerDown}
            onPointerEnter={hit.onPointerEnter}
            onPointerLeave={hit.onPointerLeave}
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
      {bar && (
        <>
          <line
            className="cue-bar"
            x1={bar.x}
            x2={bar.x}
            y1={bar.y1}
            y2={bar.y2}
            stroke={colour}
            strokeWidth={BAR_WIDTH}
          />
          {bar.pointer && (
            // The overlay is y-up, so the base is above the bar's top and the triangle points down at it.
            <polygon
              className="cue-pointer"
              points={`${bar.x},${bar.y2} ${bar.x - POINTER_WIDTH / 2},${bar.y2 + POINTER_HEIGHT} ${bar.x + POINTER_WIDTH / 2},${bar.y2 + POINTER_HEIGHT}`}
              fill={colour}
            />
          )}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut to selecting the cue; the tag is the keyboard control */}
          <rect
            className="cue-bar-hit"
            x={bar.x - hitWidth / 2}
            y={bar.y1}
            width={hitWidth}
            height={bar.y2 - bar.y1 + (bar.pointer ? POINTER_HEIGHT : 0)}
            fill="transparent"
            style={hit.style}
            onClick={hit.onClick}
            onPointerDown={hit.onPointerDown}
            onPointerEnter={hit.onPointerEnter}
            onPointerLeave={hit.onPointerLeave}
          />
        </>
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
  faded = false,
  onPointerDown,
  onNudge,
  onBlur,
  onActivate,
  onHover,
}: CueMarkerProps) {
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
        const nudge = movable && onNudge && e.altKey ? NUDGES[e.key] : undefined
        if (nudge) {
          // Alt+arrows move the bubble: the page must not scroll and no shortcut may also act.
          // Plain arrows are not handled here and reach the viewer (page turn).
          e.preventDefault()
          e.stopPropagation()
          const step = e.shiftKey ? NUDGE_SHIFT : NUDGE
          onNudge?.(nudge[0] * step, nudge[1] * step)
          return
        }
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
        opacity: faded ? 0.35 : undefined,
      }}
      onPointerDown={onPointerDown}
      onBlur={onBlur}
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
      <TagPill cue={cue} tag={tag} />
    </g>
  )
}

/** The pill itself: the opaque body outlined in the department colour, its code and its number. */
function TagPill({ cue, tag }: { cue: MarkerCue; tag: CueTagLayout }) {
  const colour = cue.dept_colour
  const box = tag.tag
  return (
    <>
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
    </>
  )
}

/**
 * Where a dragged bubble will land: its pill drawn at `tag` (from the layout of the cue with the
 * dragged offset). Pointer-transparent and hidden from assistive technology; the real marker stays
 * where it was, faded, until the drop is written.
 */
export function BubblePreview({ cue, tag }: { cue: MarkerCue; tag: CueTagLayout }) {
  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a plain SVG group is never focusable
    <g className="cue-bubble-preview" aria-hidden="true" pointerEvents="none">
      <TagPill cue={cue} tag={tag} />
    </g>
  )
}
