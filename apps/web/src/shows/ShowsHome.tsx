import type { MouseEvent } from 'react'
import { SectionHeading } from '@/components/SectionHeading'
import { Button } from '@/components/ui/button'
import type { ShowRow } from '../powersync/schema'
import { ShowCard } from './ShowCard'

export interface ShowsHomeProps {
  shows: ShowRow[]
  loading: boolean
  /** Cues per show id, once counted (a show with none has no entry); undefined until then. */
  cueCounts?: Record<string, number>
  /** "Good evening, Jayden." */
  greeting: string
  now?: Date
  /** Start a new show; gets the button that was pressed, so focus can come back to it. */
  onNewShow: (opener: HTMLElement) => void
  onRename: (showId: string, title: string) => void | Promise<void>
}

/**
 * Three columns at desktop (above 1024), two at tablet, one on a phone. The tablet and desktop
 * rules exclude each other: Tailwind sorts arbitrary-width variants before `md:`, so a plain
 * `md:grid-cols-2` would win over `min-[1025px]:grid-cols-3`.
 */
const GRID = 'grid grid-cols-1 gap-4 md:max-[1024px]:grid-cols-2 min-[1025px]:grid-cols-3'

/**
 * The shows home (DESIGN §6): a greeting, the active shows as cards, the archived ones beneath as
 * dashed, muted cards. With no active show it is one Kalam line and a way to start one.
 */
export function ShowsHome({
  shows,
  loading,
  cueCounts,
  greeting,
  now,
  onNewShow,
  onRename,
}: ShowsHomeProps) {
  const active = shows.filter((s) => s.status !== 'archived')
  const archived = shows.filter((s) => s.status === 'archived')

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
      <header>
        {/* The top bar's crumb says "Shows" in words; this is the page's name for everything else. */}
        <h1 className="sr-only">Shows</h1>
        <p className="font-display text-[28px] font-extrabold leading-tight text-ink md:text-[32px]">
          {greeting}
        </p>
        {!loading && (
          <p className="mt-1 text-[14px] text-muted">
            <span className="font-mono tabular-nums">{active.length}</span>{' '}
            {active.length === 1 ? 'active show' : 'active shows'}
            {archived.length > 0 && (
              <>
                {' · '}
                <span className="font-mono tabular-nums">{archived.length}</span> archived
              </>
            )}
          </p>
        )}
      </header>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <SectionHeading>Active</SectionHeading>
            {active.length === 0 ? (
              <div className="flex flex-col items-start gap-4 rounded-[20px] border-2 border-dashed border-line-2 p-6">
                <p className="font-hand text-[20px] leading-snug text-ink-2">
                  the quiet before the pad comes in
                </p>
                <Button
                  type="button"
                  variant="line"
                  onClick={(e: MouseEvent<HTMLButtonElement>) => onNewShow(e.currentTarget)}
                >
                  Start a show
                </Button>
              </div>
            ) : (
              <ul aria-label="Active shows" className={GRID}>
                {active.map((show) => (
                  <ShowCard
                    key={show.id}
                    show={show}
                    cueCount={cueCounts ? (cueCounts[show.id] ?? 0) : undefined}
                    now={now}
                    onRename={(title) => onRename(show.id, title)}
                  />
                ))}
              </ul>
            )}
          </section>

          {archived.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeading>Archived</SectionHeading>
              <ul aria-label="Archived shows" className={GRID}>
                {archived.map((show) => (
                  <ShowCard
                    key={show.id}
                    show={show}
                    cueCount={cueCounts ? (cueCounts[show.id] ?? 0) : undefined}
                    now={now}
                    onRename={(title) => onRename(show.id, title)}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
