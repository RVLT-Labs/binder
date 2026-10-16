import {
  type Box,
  DEFAULT_NOTE_FONT,
  DEFAULT_STAMP_FONT,
  DEFAULT_STROKE,
  helveticaWidth,
  NOTE_LINE_HEIGHT as LINE_HEIGHT,
  NOTE_MAX_WIDTH,
  ANNOTATION_PAD as PAD,
  UNBOUND_FONT,
  unboundSnippet,
  wordBoxes,
  wrapText,
} from '@binder/core'
import type { AnnotationType, WordLayer } from '@binder/shared'
import type { KeyboardEvent, PointerEventHandler, ReactNode } from 'react'
import type { AnnotationRow } from './markupView'
import { fromAnnotationRow } from './mutations'
import { SvgText } from './SvgText'

const FONT_FAMILY = 'Helvetica, Arial, sans-serif'

export { DEFAULT_NOTE_FONT, DEFAULT_STAMP_FONT, DEFAULT_STROKE, wrapText }

const NAME_WORDS = 5

/** The parts of an annotation row a shape draws; geometry and style are parsed. */
export interface ShapeAnnotation {
  id: string
  type: AnnotationType
  anchor: {
    pageIndex: number
    x: number
    y: number
    text?: { quote: string; wordStart: number; wordEnd: number }
  }
  geometry: Record<string, number>
  text: string
  style: { colour?: string; strokeWidth?: number; fontSize?: number }
}

/** A local annotation row as the shape draws it. */
export function toShapeAnnotation(row: AnnotationRow): ShapeAnnotation {
  const fields = fromAnnotationRow(row as unknown as Record<string, unknown>)
  return {
    id: row.id,
    type: fields.type,
    anchor: row.anchor,
    geometry: fields.geometry,
    text: fields.text,
    style: fields.style as ShapeAnnotation['style'],
  }
}

const firstWords = (text: string): string => {
  const words = text.trim().split(/\s+/).filter(Boolean)
  return words.slice(0, NAME_WORDS).join(' ') + (words.length > NAME_WORDS ? '…' : '')
}

/** What a screen reader says for a shape: `LX rect, page 2`, `Personal note: Cover the gap, page 1`. */
export function annotationAccessibleName(a: ShapeAnnotation, layerName: string): string {
  const detail = firstWords(a.type === 'highlight' ? (a.anchor.text?.quote ?? '') : a.text)
  return `${layerName} ${a.type}${detail ? `: ${detail}` : ''}, page ${a.anchor.pageIndex + 1}`
}

/** The three points of an arrowhead whose tip is (x2, y2) on a line from (x1, y1). */
function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number): string {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const at = (da: number) =>
    `${x2 + size * Math.cos(angle + Math.PI + da)},${y2 + size * Math.sin(angle + Math.PI + da)}`
  return `${x2},${y2} ${at(0.45)} ${at(-0.45)}`
}

const num = (g: Record<string, number>, key: string) => Number(g[key]) || 0

interface Drawn {
  /** Where the shape sits, for the selection outline. */
  box: Box
  body: ReactNode
}

function drawRect(a: ShapeAnnotation, colour: string, sw: number): Drawn {
  const { x, y } = a.anchor
  const w = num(a.geometry, 'w')
  const h = num(a.geometry, 'h')
  const common = { fill: 'transparent', stroke: colour, strokeWidth: sw }
  return {
    box: { x, y, w, h },
    body:
      a.type === 'ellipse' ? (
        <ellipse
          className="annotation-ellipse"
          cx={x + w / 2}
          cy={y + h / 2}
          rx={w / 2}
          ry={h / 2}
          {...common}
        />
      ) : (
        <rect className="annotation-rect" x={x} y={y} width={w} height={h} {...common} />
      ),
  }
}

function drawLine(a: ShapeAnnotation, colour: string, sw: number): Drawn {
  const { x, y } = a.anchor
  const dx = num(a.geometry, 'dx')
  const dy = num(a.geometry, 'dy')
  const x2 = x + dx
  const y2 = y + dy
  const head = Math.min(Math.max(6, sw * 4), Math.hypot(dx, dy) * 0.6)
  return {
    box: { x: Math.min(x, x2), y: Math.min(y, y2), w: Math.abs(dx), h: Math.abs(dy) },
    body: (
      <>
        {/* A wide invisible stroke makes a thin line easy to hit. */}
        <line
          x1={x}
          y1={y}
          x2={x2}
          y2={y2}
          stroke="transparent"
          strokeWidth={Math.max(10, sw)}
          strokeLinecap="round"
        />
        <line
          className="annotation-line"
          x1={x}
          y1={y}
          x2={x2}
          y2={y2}
          stroke={colour}
          strokeWidth={sw}
          strokeLinecap="round"
        />
        {a.type === 'arrow' && (
          <polygon
            className="annotation-arrowhead"
            points={arrowHead(x, y, x2, y2, head)}
            fill={colour}
            stroke={colour}
            strokeWidth={sw / 2}
            strokeLinejoin="round"
          />
        )}
      </>
    ),
  }
}

