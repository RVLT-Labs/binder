import { formatCueNumber, markerText } from '@binder/core'
import type { LayerRef, WordLayer } from '@binder/shared'
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { PageRow } from '../powersync/schema'
import { PeerOutline } from '../presence/PeerOutline'
import { usePresencePeers } from '../presence/PresenceProvider'
import { peerSelections } from '../presence/peers'
import {
  AnnotationPreview,
  AnnotationShape,
  annotationBox,
  toShapeAnnotation,
} from './AnnotationShape'
import { CueMarker, CueTrigger } from './CueMarker'
import { layoutPageCues } from './cueLayout'
import { useDragSlot } from './dragGesture'
import { Handles } from './Handles'
import { useMarkupSession } from './MarkupSession'
import type { AnnotationRow, CueRowWithDept } from './markupView'
import { pageAt, toPagePoint } from './pagePoint'
import { endRelocate, useRelocating } from './relocate'
import { clearSelection, select, useSelection } from './selection'
import { isDragTool, useTool } from './tools'
import { rowKey, useAnnotationGestures } from './useAnnotationGestures'
import { useWordLayer } from './wordLayers'

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

const layerOf = (row: AnnotationRow): LayerRef => ({
  kind: row.layer_kind === 'personal' ? 'personal' : 'department',
  id: row.layer_id ?? '',
})

/**
 * Annotations and cue markers for one page, drawn inside its PageOverlay (displayed space, y up),
 * and the surface that takes the placing and drawing tools' pointer. The overlay's SVG ignores the
 * pointer, so everything here that takes one opts back in.
 */
