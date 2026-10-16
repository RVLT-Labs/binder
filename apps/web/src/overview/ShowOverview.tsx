import { DEFAULT_DEPARTMENTS } from '@binder/shared'
import { useQuery } from '@powersync/react'
import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import { SectionHeading } from '@/components/SectionHeading'
import { cn, focusRing } from '@/lib/utils'
import { duplicateStats } from '../cuelist/duplicates'
import { DocumentRows } from '../documents/DocumentList'
import type { DocumentEntry } from '../documents/documentEntries'
import { useDocumentEntries } from '../documents/useDocumentEntries'
import { useDepartments } from '../markup/useDepartments'
import { useMembership } from '../markup/useMembership'
import { OfflineAction, useOfflineCopy } from '../offline/OfflineButton'
import { useOfflineSummary } from '../offline/useOfflineSummary'
import type { ShowRow } from '../powersync/schema'
import { BinderPresence } from '../presence/Avatars'
import { TopBarActions } from '../shell/TopBarSlots'
import { DepartmentCards } from './DepartmentCards'
import { NeedsYou } from './NeedsYou'
import { OfflineCard } from './OfflineCard'
import { RecentActivity } from './RecentActivity'

const CUE_NUMBERS_SQL = 'SELECT id, department_id, major, minor FROM cues WHERE show_id = ?'

// Desktop is above 1024 (Tailwind's `lg` starts at 1024, which is tablet), so the two columns start
// at 1025. Class names are written out whole: Tailwind finds them by scanning the source text.

// The mockup's footer links: 12 px, muted, no underline.
const FOOTER_LINK = cn('rounded-sm text-[12px] text-muted hover:text-ink', focusRing)

/** "Libretto v1, v2": a document and the versions of it that are ready. */
function documentNames(entries: readonly DocumentEntry[]): string[] {
  return entries.flatMap((e) =>
    e.kind === 'ready'
      ? [
          `${e.title} ${[e.kept?.number, e.version.number]
            .filter((n) => n !== undefined)
            .map((n) => `v${n}`)
            .join(', ')}`,
        ]
      : [],
  )
}

/**
 * The show's page (DESIGN §6): what needs a decision, the scripts, the cue lists by department and
 * the latest changes, with who is in the binder, the offline copy and the settings links beside
 * them.
 *
 * The DOM follows the mockups at every width, so reading order and tab order are what is drawn.
 * Desktop (and the tablet's single column, which has no mockup of its own): Scripts, Cue lists,
 * Recent activity, then the right column: In the binder now, Needs you, Offline, the links. Above
 * 1025 px the right column is a second grid column. The phone is the other order, Needs you first
 * and then Scripts, Cue lists, In the binder now, Offline, so Needs you is rendered twice, once for
 * each arrangement, and the one that does not apply is `hidden` (out of the accessibility tree
 * too). Grid placement, never `order`.
 */
export function ShowOverview({ showId }: { showId: string }) {
  const { data: shows } = useQuery<Pick<ShowRow, 'title'>>('SELECT title FROM shows WHERE id = ?', [
    showId,
  ])
  const departments = useDepartments(showId)
  const membership = useMembership(showId)
  const documents = useDocumentEntries(showId)
  const offlineSummary = useOfflineSummary(showId)
  const offlineCopy = useOfflineCopy(showId)
  const { data: cues } = useQuery<{
    id: string
    department_id: string
    major: number
    minor: number
  }>(CUE_NUMBERS_SQL, [showId])

  const { cards, duplicateNotes, missing } = useMemo(() => {
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
    const have = new Set(departments.map((d) => d.code))
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
      // the default departments this show does not have (the add card lists them)
      missing: DEFAULT_DEPARTMENTS.map((d) => d.code).filter((code) => !have.has(code)),
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

  // A failed upload is not in the Scripts card, so it is one of the things that need you.
  const failed = documents.entries.filter((e) => e.kind === 'failed').length
  const ready = documents.entries.filter((e) => e.kind === 'ready').length
  const needs = { showId, review, duplicates: duplicateNotes, failed }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-[22px] max-md:gap-3 md:-my-1 min-[1025px]:grid min-[1025px]:grid-cols-[minmax(0,1fr)_340px] min-[1025px]:items-start min-[1025px]:gap-x-7">
      <h1 className="sr-only">{shows[0]?.title}</h1>

      <NeedsYou {...needs} variant="phone" className="md:hidden" />

      <div className="flex min-w-0 flex-col gap-[22px] min-[1025px]:col-start-1 min-[1025px]:row-start-1 max-md:gap-3">
        <section aria-labelledby="scripts-heading" className="flex flex-col gap-2.5">
          <SectionHeading id="scripts-heading">Scripts</SectionHeading>
          {documents.loading ? (
            <p className="m-0 text-muted">Loading…</p>
          ) : documents.entries.length === 0 ? (
            <p className="m-0 text-[14px] text-muted">
              No documents yet. Upload a PDF to start the binder.
            </p>
          ) : ready === 0 ? (
            <p className="m-0 text-[14px] text-muted">
              No script is ready yet.{' '}
              <Link
                to="/shows/$showId/docs"
                params={{ showId }}
                className={cn('rounded-sm text-ink-2 underline underline-offset-4', focusRing)}
              >
                Documents
              </Link>{' '}
              shows how the uploads are getting on.
            </p>
          ) : (
            <DocumentRows showId={showId} data={documents} compact />
          )}
        </section>

        <DepartmentCards
          showId={showId}
          departments={cards}
          canAdd={membership?.role === 'owner'}
          missing={missing}
        />

        <RecentActivity showId={showId} className="max-md:hidden" />
      </div>

      <div className="flex min-w-0 flex-col gap-4 max-md:gap-3 min-[1025px]:col-start-2 min-[1025px]:row-start-1">
        <BinderPresence showId={showId} />
        <NeedsYou {...needs} variant="aside" className="max-md:hidden" />
        <OfflineCard
          summary={offlineSummary}
          copy={offlineCopy}
          names={
            offlineSummary && offlineSummary.cached === offlineSummary.total
              ? documentNames(documents.entries)
              : undefined
          }
        />
        <nav
          aria-label="Settings and members"
          className="flex flex-wrap gap-x-3.5 gap-y-1 px-1 max-md:hidden"
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

      {/* The mockup's top bar has the offline button between the presence stack and Upload. */}
      <TopBarActions>
        <OfflineAction copy={offlineCopy} />
      </TopBarActions>
    </div>
  )
}
