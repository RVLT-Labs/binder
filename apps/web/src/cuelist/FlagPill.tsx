import type { CueListFlag } from '@binder/core'
import { Badge } from '@/components/ui/badge'

/** The word each flag carries (colour is never alone): the mockups' lower-case pills. */
export const FLAG_TEXT: Record<CueListFlag, string> = {
  duplicate: 'duplicate',
  approximate: 'approx.',
  unresolved: 'unresolved',
  'older-version': 'older version',
}

/**
 * A flag as the mockups' pill (`pill warn` duplicate, `pill rep` approximate, red-soft unresolved).
 * It keeps `.badge[data-flag]`, the hook the e2e count the flags by.
 */
export function FlagPill({ flag }: { flag: CueListFlag }) {
  const look =
    flag === 'duplicate'
      ? { status: 'warn' as const }
      : flag === 'unresolved'
        ? { status: 'neutral' as const, className: 'bg-red-soft text-t-out' }
        : { status: 'neutral' as const }
  return (
    <Badge status={look.status} className={`badge ${look.className ?? ''}`.trim()} data-flag={flag}>
      {FLAG_TEXT[flag]}
    </Badge>
  )
}
