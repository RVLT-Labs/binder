import { type ReactNode, useState } from 'react'
import { MoreIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TopBarPhone } from '../shell/TopBarSlots'

export interface PhoneBarMenuProps {
  /** Zero-based page in view and the page count; absent while there is no viewer. */
  page?: { current: number; count: number }
  /** The document's own actions: version, review, upload revision, print. */
  items: (close: () => void, opener: () => HTMLElement | null) => ReactNode
  /** What the viewer adds: the page and zoom controls and the markup tools. */
  viewer?: ReactNode
}

/**
 * The phone's script top bar, after the back chevron and the title (the mockup's `m-markup`): the
 * page position in mono, and one "..." menu that holds everything the wider bars spread out. The
 * controls are drawn into the shell's top bar (see TopBarSlots). Every control inside is at least
 * 44 px, as on the rest of the phone.
 */
export function PhoneBarMenu({ page, items, viewer }: PhoneBarMenuProps) {
  const [open, setOpen] = useState(false)
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null)
  return (
    <TopBarPhone>
      {page && (
        <span className="shrink-0 whitespace-nowrap font-mono text-[13px] tabular-nums text-ink-2">
          p.<span className="text-ink">{page.current + 1}</span> / {page.count}
        </span>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={setTrigger}
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Document options"
            className="shrink-0"
          >
            <MoreIcon className="!size-[22px]" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="flex max-h-[calc(100dvh-7rem)] w-[min(22rem,calc(100vw-24px))] flex-col gap-3 overflow-y-auto p-3"
        >
          {items(
            () => setOpen(false),
            () => trigger,
          )}
          {viewer}
        </PopoverContent>
      </Popover>
    </TopBarPhone>
  )
}
