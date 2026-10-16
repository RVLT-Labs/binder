import { useQuery } from '@powersync/react'
import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import { SectionHeading } from '@/components/SectionHeading'
import { cn, focusRing } from '@/lib/utils'
import { duplicateStats } from '../cuelist/duplicates'
import { DocumentRows } from '../documents/DocumentList'
import { useDocumentEntries } from '../documents/useDocumentEntries'
import { useDepartments } from '../markup/useDepartments'
import { useMembership } from '../markup/useMembership'
import type { ShowRow } from '../powersync/schema'
import { BinderPresence } from '../presence/Avatars'
import { DepartmentCards } from './DepartmentCards'
import { NeedsYou } from './NeedsYou'
import { OfflineCard } from './OfflineCard'
import { RecentActivity } from './RecentActivity'

const CUE_NUMBERS_SQL = 'SELECT id, department_id, major, minor FROM cues WHERE show_id = ?'

// Desktop is above 1024 (Tailwind's `lg` starts at 1024, which is tablet), so the two columns start
// at 1025. Class names are written out whole: Tailwind finds them by scanning the source text.

const FOOTER_LINK = cn(
  'rounded-sm text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline',
  focusRing,
)

/**
 * The show's page (DESIGN §6): what needs a decision, the scripts, the cue lists by department and
 * the latest changes, with who is in the binder, the offline copy and the settings links beside
 * them.
 *
 * The page is in one reading order at every width: Needs you, Scripts, Cue lists, Recent activity,
 * In the binder now, Offline, the settings links. Below 1025 px that is the column. Above it, grid
 * placement (not `order`, which would leave the tab order behind) puts Needs you at the head of the
 * right column, with In the binder now, Offline and the links under it, and the rest in the main
 * column. The phone leaves the activity to its tab and the settings links to More.
 */
export function ShowOverview({ showId }: { showId: string }) {
  const { data: shows } = useQuery<Pick<ShowRow, 'title'>>('SELECT title FROM shows WHERE id = ?', [
    showId,
  ])
  const departments = useDepartments(showId)
  const membership = useMembership(showId)
  const documents = useDocumentEntries(showId)
  const { data: cues } = useQuery<{
    id: string
    department_id: string
    major: number
    minor: number
  }>(CUE_NUMBERS_SQL, [showId])

  const { cards, duplicateNotes } = useMemo(() => {
    const stats = duplicateStats(
      cues.map((c) => ({
        id: c.id,
        departmentId: c.department_id,
        major: Number(c.major),
        minor: Number(c.minor),
      })),
    )
    const counts = new Map<string, number>()
    for (const c of cues) counts.set(c.department_id, (counts.get(c.department_id) ?? 0) + 1)
    const visible = departments.filter((d) => !d.hidden)
    return {
      cards: visible.map((d) => ({
        id: d.id,
        code: d.code ?? '',
        colour: d.colour,
        count: counts.get(d.id) ?? 0,
        duplicateNumbers: stats.get(d.id)?.numbers ?? 0,
      })),
      duplicateNotes: visible
        .filter((d) => stats.has(d.id))
        .map((d) => ({
          departmentId: d.id,
          code: d.code ?? '',
          numbers: stats.get(d.id)?.numbers ?? 0,
        })),
    }
  }, [cues, departments])

  // Cues and notes waiting after a revision, across documents, and the first document to go to.
  const review = useMemo(() => {
    let count = 0
    let documentId: string | null = null
    for (const entry of documents.entries) {
      if (entry.kind !== 'ready') continue
      const n = documents.reviewCounts.get(entry.docId) ?? 0
      if (n === 0) continue
      count += n
      documentId ??= entry.docId
    }
    return documentId ? { count, documentId } : null
  }, [documents.entries, documents.reviewCounts])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 min-[1025px]:grid min-[1025px]:grid-cols-[minmax(0,1fr)_20rem] min-[1025px]:grid-rows-[auto_1fr] min-[1025px]:items-start min-[1025px]:gap-x-8">
      <h1 className="sr-only">{shows[0]?.title}</h1>

      <div className="empty:hidden min-[1025px]:col-start-2">
        <NeedsYou showId={showId} review={review} duplicates={duplicateNotes} />
      </div>

      <div className="flex flex-col gap-6 min-[1025px]:col-start-1 min-[1025px]:row-span-2 min-[1025px]:row-start-1">
        <section aria-labelledby="scripts-heading" className="flex flex-col gap-3">
          <SectionHeading id="scripts-heading">Scripts</SectionHeading>
          {documents.loading ? (
            <p className="m-0 text-muted">Loading…</p>
          ) : documents.entries.length === 0 ? (
            <p className="m-0 text-[14px] text-muted">
              No documents yet. Upload a PDF to start the binder.
            </p>
          ) : (
            <DocumentRows showId={showId} data={documents} compact />
          )}
        </section>

        <DepartmentCards
          showId={showId}
          departments={cards}
          canAdd={membership?.role === 'owner'}
        />

        <RecentActivity showId={showId} className="max-md:hidden" />
      </div>

      <div className="flex flex-col gap-6 min-[1025px]:col-start-2">
        <div className="empty:hidden">
          <BinderPresence showId={showId} />
        </div>
        <OfflineCard showId={showId} />
        <nav
          aria-label="Settings and members"
          className="flex flex-wrap gap-x-4 gap-y-1 px-1 max-md:hidden"
        >
          <Link to="/shows/$showId/settings" params={{ showId }} className={FOOTER_LINK}>
            Settings
          </Link>
          <Link
            to="/shows/$showId/settings"
            params={{ showId }}
            hash="members"
            className={FOOTER_LINK}
          >
            Members
          </Link>
          <Link to="/settings/tokens" className={FOOTER_LINK}>
            Tokens
          </Link>
        </nav>
      </div>
    </div>
  )
}
