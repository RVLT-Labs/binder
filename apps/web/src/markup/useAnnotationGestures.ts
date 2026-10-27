import type { TextAnchor, WordLayer } from '@binder/shared'
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { type ShapeAnnotation, toShapeAnnotation } from './AnnotationShape'
import { draftToAnnotation } from './annotationDraft'
import {
  type BoxHandle,
  type Handle,
  moveBy,
  moveEndpointOrNull,
  resizeBoxOrNull,
} from './annotationEdit'
import type { DragSlot } from './dragGesture'
import type { MarkupSession } from './MarkupSession'
import type { AnnotationRow } from './markupView'
import { toPagePoint } from './pagePoint'
import { isRelocating } from './relocate'
import { chosenStamp } from './StampPicker'
import { select } from './selection'
import { dragMark, endRebind, isDragTool, useTool } from './tools'
import { highlightPoint, wordRangeFromDrag } from './wordRange'

type Point = { x: number; y: number }

/** What the page shows while a gesture is under way, in place of (or beside) the stored rows. */
export type Preview =
  | {
      kind: 'edit'
      id: string
      /** The row as it was stored when the gesture began: once it differs, the write has landed. */
      base: string
      anchor: Point
      geometry: Record<string, number>
    }
  | { kind: 'draft'; shape: ShapeAnnotation }
  /** The words a cue-tool drag has covered so far. */
  | { kind: 'range'; text: TextAnchor }

/** How long a finished gesture's preview stays if the stored row never changes (a refused write). */
const SETTLE_MS = 400

export const rowKey = (row: AnnotationRow): string =>
  `${JSON.stringify(row.anchor)}|${row.geometry}`

export interface GestureEnv {
  pageIndex: number
  size: { width: number; height: number }
  words: WordLayer | null
  session: MarkupSession
  slot: DragSlot
  /** Any element inside the page's box, to find the page on screen. */
  root: RefObject<Element | null>
}

/**
 * The page's annotation gestures: drawing a rect, ellipse, line, arrow or highlight by dragging
 * (and re-selecting a highlight's words), moving a selected shape by dragging it, and resizing it by
 * a handle. Each gesture writes once, on release; until the write lands the page shows its preview.
 */
