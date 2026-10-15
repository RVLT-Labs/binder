import { Link } from '@tanstack/react-router'
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
    <div className="version-switcher">
      <select aria-label="Version" value={selectedId} onChange={(e) => onSelect(e.target.value)}>
        {versions.map((x) => (
          <option key={x.id} value={x.id}>
            v{x.version_number} · {x.status}
            {x.label ? ` · ${x.label}` : ''}
            {x.id === currentId ? ' (current)' : ''}
          </option>
        ))}
      </select>
      {selected && !isCurrent && (
        <>
          <span className="version-readonly" role="status">
            {versionReadOnlyReason(selected.version_number ?? 0)}
          </span>
          {currentId && (
            <button type="button" onClick={() => onSelect(currentId)}>
              Back to current
            </button>
          )}
          {localOnly && (
            <span className="muted" role="status">
              {LOCAL_ANCHORS_ONLY}
            </span>
          )}
        </>
      )}
      {compare && (
        <Link to="/shows/$showId/docs/$docId/compare" params={{ showId, docId }} search={compare}>
          Compare
        </Link>
      )}
    </div>
  )
}