function drawNote(a: ShapeAnnotation, colour: string): Drawn {
  const size = a.style.fontSize ?? DEFAULT_NOTE_FONT
  const lines = wrapText(a.text, size, NOTE_MAX_WIDTH)
  const textWidth = Math.max(...lines.map((l) => helveticaWidth(l, size)))
  const lineHeight = size * LINE_HEIGHT
  const w = textWidth + PAD * 2 + 3
  const h = lines.length * lineHeight + PAD * 2
  // The anchor is the note's top-left corner.
  const box = { x: a.anchor.x, y: a.anchor.y - h, w, h }
  return {
    box,
    body: (
      <>
        <rect
          className="annotation-note"
          x={box.x}
          y={box.y}
          width={w}
          height={h}
          fill="var(--page)"
          fillOpacity={0.92}
          stroke={colour}
          strokeWidth={1.25}
        />
        <rect x={box.x} y={box.y} width={3} height={h} fill={colour} />
        {lines.map((line, i) => (
          <SvgText
            // biome-ignore lint/suspicious/noArrayIndexKey: wrapped lines have no identity beyond their position
            key={i}
            x={box.x + PAD + 3}
            y={a.anchor.y - PAD - lineHeight * (i + 0.5)}
            fill="var(--page-ink)"
            fontFamily={FONT_FAMILY}
            fontSize={size}
            dominantBaseline="central"
          >
            {line}
          </SvgText>
        ))}
      </>
    ),
  }
}

function drawStamp(a: ShapeAnnotation, colour: string, sw: number): Drawn {
  const size = a.style.fontSize ?? DEFAULT_STAMP_FONT
  const w = helveticaWidth(a.text, size) + PAD * 3
  const h = size + PAD * 2
  // A stamp sits centred on the point it was placed at.
  const box = { x: a.anchor.x - w / 2, y: a.anchor.y - h / 2, w, h }
  return {
    box,
    body: (
      <>
        <rect
          className="annotation-stamp"
          x={box.x}
          y={box.y}
          width={w}
          height={h}
          rx={3}
          fill="var(--page)"
          fillOpacity={0.85}
          stroke={colour}
          strokeWidth={sw}
        />
        <SvgText
          x={box.x + PAD * 1.5}
          y={a.anchor.y}
          fill={colour}
          fontFamily={FONT_FAMILY}
          fontSize={size}
          dominantBaseline="central"
        >
          {a.text}
        </SvgText>
      </>
    ),
  }
}

function drawHighlight(a: ShapeAnnotation, colour: string, words: WordLayer | null): Drawn {
  const text = a.anchor.text
  const boxes = words && text ? wordBoxes(words, text) : []
  if (boxes.length > 0) {
    const left = Math.min(...boxes.map((b) => b.x))
    const bottom = Math.min(...boxes.map((b) => b.y))
    return {
      box: {
        x: left,
        y: bottom,
        w: Math.max(...boxes.map((b) => b.x + b.w)) - left,
        h: Math.max(...boxes.map((b) => b.y + b.h)) - bottom,
      },
      body: boxes.map((b) => (
        <rect
          className="annotation-highlight"
          key={`${b.x}:${b.y}`}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          fill={colour}
          fillOpacity={0.35}
          style={{ mixBlendMode: 'multiply' }}
        />
      )),
    }
  }
  // Re-anchoring could not bind the words (or the page's words are not here): a dashed marker.
  const quote = text?.quote ?? ''
  const snippet = unboundSnippet(quote)
  const w = helveticaWidth(snippet, UNBOUND_FONT) + 8
  const h = 12
  const box = { x: a.anchor.x, y: a.anchor.y - h / 2, w, h }
  return {
    box,
    body: (
      <g data-unbound="true">
        <rect
          x={box.x}
          y={box.y}
          width={w}
          height={h}
          rx={2}
          fill="var(--page)"
          fillOpacity={0.85}
          stroke={colour}
          strokeWidth={1.25}
          strokeDasharray="3 2"
        />
        <SvgText
          x={box.x + 4}
          y={a.anchor.y}
          fill={colour}
          fontFamily={FONT_FAMILY}
          fontSize={UNBOUND_FONT}
          dominantBaseline="central"
        >
          {snippet}
        </SvgText>
      </g>
    ),
  }
}

