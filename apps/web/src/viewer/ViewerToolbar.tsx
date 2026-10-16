import { Minus, MoveHorizontal, Plus } from 'lucide-react'
import { type FormEvent, type Ref, useState } from 'react'
import { cn, focusRing } from '@/lib/utils'
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
  /** The page input, so the `g` shortcut can focus it. */
  pageInputRef?: Ref<HTMLInputElement>
  /** `touch` is the phone's: every control at least 44 px. */
  size?: 'compact' | 'touch'
  className?: string
}

const control = (size: 'compact' | 'touch') =>
  cn(
    'inline-flex items-center justify-center rounded-[6px] font-sans text-[12px] font-semibold text-ink-2',
    'hover:bg-elev hover:text-ink disabled:cursor-not-allowed disabled:opacity-45',
    focusRing,
    'focus-visible:ring-offset-paper-2',
    size === 'touch' ? 'h-11 min-w-11 px-1' : 'h-6 min-w-6 px-1.5',
  )

/**
 * The page and zoom controls: where you are, go to a page, zoom and fit. They live at the right of
 * the status bar (desktop and tablet) or above the page (phone), under one labelled toolbar.
 */
export function ViewerToolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  pageNumber,
  pageCount,
  onGoToPage,
  pageInputRef,
  size = 'compact',
  className,
}: ViewerToolbarProps) {
  const [target, setTarget] = useState('')
  const touch = size === 'touch'

  function go(e: FormEvent) {
    e.preventDefault()
    const n = Number.parseInt(target, 10)
    if (!Number.isFinite(n)) return
    onGoToPage(Math.min(pageCount, Math.max(1, n)))
    setTarget('')
  }

  return (
    <div className={cn('flex items-center gap-1', className)} role="toolbar" aria-label="Viewer">
      <output
        className="page-position px-1 font-mono text-[12px] tabular-nums text-ink-2"
        aria-label="Page position"
        aria-live="off"
      >
        {pageNumber} / {pageCount}
      </output>
      <form onSubmit={go} className="go-to-page">
        <input
          ref={pageInputRef}
          aria-label="Go to page"
          placeholder="Page"
          inputMode="numeric"
          pattern="[0-9]*"
          size={4}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className={cn(
            'w-14 rounded-[6px] border border-line-2 bg-card px-2 font-mono text-[12px] tabular-nums text-ink placeholder:font-sans placeholder:text-faint',
            focusRing,
            'focus-visible:ring-offset-paper-2',
            // 16 px on a phone: a smaller field makes iOS zoom the page when it takes focus.
            touch ? 'h-11 text-[16px]' : 'h-6',
          )}
        />
      </form>
      <span aria-hidden className="mx-1 h-4 w-px bg-line-2 max-md:hidden" />
      <button
        type="button"
        onClick={onZoomOut}
        disabled={zoom <= MIN_ZOOM}
        aria-label="Zoom out"
        className={control(size)}
      >
        <Minus className="size-3.5" strokeWidth={2} aria-hidden />
      </button>
      <output
        className="zoom-level min-w-10 text-center font-mono text-[12px] tabular-nums text-ink-2"
        aria-label="Zoom level"
        aria-live="off"
      >
        {Math.round(zoom * 100)}%
      </output>
      <button
        type="button"
        onClick={onZoomIn}
        disabled={zoom >= MAX_ZOOM}
        aria-label="Zoom in"
        className={control(size)}
      >
        <Plus className="size-3.5" strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onFitWidth}
        aria-label={touch ? 'Fit width' : undefined}
        className={control(size)}
      >
        {/* Icon only on a phone, where the row has no room for the words. */}
        {touch ? <MoveHorizontal className="size-4" strokeWidth={2} aria-hidden /> : 'Fit width'}
      </button>
    </div>
  )
}