export function useAnnotationGestures({ pageIndex, size, words, session, slot, root }: GestureEnv) {
  const { tool, cueType, cueMark, stamp, rebind } = useTool()
  const [preview, setPreview] = useState<Preview | null>(null)
  const annotating = !('disabled' in session.annotationTarget)

  const sheet = useCallback(() => root.current?.closest('[data-page-index]') ?? null, [root])
  const toPoint = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const el = sheet()
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return toPagePoint(
        { x: clientX, y: clientY },
        { left: rect.left, top: rect.top, width: rect.width },
        size,
      )
    },
    [sheet, size],
  )

  /** The settle timers still running, cleared with the page so none fires on a page that is gone. */
  const settleTimers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const mounted = useRef(true)
  useEffect(() => {
    const timers = settleTimers.current
    mounted.current = true
    return () => {
      mounted.current = false
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  /** Keeps `shown` on the page until the write lands (the row changes) or it plainly did not. */
  const settle = useCallback((shown: Preview, write: Promise<unknown>) => {
    setPreview(shown)
    void write.finally(() => {
      // The write may land after the page has gone: there is then nothing to settle.
      if (!mounted.current) return
      const timer = setTimeout(() => {
        settleTimers.current.delete(timer)
        setPreview((cur) => (cur === shown ? null : cur))
      }, SETTLE_MS)
      settleTimers.current.add(timer)
    })
  }, [])

  /** Set when a cue-tool drag placed its range, so the click that follows the release places nothing more. */
  const dragPlaced = useRef(false)
  /** True once, right after a cue-tool drag placed a range: the page's click handler skips that click. */
  const consumeDragClick = useCallback(() => {
    const was = dragPlaced.current
    dragPlaced.current = false
    return was
  }, [])
  /** What a drag over words places with the cue tool as set: Auto highlights, Underline and Highlight as named. */
  const rangeMark = dragMark(cueMark)
  const cueRange =
    tool === 'cue' &&
    !('disabled' in session.cueTarget) &&
    // With Snap off a press-and-drag is not a range: the click places an unbound mark, as before.
    session.snap &&
    rangeMark !== null

  /**
   * A press on the page with the cue tool in Auto, underline or highlight mode: a drag past the
   * threshold selects the words it covers, shown as a preview, and the release places one cue on
   * them. A press and release without a drag is left to the click, which places as it always did
   * (a line in Auto).
   */
  const beginCueRange = useCallback(
    (e: ReactPointerEvent<SVGElement>, from: Point, mark: 'underline' | 'highlight') => {
      if (!words) return
      const rangeTo = (ev: { clientX: number; clientY: number }) => {
        const to = toPoint(ev.clientX, ev.clientY)
        return to ? wordRangeFromDrag(words, from, to, { wholeQuote: true }) : null
      }
      let settled = false
      slot.begin(null, {
        pointerId: e.pointerId,
        start: { x: e.clientX, y: e.clientY },
        capture: e.currentTarget,
        onMove: (ev) => {
          const text = rangeTo(ev)
          setPreview(text ? { kind: 'range', text } : null)
        },
        onDrop: (ev) => {
          const text = rangeTo(ev)
          if (!text) return
          settled = true
          dragPlaced.current = true
          settle(
            { kind: 'range', text },
            session.placeCueRange(pageIndex, text, cueType, mark, words),
          )
        },
        onStop: () => {
          if (!settled) setPreview(null)
        },
      })
    },
    [words, toPoint, slot, session, pageIndex, cueType, settle],
  )

  /** A press on the empty page with a dragging tool (or "Re-select words") active, or the cue tool. */
  const onSurfaceDown = useCallback(
    (e: ReactPointerEvent<SVGElement>) => {
      dragPlaced.current = false
      const drawing = annotating && isDragTool(tool) ? tool : null
      if (e.button !== 0) return
      if (!drawing && !rebind) {
        // A touch screen keeps its scroll: only a mouse or pen drags a range.
        if (!cueRange || isRelocating() || e.pointerType === 'touch') return
        const start = toPoint(e.clientX, e.clientY)
        if (start && rangeMark) beginCueRange(e, start, rangeMark)
        return
      }
      // No native text selection or image drag under a drawing gesture.
      e.preventDefault()
      const from = toPoint(e.clientX, e.clientY)
      if (!from) return
      const mode = rebind ? 'highlight' : (drawing as NonNullable<typeof drawing>)
      let range: ReturnType<typeof wordRangeFromDrag> = null
      const shapeOf = (to: Point): ShapeAnnotation | null => {
        if (mode === 'highlight') {
          range = words ? wordRangeFromDrag(words, from, to) : null
          const at = words && range ? highlightPoint(words, range) : null
          return range && at
            ? {
                id: 'draft',
                type: 'highlight',
                anchor: { pageIndex, ...at, text: range },
                geometry: {},
                text: '',
                style: {},
              }
            : null
        }
        const draft = draftToAnnotation(mode, from, to)
        return draft
          ? {
              id: 'draft',
              type: mode,
              anchor: { pageIndex, ...draft.anchor },
              geometry: draft.geometry,
              text: '',
              style: {},
            }
          : null
      }
      let settled = false
      slot.begin(null, {
        pointerId: e.pointerId,
        start: { x: e.clientX, y: e.clientY },
        capture: e.currentTarget,
        onMove: (ev) => {
          const to = toPoint(ev.clientX, ev.clientY)
          const shape = to ? shapeOf(to) : null
          setPreview(shape ? { kind: 'draft', shape } : null)
        },
        onDrop: (ev) => {
          const to = toPoint(ev.clientX, ev.clientY)
          const shape = to ? shapeOf(to) : null
          if (!shape) return
          settled = true
          const shown: Preview = { kind: 'draft', shape }
          if (rebind) {
            const text = range
            if (!text) return
            settle(shown, session.rebindHighlight(rebind, pageIndex, text, shape.anchor))
            endRebind()
          } else if (shape.type === 'highlight') {
            settle(
              shown,
              session.placeAnnotation({
                type: 'highlight',
                pageIndex,
                point: shape.anchor,
                textAnchor: shape.anchor.text,
              }),
            )
          } else {
            settle(
              shown,
              session.placeAnnotation({
                type: shape.type,
                pageIndex,
                point: shape.anchor,
                geometry: shape.geometry,
              }),
            )
          }
        },
        onStop: () => {
          if (!settled) setPreview(null)
        },
      })
    },
    [
      annotating,
      tool,
      rebind,
      cueRange,
      rangeMark,
      beginCueRange,
      toPoint,
      words,
      pageIndex,
      session,
      slot,
      settle,
    ],
  )

  /** A click that places a note or stamp where it lands; null when the active tool is neither. */
  const placeByClick = useCallback(
    (point: Point): boolean => {
      if (!annotating) return false
      if (tool === 'note') {
        void session.placeAnnotation({ type: 'note', pageIndex, point, text: 'Note' })
        return true
      }
      if (tool === 'stamp') {
        const text = chosenStamp(session.stamps, stamp)
        if (text) void session.placeAnnotation({ type: 'stamp', pageIndex, point, text })
        return true
      }
      return false
    },
    [annotating, tool, stamp, session, pageIndex],
  )

  /** Starts an edit gesture on a stored annotation: `next` turns the pointer's position into its new fields. */
  const beginEdit = useCallback(
    (
      e: ReactPointerEvent<Element>,
      row: AnnotationRow,
      next: (
        ev: { clientX: number; clientY: number },
        scale: number,
      ) => { anchor: Point; geometry: Record<string, number> } | null,
      geometryChanges: boolean,
    ) => {
      const el = sheet()
      const scale = el ? el.getBoundingClientRect().width / size.width : 1
      const base = rowKey(row)
      let last: { anchor: Point; geometry: Record<string, number> } | null = null
      let settled = false
      slot.begin(row.id, {
        pointerId: e.pointerId,
        start: { x: e.clientX, y: e.clientY },
        capture: e.currentTarget,
        onMove: (ev) => {
          const result = next(ev, scale)
          if (!result) return
          last = result
          setPreview({ kind: 'edit', id: row.id, base, ...result })
        },
        onDrop: () => {
          if (!last) return
          settled = true
          const shown: Preview = { kind: 'edit', id: row.id, base, ...last }
          const anchor = {
            ...row.anchor,
            x: last.anchor.x,
            y: last.anchor.y,
            status: 'ok' as const,
          }
          settle(
            shown,
            session.editAnnotation(
              row.id,
              geometryChanges ? { anchor, geometry: last.geometry } : { anchor },
            ),
          )
        },
        onStop: () => {
          if (!settled) setPreview(null)
        },
      })
    },
    [sheet, size.width, slot, session, settle],
  )

  /** A press on a shape: selects it, and a selected one the user may edit drags to move. */
  const onShapeDown = useCallback(
    (e: ReactPointerEvent<SVGGElement>, row: AnnotationRow, selected: boolean) => {
      if (e.button !== 0) return
      e.stopPropagation()
      select('annotations', row.id)
      // Only an already selected shape drags, so a tap or scroll that starts on it never moves it.
      // A highlight is bound to its words, so it does not drag (Re-select words moves it).
      if (!selected || row.type === 'highlight' || !session.canEditAnnotation(row)) return
      const start = { x: e.clientX, y: e.clientY }
      const geometry = toShapeAnnotation(row).geometry
      beginEdit(
        e,
        row,
        (ev, scale) => ({
          anchor: moveBy(
            row.anchor,
            (ev.clientX - start.x) / scale,
            -(ev.clientY - start.y) / scale,
            size,
          ),
          geometry,
        }),
        false,
      )
    },
    [beginEdit, session, size],
  )

  /** A press on a resize handle of the selected shape. */
  const onHandleDown = useCallback(
    (handle: Handle, e: ReactPointerEvent<Element>, row: AnnotationRow) => {
      if (!session.canEditAnnotation(row)) return
      const geometry = toShapeAnnotation(row).geometry
      beginEdit(
        e,
        row,
        (ev) => {
          const p = toPoint(ev.clientX, ev.clientY)
          if (!p) return null
          const result =
            handle === 'start' || handle === 'end'
              ? moveEndpointOrNull(
                  row.anchor,
                  { dx: geometry.dx ?? 0, dy: geometry.dy ?? 0 },
                  handle,
                  p,
                )
              : resizeBoxOrNull(
                  row.anchor,
                  { w: geometry.w ?? 0, h: geometry.h ?? 0 },
                  handle as BoxHandle,
                  p,
                )
          return result
            ? { anchor: result.anchor, geometry: result.geometry as Record<string, number> }
            : null
        },
        true,
      )
    },
    [beginEdit, session, toPoint],
  )

  return {
    preview,
    onSurfaceDown,
    onShapeDown,
    onHandleDown,
    placeByClick,
    consumeDragClick,
    toPoint,
  }
}
