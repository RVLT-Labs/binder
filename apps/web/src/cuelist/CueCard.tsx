import type { CueListRow } from '@binder/core'
import { cn } from '@/lib/utils'
import { FlagPill } from './FlagPill'

export interface CueCardProps {
  cue: CueListRow
  selected: boolean
  onSelect: () => void
}

/**
 * One cue on a phone (the `m-cues` mockup's `.mb-cue`): the number big and mono on the left with
 * its type under it, the label and "p.N · trigger" beside it, and its flags at the right. The
 * whole card is a button (58 px or taller); the selected one has the red outline and a faint red
 * wash. Cards do not edit: tapping one opens the panel, which has the fields.
 */
export function CueCard({ cue, selected, onSelect }: CueCardProps) {
  return (
    <button
      type="button"
      data-cue-id={cue.id}
      aria-pressed={selected}
      aria-label={`${cue.display} ${cue.label || 'no label'}`}
      onClick={onSelect}
      className={cn(
        'grid min-h-[58px] w-full grid-cols-[64px_1fr_auto] items-center gap-x-2 rounded-[14px] border-2 bg-card py-1.5 pr-3 pl-3.5 text-left shadow-card',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
        selected ? 'border-red bg-[color-mix(in_srgb,var(--red)_9%,var(--card))]' : 'border-line-2',
      )}
    >
      <span className="block">
        <span className="block font-mono text-[22px] font-semibold leading-[1.1] tabular-nums text-ink">
          {cue.display}
        </span>
        <span className="mt-px block font-mono text-[11px] leading-[1.2] text-faint">
          {cue.type}
        </span>
      </span>
      <span className="block min-w-0">
        <span className="block truncate text-[15px] font-semibold leading-[1.3] text-ink">
          {cue.label || <span className="text-faint">—</span>}
        </span>
        <span className="cue-trigger block truncate font-mono text-[11.5px] leading-[1.4] text-ink-2">
          <span className="text-faint">{cue.page}</span>
          {cue.trigger && ` · ${cue.trigger}`}
        </span>
      </span>
      {cue.flags.length > 0 ? (
        <span className="flex flex-col items-end gap-1">
          {cue.flags.map((flag) => (
            <FlagPill key={flag} flag={flag} />
          ))}
        </span>
      ) : (
        <span />
      )}
    </button>
  )
}

/** The phone's list of cards: a list of buttons, 6 px apart. */
export function CueCardList({
  rows,
  selectedId,
  onSelect,
}: {
  rows: CueListRow[]
  selectedId: string | null
  onSelect: (row: CueListRow) => void
}) {
  return (
    <ul aria-label="Cues" className="m-0 flex list-none flex-col gap-1.5 p-0">
      {rows.map((row) => (
        <li key={row.id}>
          <CueCard cue={row} selected={row.id === selectedId} onSelect={() => onSelect(row)} />
        </li>
      ))}
    </ul>
  )
}
