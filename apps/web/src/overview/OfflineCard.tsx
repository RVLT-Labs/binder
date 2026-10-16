import { WifiOff } from 'lucide-react'
import { useId } from 'react'
import { OfflineButton } from '../offline/OfflineButton'
import { type OfflineSummary, useOfflineSummary } from '../offline/useOfflineSummary'

const mono = 'font-mono tabular-nums'

/** What the card says about the device's copy, from counts alone. */
export function OfflineLine({ summary }: { summary: OfflineSummary | null }) {
  if (!summary) return null
  const { cached, total } = summary
  if (total === 0) return <>No document is ready to save yet.</>
  if (cached === total) {
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

/** The overview's Offline card: how much is on this device, and the button that saves the rest. */
export function OfflineCard({ showId }: { showId: string }) {
  const heading = useId()
  const summary = useOfflineSummary(showId)
  return (
    <section
      aria-labelledby={heading}
      className="rounded-[20px] border-2 border-line-2 bg-card p-4 shadow-card"
    >
      <h2 id={heading} className="mb-2 flex items-center gap-2 text-[12px] font-bold text-muted">
        <WifiOff className="size-3.5" strokeWidth={1.8} aria-hidden />
        Offline
      </h2>
      {summary && (
        <p className="mb-3 mt-0 text-[13px] text-ink-2">
          <OfflineLine summary={summary} />
        </p>
      )}
      <OfflineButton showId={showId} />
    </section>
  )
}
