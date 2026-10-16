export interface StampPickerProps {
  /** The show's stamp set. */
  stamps: readonly string[]
  /** The chosen stamp; the first of the set while none is chosen or the choice has left the set. */
  value: string | null
  onChange: (stamp: string) => void
  disabled?: boolean
  className?: string
}

/** The stamp the stamp tool places: the chosen one when it is still in the set, else the first. */
export function chosenStamp(stamps: readonly string[], value: string | null): string | null {
  return value && stamps.includes(value) ? value : (stamps[0] ?? null)
}

/** Chooses which of the show's stamps the stamp tool places. */
export function StampPicker({ stamps, value, onChange, disabled, className }: StampPickerProps) {
  return (
    <select
      aria-label="Stamp"
      value={chosenStamp(stamps, value) ?? ''}
      disabled={disabled}
      className={className}
      onChange={(e) => onChange(e.target.value)}
    >
      {stamps.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  )
}
