import { type FormEvent, useState } from 'react'
import { MAX_ZOOM, MIN_ZOOM } from './controls'

export interface ViewerToolbarProps {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFitWidth: () => void
  /** One-based. */
  pageNumber: number
  pageCount: number
  /** One-based, already clamped to the document. */
  onGoToPage: (pageNumber: number) => void
  versionLabel: string
}

export function ViewerToolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  pageNumber,
  pageCount,
  onGoToPage,
  versionLabel,
}: ViewerToolbarProps) {
  const [target, setTarget] = useState('')

  function go(e: FormEvent) {
    e.preventDefault()
    const n = Number.parseInt(target, 10)
    if (!Number.isFinite(n)) return
    onGoToPage(Math.min(pageCount, Math.max(1, n)))
    setTarget('')
  }

  return (
    <div className="viewer-toolbar" role="toolbar" aria-label="Viewer">
      <button type="button" onClick={onZoomOut} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out">
        −
      </button>
      <output className="zoom-level" aria-label="Zoom level" aria-live="off">
        {Math.round(zoom * 100)}%
      </output>
      <button type="button" onClick={onZoomIn} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">
        +
      </button>
      <button type="button" onClick={onFitWidth}>
        Fit width
      </button>
      <output className="page-position" aria-label="Page position" aria-live="off">
        {pageNumber} / {pageCount}
      </output>
      <form onSubmit={go} className="go-to-page">
        <input
          aria-label="Go to page"
          placeholder="Page"
          inputMode="numeric"
          pattern="[0-9]*"
          size={4}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
      </form>
      <span className="version-label">{versionLabel}</span>
    </div>
  )
}