function draw(a: ShapeAnnotation, colour: string, words: WordLayer | null): Drawn {
  const sw = a.style.strokeWidth ?? DEFAULT_STROKE
  switch (a.type) {
    case 'rect':
    case 'ellipse':
      return drawRect(a, colour, sw)
    case 'line':
    case 'arrow':
      return drawLine(a, colour, sw)
    case 'note':
      return drawNote(a, colour)
    case 'stamp':
      return drawStamp(a, colour, sw)
    default:
      return drawHighlight(a, colour, words)
  }
}

/** Where the shape sits on its page, in displayed points: what a selection outline goes around. */
export function annotationBox(annotation: ShapeAnnotation, words: WordLayer | null): Box {
  return draw(annotation, '#000', words).box
}

export interface AnnotationShapeProps {
  annotation: ShapeAnnotation
  /** The layer's colour: what the shape uses when its style names none. */
  layerColour: string
  /** `LX`, `Personal`. */
  layerName: string
  /** The page's word layer, which a highlight draws over. */
  words: WordLayer | null
  selected: boolean
  /** Drawn with a move cursor: the user may drag it. */
  movable?: boolean
  /** False while a drawing tool is active, so the pointer reaches the page instead. */
  interactive?: boolean
  onPointerDown?: PointerEventHandler<SVGGElement>
  /** Enter or Space on the focused shape: select it. */
  onActivate?: () => void
}

/** The shape's focusable group, found by its row id: after a walk or a creation keyboard focus can follow. */
export function focusAnnotationShape(id: string, frames = 30): void {
  const el = document.querySelector<SVGGElement>(`[data-annotation-id="${CSS.escape(id)}"]`)
  if (el) el.focus({ preventScroll: true })
  else if (frames > 0) requestAnimationFrame(() => focusAnnotationShape(id, frames - 1))
}

/**
 * One annotation on its page, in displayed space: a rect, ellipse, line, arrow, note, stamp, or
 * highlight in its own colour or its layer's. Like a cue marker it is an accessible button.
 */
export function AnnotationShape({
  annotation,
  layerColour,
  layerName,
  words,
  selected,
  movable = false,
  interactive = true,
  onPointerDown,
  onActivate,
}: AnnotationShapeProps) {
  const colour = annotation.style.colour ?? layerColour
  const { box, body } = draw(annotation, colour, words)
  return (
    // biome-ignore lint/a11y/useSemanticElements: an SVG shape cannot be an HTML <button>; it carries the button role, focus and keys itself
    <g
      className="annotation-shape"
      role="button"
      tabIndex={0}
      aria-label={annotationAccessibleName(annotation, layerName)}
      aria-pressed={selected}
      onKeyDown={(e: KeyboardEvent<SVGGElement>) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onActivate?.()
      }}
      data-annotation-id={annotation.id}
      data-annotation-type={annotation.type}
      data-selected={selected ? 'true' : undefined}
      style={{
        pointerEvents: interactive ? 'auto' : 'none',
        cursor: movable ? 'move' : 'pointer',
        touchAction: movable ? 'none' : undefined,
      }}
      onPointerDown={onPointerDown}
    >
      {body}
      {selected && (
        <rect
          className="annotation-selection"
          x={box.x - 3}
          y={box.y - 3}
          width={box.w + 6}
          height={box.h + 6}
          rx={6}
          fill="none"
          stroke="var(--red)"
          strokeWidth={2}
          pointerEvents="none"
        />
      )}
    </g>
  )
}

/** A shape being drawn or dragged: the same drawing without the button, so it is never focusable or read out. */
export function AnnotationPreview({
  annotation,
  layerColour,
  words,
}: Pick<AnnotationShapeProps, 'annotation' | 'layerColour' | 'words'>) {
  const colour = annotation.style.colour ?? layerColour
  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a plain SVG group is never focusable; the preview holds only drawing
    <g className="annotation-preview" aria-hidden="true" pointerEvents="none" opacity={0.75}>
      {draw(annotation, colour, words).body}
    </g>
  )
}
