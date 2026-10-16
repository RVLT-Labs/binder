import type { ReactNode } from 'react'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

export interface StatusBarProps {
  /** One-based page in view. */
  page: number
  pages: number
  /** Whether placed cues snap to the text under them. */
  snap: boolean
  /** Turns snapping on or off: the word "on" / "off" is the toggle. Without it the line only reads. */
  onSnapChange?: (on: boolean) => void
  /** The layer new markup goes on, with its colour from the data; null until membership has synced. */
  activeLayer: { name: string; colour: string } | null
  /** The page and zoom controls, at the right. */
  children?: ReactNode
  className?: string
}

/** The keys people forget (DESIGN 6.2). ⌘K joins them when the palette lands. */
const KEYS: Array<[key: string, does: string]> = [
  ['c', 'place'],
  [']', 'next cue'],
  ['g', 'go to page'],
]

/**
 * The 26 px strip under the script screen: where you are, what snapping and the active layer will
 * do to the next mark, and the page and zoom controls. Desktop and tablet only.
 */
export function StatusBar({
  page,
  pages,
  snap,
  onSnapChange,
  activeLayer,
  children,
  className,
}: StatusBarProps) {
  return (
    <section
      aria-label="Script status"
      className={cn(
        'flex h-[26px] shrink-0 items-center gap-4 border-t border-line bg-paper-2 px-3 text-[11.5px] text-muted',
        className,
      )}
    >
      <span className="whitespace-nowrap">
        Page <span className="font-mono tabular-nums text-ink-2">{page}</span> of{' '}
        <span className="font-mono tabular-nums text-ink-2">{pages}</span>
      </span>
      <span aria-hidden className="h-[18px] w-px bg-line" />
      {onSnapChange ? (
        <label
          className={cn(
            'relative inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-sm',
            // a 44 px hit area on a touch tablet, and a focus ring from the checkbox inside
            "after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']",
            'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-red has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-paper-2',
          )}
        >
          <input
            type="checkbox"
            className="peer sr-only"
            // the word beside it says the state; the control's name is the setting
            aria-label="Snap to text"
            checked={snap}
            onChange={(e) => onSnapChange(e.target.checked)}
          />
          Snap to text{' '}
          <span aria-hidden className={cn('font-mono', snap ? 'text-ok' : 'text-muted')}>
            {snap ? 'on' : 'off'}
          </span>
        </label>
      ) : (
        <span className="whitespace-nowrap">
          Snap to text{' '}
          <span className={cn('font-mono', snap ? 'text-ok' : 'text-muted')}>
            {snap ? 'on' : 'off'}
          </span>
        </span>
      )}
      {activeLayer && (
        <>
          <span aria-hidden className="h-[18px] w-px bg-line" />
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            Active layer
            {/* The department's own colour, from the data. */}
            <span
              aria-hidden
              className="size-2.5 rounded-[3px]"
              style={{ background: activeLayer.colour }}
            />
            <span className="font-semibold" style={{ color: activeLayer.colour }}>
              {activeLayer.name}
            </span>
          </span>
        </>
      )}
      <span className="ml-auto flex items-center gap-3">
        {children}
        <span className="hidden items-center gap-3 min-[1025px]:flex">
          <span aria-hidden className="h-[18px] w-px bg-line" />
          {KEYS.map(([key, does]) => (
            <span key={key} className="flex items-center gap-1.5 whitespace-nowrap">
              <Kbd>{key}</Kbd>
              {does}
            </span>
          ))}
        </span>
      </span>
    </section>
  )
}
