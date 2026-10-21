import { usePowerSync, useQuery } from '@powersync/react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SECTION_LABEL } from '../panel/fields'
import { useConfirm } from '../shell/useConfirm'
import { reactivateShow } from '../shows/reactivateShow'
import { CARD } from './parts'

/**
 * Archive this show (owner only): it becomes read-only for everyone while exports still work and
 * nothing is deleted. The change is the same local show write the settings editors use, so it syncs
 * up and the server applies it only for an owner. An archived show offers the way back.
 */
export function ArchiveCard({ showId }: { showId: string }) {
  const db = usePowerSync()
  const { data } = useQuery<{ status: string | null; title: string | null }>(
    'SELECT status, title FROM shows WHERE id = ?',
    [showId],
  )
  const show = data[0]
  const archived = show?.status === 'archived'
  const [error, setError] = useState<string | null>(null)
  const { confirm, dialog } = useConfirm('Archive this show?', 'Archive show')

  async function write(change: () => Promise<unknown>) {
    setError(null)
    try {
      await change()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <section aria-labelledby="archive-heading" className="flex flex-col gap-2">
      <h2 id="archive-heading" className={SECTION_LABEL}>
        Archive
      </h2>
      <div className={cn(CARD, 'flex items-center gap-5 py-3.5 pr-3 pl-3.5 md:px-[18px]')}>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 mb-[3px] text-[15px] font-bold text-ink md:mb-0.5 md:text-[14.5px]">
            {archived ? 'This show is archived' : 'Archive this show'}
          </h3>
          <p className="m-0 text-[12.5px] leading-[1.45] text-muted">
            <span className="md:hidden">Read-only for everyone. Exports still work.</span>
            <span className="max-md:hidden">
              {archived
                ? 'It is read-only for everyone. Exports still work and nothing is deleted.'
                : 'It becomes read-only for everyone. Exports still work and nothing is deleted.'}
            </span>
          </p>
        </div>
        <Button
          type="button"
          variant="line"
          className="shrink-0"
          onClick={async () => {
            if (archived) return write(() => reactivateShow(db, showId))
            const title = show?.title ? `“${show.title}”` : 'This show'
            if (
              await confirm(
                `${title} becomes read-only for everyone. Exports still work and nothing is deleted. You can unarchive it here later.`,
              )
            )
              await write(() =>
                db.execute('UPDATE shows SET status = ? WHERE id = ?', ['archived', showId]),
              )
          }}
        >
          {archived ? 'Unarchive show' : 'Archive show'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="m-0 text-[12px] text-ink-2">
          {error}
        </p>
      )}
      {dialog}
    </section>
  )
}
