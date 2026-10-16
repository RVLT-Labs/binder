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
const COLUMN = 'contents min-[1025px]:flex min-[1025px]:flex-col min-[1025px]:gap-6'

const FOOTER_LINK = cn(
  'rounded-sm text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline',
  focusRing,
)

/**
 * The show's page (DESIGN §6): what needs a decision, the scripts, the cue lists by department and
 * the latest changes, with who is in the binder, the offline copy and the settings links beside
 * them. At desktop it is a main column and a right column; at tablet and phone one column in the
 * order Needs you, Scripts, Cue lists, In the binder now, Offline (the phone leaves the activity
 * to its tab and the settings links to More).
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 min-[1025px]:grid min-[1025px]:grid-cols-[minmax(0,1fr)_20rem] min-[1025px]:items-start min-[1025px]:gap-8">
      <h1 className="sr-only">{shows[0]?.title}</h1>

      <div className={COLUMN}>
        <section aria-labelledby="scripts-heading" className="order-2 flex flex-col gap-3">
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

        <div className="order-3">
          <DepartmentCards
            showId={showId}
            departments={cards}
            canAdd={membership?.role === 'owner'}
          />
        </div>

        <RecentActivity showId={showId} className="order-4 max-md:hidden" />
      </div>

      <div className={COLUMN}>
        <div className="order-1 min-[1025px]:order-2 empty:hidden">
          <NeedsYou showId={showId} review={review} duplicates={duplicateNotes} />
        </div>
        <div className="order-5 min-[1025px]:order-1 empty:hidden">
          <BinderPresence showId={showId} />
        </div>
        <div className="order-6 min-[1025px]:order-3">
          <OfflineCard showId={showId} />
        </div>
        <nav
          aria-label="Settings and members"
          className="order-7 flex flex-wrap gap-x-4 gap-y-1 px-1 max-md:hidden min-[1025px]:order-4"
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
