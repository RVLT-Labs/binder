import { usePowerSync } from '@powersync/react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { reactivateShow } from '../shows/reactivateShow'

/**
 * The top of an archived show's page (DESIGN §8): the show is read-only for everyone, exports still
 * work, and the way back. An owner gets Reactivate, which is the same local write the cards on the
 * shows home and the Archive card in settings make; everyone else is told whom to ask. `userRole` is
 * `null` until the membership has synced, when the sentence about asking waits rather than guess.
 */
export function ArchivedBanner({
  showId,
  userRole,
  className,
}: {
  showId: string
  userRole: string | null
  className?: string
}) {
  const db = usePowerSync()
  const [error, setError] = useState<string | null>(null)

  async function reactivate() {
    setError(null)
    try {
      await reactivateShow(db, showId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <section
      aria-label="Archived show"
      className={cn(
        'flex flex-col gap-2 rounded-[var(--r)] border-2 border-dashed border-line-2 bg-card px-3.5 py-3 md:px-[18px]',
        className,
      )}
    >
      <div className="flex items-center gap-4 max-md:flex-col max-md:items-start max-md:gap-2">
        <div className="min-w-0 flex-1">
          <p className="m-0 mb-[3px] text-[15px] font-bold text-ink md:mb-0.5 md:text-[14.5px]">
            This show is archived
          </p>
          <p className="m-0 text-[12.5px] leading-[1.45] text-muted">
            Read-only for everyone. Exports still work and nothing is deleted.
            {userRole === 'owner' && ' Reactivate it to edit again.'}
            {userRole && userRole !== 'owner' && ' Ask an owner to reactivate it.'}
          </p>
        </div>
        {userRole === 'owner' && (
          <Button type="button" variant="line" className="shrink-0" onClick={reactivate}>
            Reactivate show
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="m-0 text-[12px] text-ink-2">
          {error}
        </p>
      )}
    </section>
  )
}
