import { PanelLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { PrintIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { BinderAvatars } from '../presence/Avatars'
import { TopBarActions, TopBarChip } from '../shell/TopBarSlots'
import { useBreakpoint } from '../shell/useBreakpoint'
import { PhoneBarMenu } from './PhoneBarMenu'

export interface DocumentControlsProps {
  /** The version chip (the switcher), and the same switcher as a field for the phone's menu. */
  version: (display: 'chip' | 'field') => ReactNode
  /** How many items the revision review holds, and whether its panel is open; null draws no toggle. */
  review: { count: number; open: boolean; onToggle: () => void } | null
  /** Upload revision, when the user may and the network is there; null draws nothing. */
  onUploadRevision: ((opener: HTMLElement) => void) | null
  /** The page thumbnails' toggle: tablet only, where they start hidden. */
  thumbnails: { open: boolean; onToggle: () => void }
  /** The Print button; only a ready version has one. */
  print: ReactNode
  /** The phone's menu row for Print: opens the dialog, which the page holds so the menu may close. */
  onPrint: ((opener: HTMLElement) => void) | null
  /** Undo and redo, which are the markup session's: only a ready version has them. */
  history?: ReactNode
}

/** The document's own actions as the phone's menu lists them, 44 px each. */
export function documentMenuItems(
  props: DocumentControlsProps,
  close: () => void,
  opener: () => HTMLElement | null,
) {
  const { review, onUploadRevision, onPrint } = props
  const row = 'w-full justify-start'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="t-over">Version</span>
        {props.version('field')}
      </div>
      {review && (
        <Button
          type="button"
          variant="line"
          className={`review-count ${row} aria-pressed:border-ink`}
          aria-pressed={review.open}
          onClick={() => {
            review.onToggle()
            close()
          }}
        >
          <span className="font-mono tabular-nums">{review.count}</span> to review
        </Button>
      )}
      {onUploadRevision && (
        <Button
          type="button"
          variant="line"
          className={row}
          onClick={() => {
            close()
            const el = opener()
            if (el) onUploadRevision(el)
          }}
        >
          Upload revision
        </Button>
      )}
      {onPrint && (
        <Button
          type="button"
          variant="line"
          className={row}
          onClick={() => {
            close()
            const el = opener()
            if (el) onPrint(el)
          }}
        >
          <PrintIcon aria-hidden />
          Print
        </Button>
      )}
    </div>
  )
}

/**
 * What the script screen puts in the top bar (DESIGN 6.2): the version chip after the crumbs, then
 * at the right who else is here, undo and redo, the review count, Upload revision and Print, all
 * the mockup's small buttons. At phone the bar is the mockup's: the title, the page position and
 * one menu (`PhoneBarMenu`); while a version is not ready there is no viewer to add the page, so
 * the menu holds the document's actions alone. With a viewer, the viewer draws the menu itself.
 */
export function DocumentControls(props: DocumentControlsProps & { viewerOwnsPhoneBar?: boolean }) {
  const { version, review, onUploadRevision, thumbnails, print, history, viewerOwnsPhoneBar } =
    props
  const breakpoint = useBreakpoint()

  const reviewToggle = review && (
    <Button
      type="button"
      variant="line"
      size="sm"
      className="review-count shrink-0 aria-pressed:border-ink aria-pressed:bg-card"
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
      className="shrink-0"
      onClick={(e) => onUploadRevision(e.currentTarget)}
    >
      Upload revision
    </Button>
  )

  if (breakpoint === 'phone') {
    if (viewerOwnsPhoneBar) return null
    return <PhoneBarMenu items={(close, opener) => documentMenuItems(props, close, opener)} />
  }

  return (
    <>
      <TopBarChip>{version('chip')}</TopBarChip>
      <TopBarActions>
        <BinderAvatars />
        {breakpoint === 'tablet' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hover:bg-elev hover:text-ink aria-pressed:bg-card aria-pressed:text-ink"
            aria-label="Thumbnails"
            aria-pressed={thumbnails.open}
            onClick={thumbnails.onToggle}
          >
            <PanelLeft aria-hidden strokeWidth={1.8} />
          </Button>
        )}
        {history}
        {reviewToggle}
        {upload}
        {print}
      </TopBarActions>
    </>
  )
}
