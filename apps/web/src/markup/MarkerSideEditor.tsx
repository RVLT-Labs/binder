import type {
  ConnectorPattern,
  ConnectorStyle,
  ConnectorWidth,
  CueSize,
  MarkerSide,
} from '@binder/shared'
import { usePowerSync, useQuery } from '@powersync/react'
import { Segmented } from '@/components/ui/segmented'
import { readConnectorStyle, withConnectorStyle } from './connectorStyleSettings'
import { readCueSize, withCueSize } from './cueSizeSettings'
import { readMarkerSide, withMarkerSide } from './markerSideSettings'
import { updateShowSettings } from './updateShowSettings'

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
      // Read and written in one transaction, so a settings change made elsewhere or a moment ago
      // is not overwritten.
      await updateShowSettings(db, showId, (current) => withMarkerSide(current, departmentId, side))
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
      // Read and written in one transaction, so a settings change made elsewhere or a moment ago
      // is not overwritten, and choosing a width keeps the pattern as it is now.
      await updateShowSettings(db, showId, (current) =>
        withConnectorStyle(current, departmentId, {
          ...readConnectorStyle(current, departmentId),
          ...change,
        }),
      )
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

const SIZES: Array<{ value: CueSize; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
]

export const SIZE_LABEL: Record<CueSize, string> = { normal: 'Normal', large: 'Large' }

/**
 * How big each department's cue bubbles (and the code and number in them) are drawn: normal, as
 * they have always been, or large. Stored in the show's settings like the marker sides, so the
 * owner picks and everyone reads; it applies on screen, in browser print and in the server export.
 */
export function useCueSizes(showId: string): {
  sizeOf: (departmentId: string) => CueSize
  setSize: (departmentId: string, size: CueSize) => Promise<void>
} {
  const db = usePowerSync()
  const { data } = useQuery<{ settings: string | null }>(
    'SELECT settings FROM shows WHERE id = ?',
    [showId],
  )
  const settings = data[0]?.settings ?? null
  return {
    sizeOf: (departmentId) => readCueSize(settings, departmentId),
    async setSize(departmentId, size) {
      // Read and written in one transaction against the latest local settings, so a change made a
      // moment ago in this browser (or already synced here) is kept. The whole settings object is
      // uploaded, as for every show setting: a change another device makes while this one is
      // offline can be replaced when this one's write goes up.
      await updateShowSettings(db, showId, (current) => withCueSize(current, departmentId, size))
    },
  }
}

/** One department's Normal / Large control (the departments table's "Cue size"). */
export function CueSizeControl({
  code,
  size,
  onChange,
  className,
}: {
  code: string
  size: CueSize
  onChange: (size: CueSize) => void
  className?: string
}) {
  return (
    <Segmented
      aria-label={`${code} cue size`}
      value={size}
      onValueChange={(v) => onChange(v as CueSize)}
      options={SIZES}
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
