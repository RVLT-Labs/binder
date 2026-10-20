import { useId } from 'react'
import { WifiOffIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { KeepOfflineSwitch } from '../offline/keepOffline/KeepOfflineSwitch'
import { type OfflineCopy, OfflineStatus } from '../offline/OfflineButton'
import type { OfflineSummary } from '../offline/useOfflineSummary'

const mono = 'font-mono tabular-nums'

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length < 3) return names.join(' and ')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * What the card says about the device's copy, from counts alone. When everything is stored and the
 * caller can name the documents ("Libretto v1, v2 and Piano-vocal score") the line does, as the
 * mockup's card does; the file count follows in mono.
 */
export function OfflineLine({
  summary,
  names,
}: {
  summary: OfflineSummary | null
  /** What a full copy holds, in words; used only when every file is stored. */
  names?: readonly string[]
}) {
  if (!summary) return null
  const { cached, total } = summary
  if (total === 0) return <>No document is ready to save yet.</>
  if (cached === total) {
    if (names && names.length > 0) {
      return (
        <>
          {joinNames(names)} {names.length === 1 ? 'is' : 'are'} cached on this device.{' '}
          <span className={mono}>{total}</span> files.
        </>
      )
    }
    return (
      <>
        All <span className={mono}>{total}</span> files are cached on this device.
      </>
    )
  }
  if (cached === 0) return <>Nothing is saved on this device yet.</>
  return (
    <>
      <span className={mono}>{cached}</span> of <span className={mono}>{total}</span> files are
      cached on this device.
    </>
  )
}

/** The phone's one-line version of the same facts (`.mb-note`). */
function OfflineNote({ summary }: { summary: OfflineSummary }) {
  const { cached, total } = summary
  if (total === 0) return <>Offline: no document is ready to save yet</>
  if (cached === 0) return <>Offline: nothing saved on this device yet</>
  if (cached === total) {
    return (
      <>
        Offline: cached on this device · <span className={cn(mono, 'text-ink-2')}>{total}</span>{' '}
        files
      </>
    )
  }
  return (
    <>
      Offline: <span className={cn(mono, 'text-ink-2')}>{cached}</span> of{' '}
      <span className={cn(mono, 'text-ink-2')}>{total}</span> files cached on this device
    </>
  )
}

/**
 * The overview's Offline card: how much is on this device, how a save is going, and (desktop and
 * tablet, which have no More tab) the keep-offline switch. The one-off button that saves the rest
 * is in the top bar, as in the mockup. At phone width the card is the mockup's quiet note, and the
 * switch is on More.
 */
export function OfflineCard({
  showId,
  summary,
  copy,
  names,
}: {
  showId: string
  summary: OfflineSummary | null
  copy: OfflineCopy
  names?: readonly string[]
}) {
  const heading = useId()
  return (
    <section
      aria-labelledby={heading}
      className={cn(
        'rounded-[var(--r)] border-2 border-line-2 bg-card px-4 py-3.5 shadow-card',
        // phone: `.mb-note`, a paper-2 note with a 2 px quiet border
        'max-md:flex max-md:items-center max-md:gap-3 max-md:border-line max-md:bg-paper-2 max-md:px-3.5 max-md:py-3 max-md:shadow-none',
      )}
    >
      <WifiOffIcon className="size-5 shrink-0 text-muted md:hidden" />
      <div className="min-w-0 flex-1">
        <h2 id={heading} className="t-over mb-2 max-md:sr-only">
          Offline
        </h2>
        {summary && (
          <>
            <p className="m-0 text-[12px] text-muted max-md:hidden">
              <OfflineLine summary={summary} names={names} />
            </p>
            <p className="m-0 text-[12.5px] leading-[1.4] text-muted md:hidden">
              <OfflineNote summary={summary} />
            </p>
          </>
        )}
        <KeepOfflineSwitch
          showId={showId}
          label="Keep available offline"
          className="mt-3 border-t border-line pt-2.5 max-md:hidden"
        />
        <OfflineStatus copy={copy} className="mt-2" />
      </div>
    </section>
  )
}
