import { createFileRoute } from '@tanstack/react-router'
import { PaperSizeEditor } from '../exports/PaperSizeEditor'
import { StampSetEditor } from '../markup/StampSetEditor'
import { useDepartments } from '../markup/useDepartments'
import { useMembership } from '../markup/useMembership'
import { ArchiveCard } from '../settings/ArchiveCard'
import { DepartmentsSection } from '../settings/DepartmentsSection'
import { MembersSection } from '../settings/MembersSection'

export const Route = createFileRoute('/shows/$showId/settings')({ component: SettingsPage })

/**
 * Show settings: departments (colour, number format, marker side), members and roles, the stamp
 * set, the cue sheet paper and archiving. Only an owner can change them; everyone else reads.
 */
function SettingsPage() {
  const { showId } = Route.useParams()
  const membership = useMembership(showId)
  const departments = useDepartments(showId)
  const isOwner = membership?.role === 'owner'
  return (
    // The mockup's page padding is 18 32 and the shell's 28 32, so the top gives 10 back.
    <div className="flex w-full max-w-[936px] flex-col gap-[18px] md:-mt-2.5">
      <header className="flex items-baseline justify-between gap-4 max-md:flex-col max-md:gap-1">
        <h1 className="t-page-title m-0 max-md:sr-only">Show settings</h1>
        <p className="m-0 text-[13px] text-muted">Only the owner can change these.</p>
      </header>
      <DepartmentsSection showId={showId} departments={departments} editable={isOwner} />
      <MembersSection showId={showId} departments={departments} editable={isOwner} />
      <StampSetEditor showId={showId} editable={isOwner} />
      <PaperSizeEditor showId={showId} editable={isOwner} />
      {isOwner && <ArchiveCard showId={showId} />}
    </div>
  )
}
