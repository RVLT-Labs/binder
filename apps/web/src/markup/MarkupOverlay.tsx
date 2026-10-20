import {
  asCueType,
  BAR_WIDTH,
  barAt,
  caretAt,
  formatCueNumber,
  markerText,
  snapToCaret,
  wordBoxes,
} from '@binder/core'
import { isCaretMark, type LayerRef, type WordLayer } from '@binder/shared'
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
import { BubblePreview, CueMarker, CueTrigger } from './CueMarker'
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
import { hundredth, tagKey as storedTagKey, useBubbleNudge } from './useBubbleNudge'
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

/** A bubble being dragged: where its pill's centre is now, in page points. */
interface BubbleDrag {
  cueId: string
  centre: { x: number; y: number }
  /**
   * Set once the bubble is dropped: the cue's stored tag then (`storedTagKey`). The preview stays
   * until the write lands and the stored tag differs, so the bubble never jumps back and forth.
   */
  settle?: string
}

/** The longest a dropped bubble's preview stands in for a write that has not shown up. */
const SETTLE_MS = 1500

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
  const { tool, cueType, cueMark, rebind } = useTool()
  const relocating = useRelocating()
  const { peers } = usePresencePeers()
  const peerOn = useMemo(() => peerSelections(peers, session.versionId), [peers, session.versionId])
  const [ghost, setGhost] = useState<Ghost | null>(null)
  /** The bubble being dragged, if any: its preview pill is drawn at the pointer. */
  const [bubbleDrag, setBubbleDrag] = useState<BubbleDrag | null>(null)
  /** The pointer on this page, kept only while a line or pointer mark is being aimed (it draws the caret ghost). */
  const [aim, setAim] = useState<{ x: number; y: number } | null>(null)
  /** The cue the pointer is over (its tag or its trigger words): its words fill lightly. */
  const [hovered, setHovered] = useState<string | null>(null)
  /** The one drag in progress from this page: a cue marker, a shape, a handle, or a drawing. */
  const slot = useDragSlot()
  const root = useRef<SVGGElement>(null)
  const pageIndex = page.index ?? 0
  const size = { width: page.width ?? 0, height: page.height ?? 0 }
  const cues = session.view.cuesByPage.get(pageIndex) ?? []
  /** The page's cues as stored now, for a drag that ends long after it began. */
  const liveCues = useRef(cues)
  liveCues.current = cues
  const { markerSide, departments } = session
  const selectedCue = selection?.table === 'cues' ? selection.id : null
  // Arrow-key nudges: drawn at once, written once per burst.
  const nudges = useBubbleNudge(cues, selectedCue, (id, tag) => void session.setBubble(id, tag))
  // biome-ignore lint/correctness/useExhaustiveDependencies: `nudges.version` changes when a target does
  const drawnCues = useMemo(
    () =>
      cues.map((c) => {
        const tag = nudges.targetOf(c.id)
        return tag ? { ...c, anchor: { ...c.anchor, tag } } : c
      }),
    [cues, nudges.targetOf, nudges.version],
  )
  // One layout for the page's tags, highlights and leaders: the same core code print stamps with.
  const tags = useMemo(
    () =>
      layoutPageCues(
        drawnCues,
        words,
        { width: size.width, height: size.height },
        (id) => markerSide(id),
        (id) => departments.find((d) => d.id === id)?.sort_order ?? 0,
      ),
    [drawnCues, words, size.width, size.height, markerSide, departments],
  )
  /** Where the dragged bubble would land, laid out as the saved cue would be (full lead, clamped to the page). */
  const bubblePreview = useMemo(() => {
    const cue = bubbleDrag && cues.find((c) => c.id === bubbleDrag.cueId)
    if (!bubbleDrag || !cue) return null
    const tag = {
      dx: bubbleDrag.centre.x - cue.anchor.x,
      dy: bubbleDrag.centre.y - cue.anchor.y,
    }
    const layout = layoutPageCues(
      [{ ...cue, anchor: { ...cue.anchor, tag } }],
      words,
      { width: size.width, height: size.height },
      (id) => markerSide(id),
      (id) => departments.find((d) => d.id === id)?.sort_order ?? 0,
    ).get(cue.id)
    return layout ? { cue, layout } : null
  }, [bubbleDrag, cues, words, size.width, size.height, markerSide, departments])
  const annotations = session.view.annotationsByPage.get(pageIndex) ?? []
  const placing = tool === 'cue' && !('disabled' in session.cueTarget)
  const annotating =
    tool !== 'select' && tool !== 'cue' && !('disabled' in session.annotationTarget)
  const dragging = rebind !== null || (annotating && isDragTool(tool))
  const gestures = useAnnotationGestures({ pageIndex, size, words, session, slot, root })
  const { preview } = gestures
  // A line or pointer is aimed with a ghost bar at the character boundary the click would take.
  const aiming = placing && isCaretMark(cueMark) && !relocating
  const caretGhost = useMemo(() => {
    if (!aiming || !aim || !session.snap || !words) return null
    const caret = snapToCaret(words, aim)
    const at = caret && caretAt(words, caret.text)
    return caret && at ? barAt({ x: caret.x, box: at.box }) : null
  }, [aiming, aim, session.snap, words])
  const { cueTarget } = session
  const cueColour =
    'departmentId' in cueTarget
      ? (departments.find((d) => d.id === cueTarget.departmentId)?.colour ?? '')
      : ''

  // A row that disappears mid-drag (deleted elsewhere, its layer hidden) ends the drag at once.
  useEffect(() => {
    slot.endIfGone((id) => cues.some((c) => c.id === id) || annotations.some((a) => a.id === id))
  }, [slot, cues, annotations])
  // A dropped bubble's preview gives way to the stored one once the write lands (or after a moment, if it was refused).
  useEffect(() => {
    if (bubbleDrag?.settle === undefined) return
    const cue = cues.find((c) => c.id === bubbleDrag.cueId)
    if (!cue || storedTagKey(cue.anchor.tag) !== bubbleDrag.settle) {
      setBubbleDrag(null)
      return
    }
    const timer = setTimeout(() => setBubbleDrag(null), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [bubbleDrag, cues])
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
    if (aiming) setAim(point)
  }

  function onSurfaceClick(e: ReactMouseEvent<SVGRectElement>) {
    const point = pointOf(e)
    if (!point) return
    if (relocating) {
      void session.relocate(relocating.table, relocating.id, pageIndex, point)
      endRelocate()
    } else if (placing) {
      // The click that ends a range drag has already placed its cue.
      if (!gestures.consumeDragClick()) {
        void session.placeCue(pageIndex, point, cueType, words, cueMark)
      }
    } else if (gestures.placeByClick(point) || dragging) return
    else clearSelection()
  }

  /** A viewport position as page points, on the page box `sheet` is now (it may have scrolled since the press). */
  function pageOf(sheet: Element, clientX: number, clientY: number) {
    const { left, top } = sheet.getBoundingClientRect()
    return toPagePoint({ x: clientX, y: clientY }, { left, top, width: size.width * zoom }, size)
  }

  /** The bubble: only an already selected cue's drags, so a tap or a scroll that starts on it never moves it. */
  function onMarkerDown(e: ReactPointerEvent<SVGGElement>, cue: CueRowWithDept) {
    if (e.button !== 0) return
    e.stopPropagation()
    const wasSelected = selection?.table === 'cues' && selection.id === cue.id
    select('cues', cue.id)
    const layout = tags.get(cue.id)
    const sheet = sheetOf(e.currentTarget)
    if (!wasSelected || !session.canEditCue(cue) || !layout || !sheet) return
    // A nudge still waiting for its write goes first, so the drop is the later change.
    nudges.flush(cue.id)
    // The pill follows the pointer without jumping: it keeps the offset it was picked up at.
    const pick = pageOf(sheet, e.clientX, e.clientY)
    const grab = {
      x: pick.x - (layout.tag.x + layout.tag.w / 2),
      y: pick.y - (layout.tag.y + layout.tag.h / 2),
    }
    const centreAt = (ev: PointerEvent) => {
      const p = pageOf(sheet, ev.clientX, ev.clientY)
      return { x: p.x - grab.x, y: p.y - grab.y }
    }
    slot.begin(cue.id, {
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      capture: e.currentTarget,
      onMove: (ev) => setBubbleDrag({ cueId: cue.id, centre: centreAt(ev) }),
      onDrop: (ev) => {
        // A drop off this page's sheet (another page, the gutter, outside the viewer) changes nothing.
        if (pageAt(ev.clientX, ev.clientY)?.pageIndex !== pageIndex) return
        // A peer may have moved the cue (or its tag) mid-drag: the offset is against the anchor as it is now.
        const live = liveCues.current.find((c) => c.id === cue.id)
        if (!live) return
        const centre = centreAt(ev)
        setBubbleDrag({ cueId: cue.id, centre, settle: storedTagKey(live.anchor.tag) })
        void session.setBubble(cue.id, {
          dx: hundredth(centre.x - live.anchor.x),
          dy: hundredth(centre.y - live.anchor.y),
        })
      },
      onStop: () => setBubbleDrag((d) => (d?.settle === undefined ? null : d)),
    })
  }

  /** An arrow key on the focused bubble: it moves from where it is drawn now. */
  function nudge(cue: CueRowWithDept, dx: number, dy: number) {
    const layout = tags.get(cue.id)
    if (!layout) return
    const base = {
      dx: layout.tag.x + layout.tag.w / 2 - cue.anchor.x,
      dy: layout.tag.y + layout.tag.h / 2 - cue.anchor.y,
    }
    nudges.nudge(cue.id, base, dx, dy)
  }

  /** The mark (its words, fill or bar): an already selected cue drags across pages and re-places itself on drop. */
  function onMarkDown(e: ReactPointerEvent<SVGElement>, cue: CueRowWithDept) {
    if (e.button !== 0) return
    const wasSelected = selection?.table === 'cues' && selection.id === cue.id
    // An unselected cue's mark only selects (its click does that), so a scroll that starts on it never moves the cue.
    if (!wasSelected || !session.canEditCue(cue)) return
    e.stopPropagation()
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
        setAim(null)
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
        const movable =
          tool === 'select' &&
          !rebind &&
          selection?.table === 'cues' &&
          selection.id === cue.id &&
          session.canEditCue(cue)
        return (
          tag && (
            <CueTrigger
              key={cue.id}
              cue={cue}
              tag={tag}
              interactive={tool === 'select' && !rebind}
              zoom={zoom}
              movable={movable}
              filled={
                hovered === cue.id || (selection?.table === 'cues' && selection.id === cue.id)
              }
              onPointerDown={(e) => onMarkDown(e, cue)}
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
      {preview?.kind === 'range' && words && (
        <g className="cue-range-preview-boxes" pointerEvents="none">
          {wordBoxes(words, preview.text).map((b) => (
            <rect
              key={`${b.x}:${b.y}`}
              className="cue-range-preview"
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              fill={cueColour}
              fillOpacity={0.3}
              style={{ mixBlendMode: 'multiply' }}
            />
          ))}
        </g>
      )}
      {caretGhost && (
        <line
          className="cue-caret-ghost"
          x1={caretGhost.x}
          x2={caretGhost.x}
          y1={caretGhost.y1}
          y2={caretGhost.y2}
          stroke={cueColour}
          strokeWidth={BAR_WIDTH}
          opacity={0.5}
          style={{ pointerEvents: 'none' }}
        />
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
              faded={bubbleDrag?.cueId === cue.id}
              onPointerDown={(e) => onMarkerDown(e, cue)}
              onNudge={(dx, dy) => nudge(cue, dx, dy)}
              onBlur={() => nudges.flush(cue.id)}
              onActivate={() => select('cues', cue.id)}
              onHover={(over) => setHovered((h) => (over ? cue.id : h === cue.id ? null : h))}
            />
          )
        )
      })}
      {bubblePreview && <BubblePreview cue={bubblePreview.cue} tag={bubblePreview.layout} />}
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
    asCueType(cue.type),
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
