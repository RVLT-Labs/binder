import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { pageGeometry } from './coords'
import {
  type PDFDocumentProxy,
  type PDFPageProxy,
  RenderingCancelledException,
  type RenderTask,
} from './pdfjs'
import { createRenderQueue } from './renderQueue'
import { renderScale } from './renderScale'

/** Shared by every page on screen: at most two renders run at once. */
const queue = createRenderQueue(2)

export interface PageCanvasProps {
  pdf: PDFDocumentProxy
  /** Zero-based. */
  pageIndex: number
  zoom: number
  /** Displayed width and height in PDF points, from the synced page row. */
  width: number
  height: number
  /** Drawn over the page in its box, e.g. an SVG overlay in displayed space. */
  children?: ReactNode
}

/**
 * One page: a box sized to the displayed page at the zoom, with the rendered canvas inside.
 * Renders through the shared queue at up to 2x device pixels, keeps the previous canvas on screen
 * until a re-render at a new zoom finishes, cancels on zoom change and unmount, and releases the
 * page's resources in PDF.js once it leaves the list.
 */
export function PageCanvas({ pdf, pageIndex, zoom, width, height, children }: PageCanvasProps) {
  const key = useId()
  const host = useRef<HTMLDivElement>(null)
  const pageRef = useRef<PDFPageProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { cssWidth, cssHeight } = pageGeometry({ width, height }, zoom)

  useEffect(() => {
    let active = true
    let cancelRender: (() => void) | undefined
    pdf.getPage(pageIndex + 1).then(
      (page) => {
        if (!active) return
        pageRef.current = page
        cancelRender = queue.enqueue(
          key,
          () => {
            const scale = renderScale({ width, height }, zoom, window.devicePixelRatio)
            // PDF.js applies the page's /Rotate, so this viewport matches the displayed size.
            const viewport = page.getViewport({ scale })
            const canvas = document.createElement('canvas')
            canvas.width = Math.floor(viewport.width)
            canvas.height = Math.floor(viewport.height)
            canvas.className = 'page-canvas absolute inset-0 size-full'
            canvas.setAttribute('role', 'img')
            canvas.setAttribute('aria-label', `Page ${pageIndex + 1}`)
            let task: RenderTask
            try {
              task = page.render({ canvas, viewport })
            } catch (err) {
              releaseCanvas(canvas)
              throw err
            }
            task.promise.then(
              () => {
                if (!active || !host.current) return releaseCanvas(canvas)
                swapCanvas(host.current, canvas)
                setError(null)
              },
              (err: unknown) => {
                releaseCanvas(canvas)
                if (active && !(err instanceof RenderingCancelledException)) {
                  setError(err instanceof Error ? err.message : String(err))
                }
              },
            )
            return task
          },
          (err) => {
            if (active) setError(err instanceof Error ? err.message : String(err))
          },
        )
      },
      (err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err))
      },
    )
    return () => {
      active = false
      cancelRender?.()
    }
  }, [pdf, pageIndex, zoom, width, height, key])

  // biome-ignore lint/correctness/useExhaustiveDependencies: evicts the page when it is replaced, not only on unmount
  useEffect(() => {
    const el = host.current
    return () => {
      // PDF.js defers this until a cancelled render has settled.
      pageRef.current?.cleanup()
      pageRef.current = null
      const old = el?.firstElementChild
      if (old instanceof HTMLCanvasElement) releaseCanvas(old)
      el?.replaceChildren()
    }
  }, [pdf, pageIndex])

  return (
    <div
      // Positioned, explicitly sized, and nothing else: no border, padding or transform, so a
      // pointer's offset from this box is its offset on the page.
      className="page-sheet relative mx-auto bg-page shadow-[0_6px_24px_rgb(0_0_0/0.55)]"
      data-page-index={pageIndex}
      style={{ width: cssWidth, height: cssHeight }}
    >
      {/* Canvases are swapped in here outside React, so this element has no React children. */}
      <div ref={host} className="page-canvas-host absolute inset-0 size-full" />
      {error && (
        <p className="page-error absolute inset-x-0 bottom-0 m-0 p-2 text-t-out">
          Could not render page {pageIndex + 1}: {error}
        </p>
      )}
      {children}
    </div>
  )
}

function swapCanvas(host: HTMLDivElement, next: HTMLCanvasElement) {
  const old = host.firstElementChild
  host.replaceChildren(next)
  if (old instanceof HTMLCanvasElement) releaseCanvas(old)
}

/** Zero-sizing a detached canvas frees its backing store now rather than at GC (notably in Safari). */
function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}
