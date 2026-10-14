import { formatCueNumber, markerText } from '@binder/core'
import type { WordLayer } from '@binder/shared'
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { PageRow } from '../powersync/schema'
import { CueMarker } from './CueMarker'
import { useMarkupSession } from './MarkupSession'
import type { CueRowWithDept } from './markupView'
import { pageAt, toPagePoint } from './pagePoint'
import { clearSelection, select, useSelection } from './selection'
import { useTool } from './tools'
import { useWordLayer } from './wordLayers'

/** Pointer travel, in CSS pixels, before a press on a selected cue becomes a drag. */
const DRAG_THRESHOLD = 3

export interface MarkupOverlayProps {
  page: PageRow
  /** The page's word layer, for the overlay's text-aware tools; null when it has none. */
  words: WordLayer | null
  zoom: number
}

interface Ghost {
  cue: CueRowWithDept
  x: number
  y: number
}

/** The page box (`[data-page-index]`) an overlay element sits in. */
function sheetOf(el: Element): Element | null {
  return el.closest('[data-page-index]')
}

/**
 * Cue markers for one page, drawn inside its PageOverlay (displayed space, y up), and the surface
 * that takes the cue tool's clicks. The overlay's SVG ignores the pointer, so everything here that
 * takes one opts back in.
 */
export function MarkupOverlay({ page, words, zoom }: MarkupOverlayProps) {
  const session = useMarkupSession()
  const selection = useSelection()
  const { tool, cueType } = useTool()
  const [ghost, setGhost] = useState<Ghost | null>(null)
  /** The drag in progress from this page, if any. */
  const drag = useRef<{ id: string; stop: () => void } | null>(null)
  const pageIndex = page.index ?? 0
  const size = { width: page.width ?? 0, height: page.height ?? 0 }
  const cues = session.view.cuesByPage.get(pageIndex) ?? []
  const placing = tool === 'cue' && !('disabled' in session.cueTarget)

  // A cue that disappears mid-drag (deleted elsewhere, its layer hidden) ends the drag at once.
  useEffect(() => {
    const dragged = drag.current
    if (dragged && !cues.some((c) => c.id === dragged.id)) dragged.stop()
  }, [cues])
  // So does the page leaving the list.
  useEffect(() => () => drag.current?.stop(), [])

  /** The pointer on this page, in displayed points. */
  function pointOf(e: ReactMouseEvent<Element>) {
    const sheet = sheetOf(e.currentTarget)
    if (!sheet) return null
    const { left, top } = sheet.getBoundingClientRect()
    return toPagePoint(
      { x: e.clientX, y: e.clientY },
      { left, top, width: size.width * zoom },
      size,
    )
  }

  function track(e: ReactMouseEvent<Element>) {
    const point = pointOf(e)
    session.hover.current = point ? { pageIndex, point } : null
  }

  function onSurfaceClick(e: ReactMouseEvent<SVGRectElement>) {
    const point = pointOf(e)
    if (!point) return
    if (placing) void session.placeCue(pageIndex, point, cueType, words)
    else clearSelection()
  }

  function onMarkerDown(e: ReactPointerEvent<SVGGElement>, cue: CueRowWithDept) {
    if (e.button !== 0) return
    e.stopPropagation()
    const wasSelected = selection?.table === 'cues' && selection.id === cue.id
    select('cues', cue.id)
    // Only an already selected cue drags, so a tap or a scroll that starts on a marker never moves it.
    if (!wasSelected || !session.canEditCue(cue)) return
    const target = e.currentTarget
    const start = { x: e.clientX, y: e.clientY }
    let dragging = false
    target.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD)
        return
      dragging = true
      setGhost({ cue, x: ev.clientX, y: ev.clientY })
    }
    // Listening on the window, not the marker: if the marker goes mid-drag (a collaborator deleted
    // the cue) the release still ends the drag.
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      if (drag.current?.stop === stop) drag.current = null
      setGhost(null)
    }
    const end = (ev: PointerEvent) => {
      stop()
      if (!dragging || ev.type === 'pointercancel') return
      const drop = pageAt(ev.clientX, ev.clientY)
      const dropPage = drop ? session.pages[drop.pageIndex] : undefined
      if (!drop || !dropPage) return
      const point = toPagePoint({ x: ev.clientX, y: ev.clientY }, drop.rect, {
        width: dropPage.width ?? 0,
        height: dropPage.height ?? 0,
      })
      void session.moveCue(cue.id, drop.pageIndex, point)
    }
    drag.current?.stop()
    drag.current = { id: cue.id, stop }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  return (
    // Hover is tracked over the surface and the markers alike, for placing a cue from the keyboard.
    <g
      className="markup-overlay"
      onPointerMove={track}
      onPointerLeave={() => {
        if (session.hover.current?.pageIndex === pageIndex) session.hover.current = null
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the page surface takes pointer placement; the keyboard places cues with c */}
      <rect
        className="markup-surface"
        x={0}
        y={0}
        width={size.width}
        height={size.height}
        fill="transparent"
        style={{ pointerEvents: 'auto', cursor: placing ? 'crosshair' : 'default' }}
        onClick={onSurfaceClick}
      />
      {cues.map((cue) => {
        const selected = selection?.table === 'cues' && selection.id === cue.id
        const movable = selected && session.canEditCue(cue)
        return (
          <CueMarker
            key={cue.id}
            cue={cue}
            selected={selected}
            movable={movable}
            onPointerDown={(e) => onMarkerDown(e, cue)}
            onActivate={() => select('cues', cue.id)}
          />
        )
      })}
      {ghost && createPortal(<DragGhost ghost={ghost} />, document.body)}
    </g>
  )
}

function DragGhost({ ghost }: { ghost: Ghost }) {
  const { cue } = ghost
  const text = markerText(
    cue.type === 'standby' || cue.type === 'warn' ? cue.type : 'go',
    cue.dept_code,
    formatCueNumber(cue.major ?? 0, cue.minor ?? 0, cue.dept_number_format),
  )
  return (
    <div
      className="cue-drag-ghost"
      aria-hidden="true"
      style={{ left: ghost.x, top: ghost.y, borderColor: cue.dept_colour, color: cue.dept_colour }}
    >
      {text}
    </div>
  )
}

/** The markup overlay for a mounted page, with the page's words loaded for it. */
export function PageMarkup({ page, zoom }: { page: PageRow; zoom: number }) {
  const words = useWordLayer(page.words_key)
  return <MarkupOverlay page={page} words={words} zoom={zoom} />
}
