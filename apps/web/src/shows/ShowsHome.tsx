import type { ShowLastChange, ShowPresence } from '@binder/shared'
import type { MouseEvent } from 'react'
import { SectionHeading } from '@/components/SectionHeading'
import { Button } from '@/components/ui/button'
import type { ShowRow } from '../powersync/schema'
import type { StackPerson } from '../presence/Avatars'
import { ShowCard } from './ShowCard'
import type { ShowSummary } from './useShowSummaries'

export interface ShowsHomeProps {
  shows: ShowRow[]
  loading: boolean
  /** Cues per show id, once counted (a show with none has no entry); undefined until then. */
  cueCounts?: Record<string, number>
  /** "Good evening, Jayden." */
  greeting: string
  /** The organisation's name, the over-label above the greeting; left off until known. */
  orgName?: string
  /** Per show id: its documents with their current version, and the items waiting for review. */
  summaries?: ReadonlyMap<string, ShowSummary>
  /**
   * What the server says about each show: who is in it and its newest change. Both are left off
   * offline and until the first answer, when the cards use their local fallback.
   */
  pulse?: {
    presence?: Readonly<Record<string, ShowPresence>>
    lastChanges?: Readonly<Record<string, ShowLastChange | null>>
  }
  /** Per show id, when it last changed on this device; the fallback's time. */
  localActivity?: ReadonlyMap<string, string>
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

/** A person from the presence summary as an avatar: the department scope joins the name in the tooltip. */
const stackPerson = (p: ShowPresence['people'][number]): StackPerson => ({
  userId: p.userId,
  name: p.name,
  colour: p.colour,
  detail: p.departments.length > 0 ? p.departments.join(', ') : undefined,
})

/**
 * The shows home (DESIGN §6): a greeting, the active shows as cards, the archived ones beneath as
 * dashed, muted cards. With no active show it is one Kalam line and a way to start one.
 */
export function ShowsHome({
  shows,
  loading,
  cueCounts,
  greeting,
  orgName,
  summaries,
  pulse,
  localActivity,
  now,
  onNewShow,
  onRename,
}: ShowsHomeProps) {
  const active = shows.filter((s) => s.status !== 'archived')
  const archived = shows.filter((s) => s.status === 'archived')

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col">
      <header className="mb-[22px]">
        {/* The top bar's crumb says "Shows" in words; this is the page's name for everything else. */}
        <h1 className="sr-only">Shows</h1>
        {orgName && <p className="t-over">{orgName}</p>}
        <p className="font-display text-[24px] font-extrabold leading-[1.15] tracking-[-.025em] text-ink md:text-[30px]">
          {greeting}
        </p>
        {!loading && (
          <p className="mt-1 text-[13.5px] text-muted">
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
        <div className="flex flex-col gap-[26px]">
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
                    documents={summaries?.get(show.id)?.documents}
                    toReview={summaries?.get(show.id)?.toReview}
                    inNow={pulse?.presence?.[show.id]?.people.map(stackPerson)}
                    lastChange={pulse?.lastChanges?.[show.id]}
                    localActivityAt={localActivity?.get(show.id)}
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
                    documents={summaries?.get(show.id)?.documents}
                    toReview={summaries?.get(show.id)?.toReview}
                    now={now}
                    onRename={(title) => onRename(show.id, title)}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
