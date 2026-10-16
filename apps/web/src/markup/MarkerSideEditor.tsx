import type { MarkerSide } from '@binder/shared'
import { usePowerSync, useQuery } from '@powersync/react'
import { Segmented } from '@/components/ui/segmented'
import { readMarkerSide, withMarkerSide } from './markerSideSettings'

const SIDES: Array<{ value: MarkerSide; label: string }> = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
]

export const SIDE_LABEL: Record<MarkerSide, string> = { left: 'Left', right: 'Right' }

/**
 * Which page margin each department's cue tags sit in, so lighting can be on the left and sound on
 * the right of the same page. The owner picks; the choice is saved in the show's settings through
 * the same local write every show edit uses, which syncs up (the server accepts it from the owner
 * only). Everyone else reads it.
 */
export function useMarkerSides(showId: string): {
  sideOf: (departmentId: string) => MarkerSide
  setSide: (departmentId: string, side: MarkerSide) => Promise<void>
} {
  const db = usePowerSync()
  const { data } = useQuery<{ settings: string | null }>(
    'SELECT settings FROM shows WHERE id = ?',
    [showId],
  )
  const settings = data[0]?.settings ?? null
  return {
    sideOf: (departmentId) => readMarkerSide(settings, departmentId),
    async setSide(departmentId, side) {
      // Read just before writing so a settings change made elsewhere is not overwritten.
      const latest = await db.getOptional<{ settings: string | null }>(
        'SELECT settings FROM shows WHERE id = ?',
        [showId],
      )
      await db.execute('UPDATE shows SET settings = ? WHERE id = ?', [
        withMarkerSide(latest?.settings ?? settings, departmentId, side),
        showId,
      ])
    },
  }
}

/** One department's Left / Right control (the departments table's "Marker side"). */
export function MarkerSideControl({
  code,
  side,
  onChange,
  className,
}: {
  code: string
  side: MarkerSide
  onChange: (side: MarkerSide) => void
  className?: string
}) {
  return (
    <Segmented
      aria-label={`${code} marker side`}
      value={side}
      onValueChange={(v) => onChange(v as MarkerSide)}
      options={SIDES}
      className={className}
      itemClassName="flex-1 md:flex-none"
    />
  )
}
