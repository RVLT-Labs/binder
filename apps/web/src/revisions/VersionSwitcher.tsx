import { Link } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
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
 */
export function VersionSwitcher({
  showId,
  docId,
  versions,
  currentId,
  selectedId,
  localOnly,
  onSelect,
}: VersionSwitcherProps) {
  const selected = versions.find((v) => v.id === selectedId)
  const isCurrent = !currentId || selectedId === currentId
  const compare = compareTarget(versions, currentId, selectedId)
  return (
    <div className="version-switcher flex min-w-0 items-center gap-2">
      {/* A native select dressed as the version chip: the platform picker, and option text to select by. */}
      <div className="relative min-w-0">
        <select
          aria-label="Version"
          value={selectedId}
          onChange={(e) => onSelect(e.target.value)}
          className={cn(
            'h-11 max-w-full appearance-none truncate rounded-full border-2 border-line-2 bg-card pr-8 pl-3.5 font-mono text-[12px] text-ink md:h-8',
            focusRing,
          )}
        >
          {versions.map((x) => (
            <option key={x.id} value={x.id}>
              v{x.version_number} · {x.status}
              {x.label ? ` · ${x.label}` : ''}
              {x.id === currentId ? ' (current)' : ''}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted"
        />
      </div>
      {selected && !isCurrent && (
        <>
          <span
            className="version-readonly min-w-0 truncate rounded-full bg-warn-soft px-2.5 py-0.5 text-[12px] font-semibold text-warn"
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
            'flex h-11 items-center rounded-full px-2 text-[13px] font-semibold text-ink-2 hover:text-ink md:h-8',
            focusRing,
          )}
        >
          Compare
        </Link>
      )}
    </div>
  )
}
