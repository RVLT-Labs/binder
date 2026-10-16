import { PanelLeft, PanelRight } from 'lucide-react'
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
  /**
   * The context panel's openers where it is not docked: the tablet's top bar toggle, and the phone
   * menu's Layers and "N to review" rows (`review` is null when the document has no revisions to
   * review). Null while there is no panel (a version that is not ready).
   */
  panel: {
    open: boolean
    onToggle: () => void
    onOpenTab: (tab: 'layers' | 'review') => void
    review: { count: number } | null
  } | null
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
  const { panel, onUploadRevision, onPrint } = props
  const row = 'w-full justify-start'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="t-over">Version</span>
        {props.version('field')}
      </div>
      {panel && (
        <Button
          type="button"
          variant="line"
          className={row}
          onClick={() => {
            panel.onOpenTab('layers')
            close()
          }}
        >
          Layers
        </Button>
      )}
      {panel?.review && (
        <Button
          type="button"
          variant="line"
          className={`review-count ${row}`}
          onClick={() => {
            panel.onOpenTab('review')
            close()
          }}
        >
          <span className="font-mono tabular-nums">{panel.review.count}</span> to review
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
 * at the right who else is here, undo and redo, Upload revision and Print, all the mockup's small
 * buttons (the review count is the context panel's Review tab now; a tablet gets a toggle for the
 * panel's sheet). At phone the bar is the mockup's: the title, the page position and
 * one menu (`PhoneBarMenu`); while a version is not ready there is no viewer to add the page, so
 * the menu holds the document's actions alone. With a viewer, the viewer draws the menu itself.
 */
export function DocumentControls(props: DocumentControlsProps & { viewerOwnsPhoneBar?: boolean }) {
  const { version, panel, onUploadRevision, thumbnails, print, history, viewerOwnsPhoneBar } = props
  const breakpoint = useBreakpoint()

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
        {breakpoint === 'tablet' && panel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hover:bg-elev hover:text-ink aria-pressed:bg-card aria-pressed:text-ink"
            aria-label="Context panel"
            aria-pressed={panel.open}
            onClick={panel.onToggle}
          >
            <PanelRight aria-hidden strokeWidth={1.8} />
          </Button>
        )}
        {history}
        {upload}
        {print}
      </TopBarActions>
    </>
  )
}
