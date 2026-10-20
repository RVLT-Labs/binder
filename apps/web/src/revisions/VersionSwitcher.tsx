import { Link } from '@tanstack/react-router'
import { ChevronDownIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { cn, focusRing } from '@/lib/utils'
import type { DocumentVersionRow } from '../powersync/schema'
import { LOCAL_ANCHORS_ONLY, versionReadOnlyReason } from './versionView'

export interface VersionSwitcherProps {
  showId: string
  docId: string
  versions: readonly DocumentVersionRow[]
  /** The document's current version, or null while it has none. */
  currentId: string | null
  selectedId: string
  /** The older version is drawn from this device's rows alone (offline, or the server cannot say). */
  localOnly: boolean
  onSelect: (versionId: string) => void
}

/** The versions to compare when the switcher's Compare link is followed. */
export function compareTarget(
  versions: readonly DocumentVersionRow[],
  currentId: string | null,
  selectedId: string,
): { from: string; to: string } | null {
  const sorted = [...versions].sort((a, b) => (a.version_number ?? 0) - (b.version_number ?? 0))
  const current = sorted.find((v) => v.id === (currentId ?? selectedId)) ?? sorted.at(-1)
  if (!current) return null
  if (selectedId !== current.id) return { from: selectedId, to: current.id }
  const before = sorted
    .filter((v) => (v.version_number ?? 0) < (current.version_number ?? 0))
    .at(-1)
  return before ? { from: before.id, to: current.id } : null
}

/**
 * Picks the version on screen. Any version can be looked at; one that is not the document's current
 * version is read-only, and the switcher says so. The Compare link opens the two versions side by side.
 *
 * `chip` (the top bar) is the mockup's `pill rep` "v2": a 20 px warm-grey pill that shows only the
 * version number. It is still the platform's `<select>`: laid transparently over the pill, so the
 * picker lists every version in full ("v2 · ready (current)") and e2e selects by option, while what
 * is drawn is the short form. `field` (the phone's menu) is the select drawn as a field.
 */
export function VersionSwitcher({
  showId,
  docId,
  versions,
  currentId,
  selectedId,
  localOnly,
  onSelect,
  display = 'chip',
}: VersionSwitcherProps & { display?: 'chip' | 'field' }) {
  const selected = versions.find((v) => v.id === selectedId)
  const isCurrent = !currentId || selectedId === currentId
  const compare = compareTarget(versions, currentId, selectedId)
  const chip = display === 'chip'
  const options = versions.map((x) => (
    <option key={x.id} value={x.id}>
      v{x.version_number} · {x.status}
      {x.label ? ` · ${x.label}` : ''}
      {x.id === currentId ? ' (current)' : ''}
    </option>
  ))
  return (
    <div className="version-switcher flex min-w-0 items-center gap-2">
      {chip ? (
        <div
          className={cn(
            'relative inline-flex h-5 shrink-0 items-center rounded-full bg-rep-soft px-2 text-[11px] leading-none font-semibold text-rep',
            'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-red has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-paper',
          )}
        >
          <span aria-hidden className="flex items-center gap-1">
            v{selected?.version_number ?? '?'}
            {/* only a document with another version has anything to switch to */}
            {versions.length > 1 && <ChevronDownIcon className="size-2.5" strokeWidth={2.4} />}
          </span>
          <select
            aria-label="Version"
            value={selectedId}
            onChange={(e) => onSelect(e.target.value)}
            // laid over the pill, with a 44 px tall hit area, and drawn by the pill under it
            className="absolute inset-x-0 top-1/2 h-11 w-full -translate-y-1/2 cursor-pointer appearance-none opacity-0 focus-visible:outline-none"
          >
            {options}
          </select>
        </div>
      ) : (
        // A native select dressed as a field: the platform picker, and option text to select by.
        <div className="relative min-w-0 flex-1">
          <select
            aria-label="Version"
            value={selectedId}
            onChange={(e) => onSelect(e.target.value)}
            className={cn(
              'h-11 w-full max-w-full appearance-none truncate rounded-[12px] border-2 border-input bg-card pr-9 pl-3 font-mono text-[14px] text-ink',
              focusRing,
            )}
          >
            {options}
          </select>
          <ChevronDownIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted"
          />
        </div>
      )}
      {selected && !isCurrent && (
        <>
          <span
            className="version-readonly inline-flex h-5 min-w-0 items-center truncate rounded-full bg-warn-soft px-2 text-[11px] font-semibold text-warn"
            role="status"
          >
            {versionReadOnlyReason(selected.version_number ?? 0)}
          </span>
          {currentId && (
            <Button type="button" variant="line" size="sm" onClick={() => onSelect(currentId)}>
              Back to current
            </Button>
          )}
          {localOnly && (
            <span className="min-w-0 truncate text-[12px] text-muted" role="status">
              {LOCAL_ANCHORS_ONLY}
            </span>
          )}
        </>
      )}
      {compare && (
        <Link
          to="/shows/$showId/docs/$docId/compare"
          params={{ showId, docId }}
          search={compare}
          className={cn(
            'flex h-11 items-center rounded-full px-2 text-[12px] font-semibold text-ink-2 hover:text-ink md:h-8',
            // On the top bar at tablet width there is no room beside Print, undo and the panel
            // toggles: Compare stays on the Documents list and the overview.
            chip && 'md:max-[1024px]:hidden',
            focusRing,
          )}
        >
          Compare
        </Link>
      )}
    </div>
  )
}
