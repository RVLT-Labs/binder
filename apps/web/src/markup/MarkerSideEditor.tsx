import type { ConnectorPattern, ConnectorStyle, ConnectorWidth, MarkerSide } from '@binder/shared'
import { usePowerSync, useQuery } from '@powersync/react'
import { Segmented } from '@/components/ui/segmented'
import { readConnectorStyle, withConnectorStyle } from './connectorStyleSettings'
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

const WIDTHS: Array<{ value: ConnectorWidth; label: string }> = [
  { value: 'thin', label: 'Thin' },
  { value: 'medium', label: 'Medium' },
  { value: 'bold', label: 'Bold' },
]
const PATTERNS: Array<{ value: ConnectorPattern; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
]

export const WIDTH_LABEL: Record<ConnectorWidth, string> = {
  thin: 'Thin',
  medium: 'Medium',
  bold: 'Bold',
}
export const PATTERN_LABEL: Record<ConnectorPattern, string> = {
  solid: 'Solid',
  dashed: 'Dashed',
  dotted: 'Dotted',
}

/**
 * How each department's connector (the line from a cue's bubble to its mark) is drawn: its weight
 * and its pattern. Stored in the show's settings like the marker sides, so the owner picks and
 * everyone reads; a department with no entry is thin and solid.
 */
export function useConnectorStyles(showId: string): {
  styleOf: (departmentId: string) => ConnectorStyle
  /** Sets the given parts of a department's style (the rest stay as they are now, not as rendered). */
  setStyle: (departmentId: string, change: Partial<ConnectorStyle>) => Promise<void>
} {
  const db = usePowerSync()
  const { data } = useQuery<{ settings: string | null }>(
    'SELECT settings FROM shows WHERE id = ?',
    [showId],
  )
  const settings = data[0]?.settings ?? null
  return {
    styleOf: (departmentId) => readConnectorStyle(settings, departmentId),
    async setStyle(departmentId, change) {
      // Read just before writing so a settings change made elsewhere is not overwritten, and
      // choosing a width keeps the pattern as it is now.
      const latest = await db.getOptional<{ settings: string | null }>(
        'SELECT settings FROM shows WHERE id = ?',
        [showId],
      )
      const text = latest?.settings ?? settings
      await db.execute('UPDATE shows SET settings = ? WHERE id = ?', [
        withConnectorStyle(text, departmentId, {
          ...readConnectorStyle(text, departmentId),
          ...change,
        }),
        showId,
      ])
    },
  }
}

/** One department's Thin / Medium / Bold control (the departments table's "Connector width"). */
export function ConnectorWidthControl({
  code,
  width,
  onChange,
  className,
}: {
  code: string
  width: ConnectorWidth
  onChange: (width: ConnectorWidth) => void
  className?: string
}) {
  return (
    <Segmented
      aria-label={`${code} connector width`}
      value={width}
      onValueChange={(v) => onChange(v as ConnectorWidth)}
      options={WIDTHS}
      className={className}
      itemClassName="flex-1 md:flex-none"
    />
  )
}

/** One department's Solid / Dashed / Dotted control (the departments table's "Connector pattern"). */
export function ConnectorPatternControl({
  code,
  pattern,
  onChange,
  className,
}: {
  code: string
  pattern: ConnectorPattern
  onChange: (pattern: ConnectorPattern) => void
  className?: string
}) {
  return (
    <Segmented
      aria-label={`${code} connector pattern`}
      value={pattern}
      onValueChange={(v) => onChange(v as ConnectorPattern)}
      options={PATTERNS}
      className={className}
      itemClassName="flex-1 md:flex-none"
    />
  )
}

/** A department's connector width and pattern controls together; each reports only what it changed. */
export function ConnectorStyleControls({
  code,
  style,
  onChange,
  className,
}: {
  code: string
  style: ConnectorStyle
  onChange: (change: Partial<ConnectorStyle>) => void
  className?: string
}) {
  return (
    <div className={className}>
      <ConnectorWidthControl
        code={code}
        width={style.width}
        onChange={(width) => onChange({ width })}
      />
      <ConnectorPatternControl
        code={code}
        pattern={style.pattern}
        onChange={(pattern) => onChange({ pattern })}
      />
    </div>
  )
}
