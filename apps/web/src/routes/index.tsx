import { usePowerSync, useQuery as usePowerSyncQuery } from '@powersync/react'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ShowRow } from '../powersync/schema'
import { AppShell } from '../shell/AppShell'
import { useAccount } from '../shell/useAccount'
import { firstName, greeting } from '../shows/greeting'
import { NewShowDialog } from '../shows/NewShowDialog'
import { ShowsHome } from '../shows/ShowsHome'

export const Route = createFileRoute('/')({ component: HomePage })

function HomePage() {
  const db = usePowerSync()
  const account = useAccount()
  const { data: shows, isLoading } = usePowerSyncQuery<ShowRow>(
    'SELECT * FROM shows ORDER BY title',
  )
  // Cues per show, counted on this device: shows that are not synced yet simply have no count.
  const { data: counts, isLoading: counting } = usePowerSyncQuery<{ show_id: string; n: number }>(
    'SELECT show_id, count(*) AS n FROM cues GROUP BY show_id',
  )
  const cueCounts = useMemo(
    () => (counting ? undefined : Object.fromEntries(counts.map((c) => [c.show_id, c.n]))),
    [counts, counting],
  )
  // The control that opened the dialog, so focus can go back to it.
  const [opener, setOpener] = useState<HTMLElement | null>(null)

  return (
    <AppShell
      crumbs={[{ label: 'Shows' }]}
      account={account}
      primary={
        <Button
          type="button"
          size="sm"
          className="max-md:mx-2"
          onClick={(e) => setOpener(e.currentTarget)}
        >
          New show
        </Button>
      }
    >
      <ShowsHome
        shows={shows}
        loading={isLoading}
        cueCounts={cueCounts}
        greeting={greeting(new Date(), firstName(account.name, account.email))}
        onNewShow={setOpener}
        // Local write first; PowerSync queues it and uploads when online.
        onRename={async (showId, title) => {
          await db.execute('UPDATE shows SET title = ? WHERE id = ?', [title, showId])
        }}
      />
      {opener && <NewShowDialog returnFocusTo={opener} onClose={() => setOpener(null)} />}
    </AppShell>
  )
}
