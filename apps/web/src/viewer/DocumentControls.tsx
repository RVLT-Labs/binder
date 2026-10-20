import { PanelLeft, PanelRight } from 'lucide-react'
import { type ReactNode, useRef } from 'react'
import { MoreIcon, PrintIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { modLabel } from '@/lib/modKey'
import { openPalette } from '../palette/paletteState'
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
  /** Switches to Calling mode (DESIGN §9); only a ready version has it. */
  onCalling: (() => void) | null
  /** The "…" menu's rows for a ready version: Go to page… (focuses the page box) and Renumber (null without rights). */
  onGoToPage: (() => void) | null
  onRenumber: (() => void) | null
}

/** Compact rows only for fine pointers; coarse targets belong to the primitive. */
const ITEM = '[@media(pointer:fine)]:min-h-8'

/** The document's own actions as the phone's menu lists them, 44 px each. */
export function documentMenuItems(
  props: DocumentControlsProps,
  close: () => void,
  opener: () => HTMLElement | null,
) {
  const { panel, onUploadRevision, onPrint, onCalling } = props
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
      {onCalling && (
        <Button
          type="button"
          variant="line"
          className={row}
          onClick={() => {
            close()
            onCalling()
          }}
        >
          Calling mode
        </Button>
      )}
    </div>
  )
}

/**
 * What the script screen puts in the top bar (DESIGN 6.2): the version chip after the crumbs, then
 * at the right who else is here, undo and redo, Print, Calling mode and a ghost "…" menu (Upload
 * revision, the command palette, Go to page, Renumber), all the mockup's small buttons (the review
 * count is the context panel's Review tab now; a tablet gets a toggle for the panel's sheet). At phone the bar is the mockup's: the title, the page position and
 * one menu (`PhoneBarMenu`); while a version is not ready there is no viewer to add the page, so
 * the menu holds the document's actions alone. With a viewer, the viewer draws the menu itself.
 */
export function DocumentControls(props: DocumentControlsProps & { viewerOwnsPhoneBar?: boolean }) {
  const {
    version,
    panel,
    onUploadRevision,
    thumbnails,
    print,
    history,
    viewerOwnsPhoneBar,
    onCalling,
    onGoToPage,
    onRenumber,
  } = props
  const breakpoint = useBreakpoint()
  /** The "…" button, which an action that opens a dialog hands focus back to. */
  const moreTrigger = useRef<HTMLButtonElement>(null)
  /**
   * What a "…" row does once the menu has closed. A menu hands focus back to its button as it
   * closes, so a row that moves focus (Go to page…) or opens an overlay that remembers where it
   * came from (the palette) runs then, not on select.
   */
  const afterClose = useRef<(() => void) | null>(null)

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
            className="hover:before:bg-elev hover:text-ink aria-pressed:before:bg-card aria-pressed:text-ink"
            aria-label="Thumbnails"
            aria-pressed={thumbnails.open}
            onClick={thumbnails.onToggle}
          >
            <PanelLeft aria-hidden />
          </Button>
        )}
        {breakpoint === 'tablet' && panel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hover:before:bg-elev hover:text-ink aria-pressed:before:bg-card aria-pressed:text-ink"
            aria-label="Context panel"
            aria-pressed={panel.open}
            onClick={panel.onToggle}
          >
            <PanelRight aria-hidden />
          </Button>
        )}
        {history}
        {print}
        {onCalling && (
          <TooltipProvider delayDuration={500} skipDelayDuration={150}>
            <Tooltip disableHoverableContent>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="line"
                  size="sm"
                  className="shrink-0"
                  data-calling-toggle
                  onClick={onCalling}
                >
                  Calling mode
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="flex items-center gap-2">
                Calling mode
                <Kbd>⇧C</Kbd>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={moreTrigger}
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Document options"
              className="hover:before:bg-elev hover:text-ink data-[state=open]:before:bg-card data-[state=open]:text-ink"
            >
              <MoreIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-60"
            onCloseAutoFocus={(e) => {
              const run = afterClose.current
              if (!run) return
              afterClose.current = null
              e.preventDefault()
              run()
            }}
          >
            {onUploadRevision && (
              <DropdownMenuItem
                className={ITEM}
                onSelect={() => {
                  if (moreTrigger.current) onUploadRevision(moreTrigger.current)
                }}
              >
                Upload revision
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className={ITEM}
              onSelect={() => {
                afterClose.current = () => {
                  moreTrigger.current?.focus()
                  openPalette()
                }
              }}
            >
              Command palette…
              <Kbd className="ml-auto">{modLabel('K')}</Kbd>
            </DropdownMenuItem>
            {onGoToPage && (
              <DropdownMenuItem
                className={ITEM}
                onSelect={() => {
                  afterClose.current = onGoToPage
                }}
              >
                Go to page…
                <Kbd className="ml-auto">g</Kbd>
              </DropdownMenuItem>
            )}
            {onRenumber && (
              <DropdownMenuItem className={ITEM} onSelect={onRenumber}>
                Renumber from script order
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TopBarActions>
    </>
  )
}
