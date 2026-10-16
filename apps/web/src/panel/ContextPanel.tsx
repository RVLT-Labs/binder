import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'
import { cn } from '@/lib/utils'
import { isEditableTarget } from '../markup/useMarkupShortcuts'
import { useBreakpoint } from '../shell/useBreakpoint'

export interface PanelTab {
  id: string
  label: string
  /** A count drawn as a blue pill after the label (the Review tab's); nothing when 0 or absent. */
  badge?: number
  /** Drawn when the tab is the chosen one (the other tabs' content is not mounted). */
  content: ReactNode
  /** The docked panel widens to the review mockup's 420 px while this tab is chosen. */
  wide?: boolean
}

export interface ContextPanelProps {
  tabs: readonly PanelTab[]
  value: string
  onValueChange: (id: string) => void
  /** Tablet sheet and phone drawer only: whether it is drawn. The desktop panel is always docked. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Where focus goes when the sheet or drawer closes: the selected tag that opened it. A function
   * is called at that moment, so the element can be one that mounted after the panel did.
   */
  returnFocusTo?: HTMLElement | null | (() => HTMLElement | null)
  /** The tablet and phone dialogs' accessible name; the docked panel's landmark name. */
  label?: string
  /**
   * Phone only: draw a Done button (44 px) at the end of the tab row, for a tab that has none of its
   * own (the editors carry one beside Delete). It closes the drawer like a drag does.
   */
  showDone?: boolean
}

/**
 * Escape in a text field of the panel belongs to the field (it throws the draft away and leaves
 * it); only an Escape from anywhere else closes the sheet. A select has no draft: it is blurred
 * here, because the event is handled (so the editor's own handler skips it) and a second Escape,
 * from the sheet itself, closes.
 */
const keepOpenInFields = (e: KeyboardEvent) => {
  const at = document.activeElement
  if (!isEditableTarget(at)) return
  e.preventDefault()
  if (at instanceof HTMLSelectElement) at.blur()
}

const resolve = (to: ContextPanelProps['returnFocusTo']) => (typeof to === 'function' ? to() : to)

/** `.panel-tabs button`: 12.5 px / 600, the chosen tab on the card fill with a 2 px red underline. */
const TAB =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-t-[8px] px-2.5 py-1.5 font-sans text-[12.5px] font-semibold text-muted transition-colors ' +
  'hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red ' +
  'data-[state=active]:bg-card data-[state=active]:text-ink data-[state=active]:shadow-[inset_0_-2px_0_var(--red)] ' +
  // the sheet's larger touch tabs (t-markup: padding 13 / 12 / 11, 13 px) and the phone's 44 px
  'md:max-[1024px]:px-3 md:max-[1024px]:pt-[13px] md:max-[1024px]:pb-[11px] md:max-[1024px]:text-[13px] max-md:min-h-11 max-md:px-3 max-md:text-[14px]'

function Pill({ n }: { n: number }) {
  return (
    <span className="ml-1 inline-flex h-4 items-center rounded-full bg-blue-soft px-1.5 font-sans text-[11px] font-semibold leading-none text-blue">
      {n}
    </span>
  )
}

