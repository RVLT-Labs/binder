import type { ReactNode } from 'react'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

export interface StatusBarProps {
  /** One-based page in view. */
  page: number
  pages: number
  /** Whether placed cues snap to the text under them. */
  snap: boolean
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
 * The 28 px strip under the script screen: where you are, what snapping and the active layer will
 * do to the next mark, and the page and zoom controls. Desktop and tablet only.
 */
export function StatusBar({ page, pages, snap, activeLayer, children, className }: StatusBarProps) {
  return (
    <section
      aria-label="Script status"
      className={cn(
        'flex h-7 shrink-0 items-center gap-3 border-t border-line bg-paper-2 px-3 text-[12px] text-muted',
        className,
      )}
    >
      <span className="whitespace-nowrap">
        Page <span className="font-mono tabular-nums text-ink">{page}</span> of{' '}
        <span className="font-mono tabular-nums text-ink">{pages}</span>
      </span>
      <span aria-hidden className="h-3.5 w-px bg-line-2" />
      <span className="whitespace-nowrap">
        Snap to text{' '}
        <span className={cn('font-semibold', snap ? 'text-ok' : 'text-muted')}>
          {snap ? 'on' : 'off'}
        </span>
      </span>
      {activeLayer && (
        <>
          <span aria-hidden className="h-3.5 w-px bg-line-2" />
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            Active layer
            {/* The department's own colour, from the data. */}
            <span
              aria-hidden
              className="size-2.5 rounded-[3px]"
              style={{ background: activeLayer.colour }}
            />
            <span className="font-semibold text-ink">{activeLayer.name}</span>
          </span>
        </>
      )}
      <span className="ml-auto flex items-center gap-3">
        {children}
        <span className="hidden items-center gap-3 min-[1025px]:flex">
          <span aria-hidden className="h-3.5 w-px bg-line-2" />
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
