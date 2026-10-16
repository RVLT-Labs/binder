import { PanelLeft, Upload } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { BinderAvatars } from '../presence/Avatars'
import { TopBarActions, TopBarChip } from '../shell/TopBarSlots'
import { useBreakpoint } from '../shell/useBreakpoint'

export interface DocumentControlsProps {
  /** The version chip (the switcher). */
  version: ReactNode
  /** How many items the revision review holds, and whether its panel is open; null draws no toggle. */
  review: { count: number; open: boolean; onToggle: () => void } | null
  /** Upload revision, when the user may and the network is there; null draws nothing. */
  onUploadRevision: ((opener: HTMLElement) => void) | null
  /** The page thumbnails' toggle: tablet only, where they start hidden. */
  thumbnails: { open: boolean; onToggle: () => void }
  /** The Print button; only a ready version has one. */
  print: ReactNode
}

/**
 * What the script screen puts in the top bar (DESIGN 6.2): the version chip after the crumbs, then
 * at the right who else is here, the review count, Upload revision and Print. At phone the shell's
 * top bar has no room, so the same controls form a wrapping row above the page.
 */
export function DocumentControls({
  version,
  review,
  onUploadRevision,
  thumbnails,
  print,
}: DocumentControlsProps) {
  const breakpoint = useBreakpoint()

  const reviewToggle = review && (
    <Button
      type="button"
      variant="line"
      size="sm"
      className="review-count shrink-0 md:h-8 md:px-3.5 md:text-[13px] aria-pressed:border-ink aria-pressed:bg-card"
      aria-pressed={review.open}
      onClick={review.onToggle}
    >
      <span className="font-mono tabular-nums">{review.count}</span> to review
    </Button>
  )
  const upload = onUploadRevision && (
    <Button
      type="button"
      variant="line"
      size="sm"
      className="shrink-0 max-md:size-11 max-md:px-0 md:h-8 md:px-3.5 md:text-[13px]"
      onClick={(e) => onUploadRevision(e.currentTarget)}
    >
      <Upload aria-hidden className="!size-4 md:hidden" strokeWidth={1.8} />
      <span className="max-md:sr-only">Upload revision</span>
    </Button>
  )

  if (breakpoint === 'phone') {
    return (
      <div className="document-bar flex shrink-0 items-center gap-2 border-b border-line bg-paper px-2 py-1">
        <div className="min-w-0 flex-1">{version}</div>
        {reviewToggle}
        {upload}
        {print}
      </div>
    )
  }

  return (
    <>
      <TopBarChip>{version}</TopBarChip>
      <TopBarActions>
        <BinderAvatars />
        {breakpoint === 'tablet' && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-[10px] text-ink-2 hover:bg-elev hover:text-ink aria-pressed:bg-card aria-pressed:text-ink"
            aria-label="Thumbnails"
            aria-pressed={thumbnails.open}
            onClick={thumbnails.onToggle}
          >
            <PanelLeft aria-hidden strokeWidth={1.8} />
          </Button>
        )}
        {reviewToggle}
        {upload}
        {print}
      </TopBarActions>
    </>
  )
}