function Body({
  tabs,
  value,
  onValueChange,
  wide,
  showDone,
  onOpenChange,
}: ContextPanelProps & { wide: boolean }) {
  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      // Arrow keys move between the tabs without opening them: opening Review moves focus to its
      // heading, which must not happen while someone is only passing over the tab.
      activationMode="manual"
      className="flex min-h-0 flex-1 flex-col"
      data-wide={wide || undefined}
    >
      <div className="flex shrink-0 items-end justify-between border-b border-line">
        <TabsPrimitive.List
          aria-label="Panel"
          className="flex min-w-0 gap-0.5 px-2.5 pt-2 md:max-[1024px]:pt-2.5"
        >
          {tabs.map((tab) => (
            <TabsPrimitive.Trigger key={tab.id} value={tab.id} className={TAB}>
              {tab.label}
              {tab.badge ? (
                <>
                  {/* the space is for the accessible name: "Review 4", not "Review4" */}{' '}
                  <Pill n={tab.badge} />
                </>
              ) : null}
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>
        {showDone && (
          <button
            type="button"
            className="mr-2 inline-flex min-h-11 shrink-0 items-center rounded-[8px] px-3 font-sans text-[14px] font-semibold text-ink hover:bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red"
            onClick={() => onOpenChange(false)}
          >
            Done
          </button>
        )}
      </div>
      {tabs.map((tab) => (
        <TabsPrimitive.Content
          key={tab.id}
          value={tab.id}
          // `.panel-body`: padding 12, gap 14 (the tablet sheet's is 14 / 16)
          className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-3 outline-none md:max-[1024px]:px-4 md:max-[1024px]:py-3.5 max-md:px-4"
        >
          {tab.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  )
}

/**
 * The script screen's right-hand panel (the mockups' `.panel`): tabs Cue, Layers, History and
 * Review with their content. Docked and always there at desktop (300 px, 420 for Review); at tablet
 * a 360 px sheet over the right of the page with no scrim, so the page stays bright and usable; at
 * phone a bottom drawer, also without a scrim, that covers the tab bar. The sheet and drawer are
 * non-modal: the page behind them keeps taking the pointer, and closing hands focus back to the
 * tag that opened them (`returnFocusTo`).
 */
export function ContextPanel(props: ContextPanelProps) {
  const { tabs, value, open, onOpenChange, returnFocusTo, label = 'Context panel' } = props
  const breakpoint = useBreakpoint()
  const wide = tabs.find((t) => t.id === value)?.wide === true

  if (breakpoint === 'desktop') {
    return (
      <aside
        aria-label={label}
        data-panel="docked"
        className={cn(
          'context-panel flex min-h-0 shrink-0 flex-col border-l border-line bg-paper-2',
          wide ? 'w-[420px]' : 'w-[300px]',
        )}
      >
        <Body {...props} wide={wide} />
      </aside>
    )
  }

  const giveFocusBack = (e: Event) => {
    const target = resolve(returnFocusTo)
    if (!target) return
    e.preventDefault()
    target.focus({ preventScroll: true })
  }

  if (breakpoint === 'tablet') {
    return (
      <DialogPrimitive.Root modal={false} open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Content
          aria-label={label}
          aria-describedby={undefined}
          data-panel="sheet"
          // A sheet over the page's right edge, from the top bar to the status bar: radius 20 0 0 20,
          // a 2 px left outline and the hard shadow (t-markup `.mb-tsheet`). Nothing dims the page.
          className={cn(
            'context-panel absolute top-0 right-0 bottom-0 z-20 flex w-[360px] max-w-full flex-col bg-paper-2',
            'rounded-l-[20px] border-l-2 border-line-2',
            'shadow-[-8px_0_0_rgba(0,0,0,0.55),-28px_0_48px_rgba(0,0,0,0.45)]',
            'overflow-hidden outline-none',
          )}
          // Opening it by selecting a tag must not move focus off the tag, and the page behind
          // stays live: neither a press on the page nor focus moving there closes it.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={keepOpenInFields}
          onCloseAutoFocus={giveFocusBack}
        >
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
          <Body {...props} wide={false} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Root>
    )
  }

  return (
    <DrawerPrimitive.Root
      open={open}
      onOpenChange={onOpenChange}
      modal={false}
      handleOnly
      shouldScaleBackground={false}
    >
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Content
          aria-label={label}
          aria-describedby={undefined}
          data-panel="drawer"
          // The mockup's `.mb-sheet`: card fill, a 2 px top outline, radius 20 20 0 0 and a hard
          // shadow, over the tab bar. No scrim: the page is the brightest thing.
          className={cn(
            'context-panel fixed inset-x-0 bottom-0 z-[60] flex max-h-[72svh] flex-col bg-card outline-none',
            'rounded-t-[20px] border-t-2 border-line-2 shadow-[0_-6px_0_rgba(0,0,0,0.5)]',
            'pb-[max(1rem,env(safe-area-inset-bottom))]',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={keepOpenInFields}
          onCloseAutoFocus={giveFocusBack}
        >
          <DrawerPrimitive.Handle
            aria-hidden
            className="!mx-auto mt-2 mb-0.5 !h-[5px] !w-10 shrink-0 !rounded-[3px] !bg-line-2"
          />
          <DrawerPrimitive.Title className="sr-only">{label}</DrawerPrimitive.Title>
          <Body {...props} wide={false} />
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  )
}