export function MarkupOverlay({ page, words, zoom }: MarkupOverlayProps) {
  const session = useMarkupSession()
  const selection = useSelection()
  const { tool, cueType, rebind } = useTool()
  const relocating = useRelocating()
  const { peers } = usePresencePeers()
  const peerOn = useMemo(() => peerSelections(peers, session.versionId), [peers, session.versionId])
  const [ghost, setGhost] = useState<Ghost | null>(null)
  /** The cue the pointer is over (its tag or its trigger words): its words fill lightly. */
  const [hovered, setHovered] = useState<string | null>(null)
  /** The one drag in progress from this page: a cue marker, a shape, a handle, or a drawing. */
  const slot = useDragSlot()
  const root = useRef<SVGGElement>(null)
  const pageIndex = page.index ?? 0
  const size = { width: page.width ?? 0, height: page.height ?? 0 }
  const cues = session.view.cuesByPage.get(pageIndex) ?? []
  const { markerSide, departments } = session
  // One layout for the page's tags, highlights and leaders: the same core code print stamps with.
  const tags = useMemo(
    () =>
      layoutPageCues(
        cues,
        words,
        size.width,
        (id) => markerSide(id),
        (id) => departments.find((d) => d.id === id)?.sort_order ?? 0,
      ),
    [cues, words, size.width, markerSide, departments],
  )
  const annotations = session.view.annotationsByPage.get(pageIndex) ?? []
  const placing = tool === 'cue' && !('disabled' in session.cueTarget)
  const annotating =
    tool !== 'select' && tool !== 'cue' && !('disabled' in session.annotationTarget)
  const dragging = rebind !== null || (annotating && isDragTool(tool))
  const gestures = useAnnotationGestures({ pageIndex, size, words, session, slot, root })
  const { preview } = gestures

  // A row that disappears mid-drag (deleted elsewhere, its layer hidden) ends the drag at once.
  useEffect(() => {
    slot.endIfGone((id) => cues.some((c) => c.id === id) || annotations.some((a) => a.id === id))
  }, [slot, cues, annotations])
  // So does the page leaving the list.
  useEffect(() => () => slot.stop(), [slot])

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
    if (relocating) {
      void session.relocate(relocating.table, relocating.id, pageIndex, point)
      endRelocate()
    } else if (placing) void session.placeCue(pageIndex, point, cueType, words)
    else if (gestures.placeByClick(point) || dragging) return
    else clearSelection()
  }

  function onMarkerDown(e: ReactPointerEvent<SVGGElement>, cue: CueRowWithDept) {
    if (e.button !== 0) return
    e.stopPropagation()
    const wasSelected = selection?.table === 'cues' && selection.id === cue.id
    select('cues', cue.id)
    // Only an already selected cue drags, so a tap or a scroll that starts on a marker never moves it.
    if (!wasSelected || !session.canEditCue(cue)) return
    slot.begin(cue.id, {
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      capture: e.currentTarget,
      onMove: (ev) => setGhost({ cue, x: ev.clientX, y: ev.clientY }),
      onDrop: (ev) => {
        const drop = pageAt(ev.clientX, ev.clientY)
        const dropPage = drop ? session.pages[drop.pageIndex] : undefined
        if (!drop || !dropPage) return
        const point = toPagePoint({ x: ev.clientX, y: ev.clientY }, drop.rect, {
          width: dropPage.width ?? 0,
          height: dropPage.height ?? 0,
        })
        void session.moveCue(cue.id, drop.pageIndex, point, { dropped: true })
      },
      onStop: () => setGhost(null),
    })
  }

  /** The row as drawn: while a gesture on it is under way, its preview stands in for the stored fields. */
  const display = (row: AnnotationRow) => {
    const shape = toShapeAnnotation(row)
    // Only while the stored row is still as the gesture found it; once it differs the write landed.
    if (preview?.kind !== 'edit' || preview.id !== row.id || preview.base !== rowKey(row))
      return shape
    return { ...shape, anchor: { ...shape.anchor, ...preview.anchor }, geometry: preview.geometry }
  }
  const draftColour =
    'layer' in session.annotationTarget ? session.layerColour(session.annotationTarget.layer) : ''
  const selectedRow =
    selection?.table === 'annotations' ? annotations.find((a) => a.id === selection.id) : undefined
  const handlesFor =
    selectedRow && tool === 'select' && !rebind && session.canEditAnnotation(selectedRow)
      ? selectedRow
      : undefined

  return (
    // Hover is tracked over the surface and the markers alike, for placing a cue from the keyboard.
    <g
      ref={root}
      className="markup-overlay"
      onPointerMove={track}
      onPointerLeave={() => {
        if (session.hover.current?.pageIndex === pageIndex) session.hover.current = null
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the page surface takes pointer placement and drawing; the keyboard places cues with c */}
      <rect
        className="markup-surface"
        x={0}
        y={0}
        width={size.width}
        height={size.height}
        fill="transparent"
        style={{
          pointerEvents: 'auto',
          cursor: placing || annotating || rebind || relocating ? 'crosshair' : 'default',
          // A drawing drag on a touch screen draws instead of scrolling the page.
          touchAction: dragging ? 'none' : undefined,
          userSelect: 'none',
        }}
        onClick={onSurfaceClick}
        onPointerDown={gestures.onSurfaceDown}
      />
      {cues.map((cue) => {
        const tag = tags.get(cue.id)
        return (
          tag && (
            <CueTrigger
              key={cue.id}
              cue={cue}
              tag={tag}
              interactive={tool === 'select' && !rebind}
              filled={
                hovered === cue.id || (selection?.table === 'cues' && selection.id === cue.id)
              }
              onActivate={() => select('cues', cue.id)}
              onHover={(over) => setHovered((h) => (over ? cue.id : h === cue.id ? null : h))}
            />
          )
        )
      })}
      {annotations.map((row) => {
        const layer = layerOf(row)
        const selected = selection?.table === 'annotations' && selection.id === row.id
        return (
          <AnnotationShape
            key={row.id}
            annotation={display(row)}
            layerColour={session.layerColour(layer)}
            layerName={session.layerName(layer)}
            words={words}
            selected={selected}
            movable={
              selected &&
              tool === 'select' &&
              row.type !== 'highlight' &&
              session.canEditAnnotation(row)
            }
            interactive={tool === 'select' && !rebind}
            onPointerDown={(e) => gestures.onShapeDown(e, row, selected)}
            onActivate={() => select('annotations', row.id)}
          />
        )
      })}
      {preview?.kind === 'draft' && (
        <AnnotationPreview annotation={preview.shape} layerColour={draftColour} words={words} />
      )}
      {handlesFor && (
        <Handles
          annotation={display(handlesFor)}
          zoom={zoom}
          onHandleDown={(handle, e) => gestures.onHandleDown(handle, e, handlesFor)}
        />
      )}
      {cues.map((cue) => {
        const selected = selection?.table === 'cues' && selection.id === cue.id
        const movable = selected && session.canEditCue(cue)
        const tag = tags.get(cue.id)
        return (
          tag && (
            <CueMarker
              key={cue.id}
              cue={cue}
              tag={tag}
              selected={selected}
              movable={movable}
              onPointerDown={(e) => onMarkerDown(e, cue)}
              onActivate={() => select('cues', cue.id)}
              onHover={(over) => setHovered((h) => (over ? cue.id : h === cue.id ? null : h))}
            />
          )
        )
      })}
      {annotations.map((row) => {
        const who = peerOn.get(`annotations:${row.id}`)
        return (
          who && <PeerOutline key={row.id} box={annotationBox(display(row), words)} peers={who} />
        )
      })}
      {cues.map((cue) => {
        const who = peerOn.get(`cues:${cue.id}`)
        const tag = tags.get(cue.id)
        return who && tag && <PeerOutline key={cue.id} box={tag.tag} peers={who} />
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
