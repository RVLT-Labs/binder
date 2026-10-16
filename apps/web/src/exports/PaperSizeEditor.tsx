import type { PaperSize } from '@binder/shared'
import { usePowerSync, useQuery } from '@powersync/react'
import { useId } from 'react'
import { cn } from '@/lib/utils'
import { SECTION_LABEL } from '../panel/fields'
import { SelectBox } from '../settings/parts'
import { readPaperSize, withPaperSize } from './paperSize'

const SIZES: Array<{ value: PaperSize; label: string }> = [
  { value: 'A4', label: 'A4 (210 × 297 mm)' },
  { value: 'Letter', label: 'Letter (8.5 × 11 in)' },
]

/**
 * The paper cue sheet PDFs are laid out for. The owner picks it; the choice is saved in the show's
 * settings through the same local write every show edit uses, which syncs up (the server accepts it
 * from the owner only). Everyone else reads it.
 */
export function PaperSizeEditor({ showId, editable }: { showId: string; editable: boolean }) {
  const db = usePowerSync()
  const { data } = useQuery<{ settings: string | null }>(
    'SELECT settings FROM shows WHERE id = ?',
    [showId],
  )
  const settings = data[0]?.settings ?? null
  const size = readPaperSize(settings)
  const ids = useId()

  async function save(next: PaperSize) {
    // Read just before writing so a settings change made elsewhere is not overwritten.
    const latest = await db.getOptional<{ settings: string | null }>(
      'SELECT settings FROM shows WHERE id = ?',
      [showId],
    )
    await db.execute('UPDATE shows SET settings = ? WHERE id = ?', [
      withPaperSize(latest?.settings ?? settings, next),
      showId,
    ])
  }

  return (
    <section aria-labelledby={`${ids}-heading`} className="flex flex-col gap-2">
      <h2 id={`${ids}-heading`} className={SECTION_LABEL}>
        Cue sheet paper
      </h2>
      {editable ? (
        <SelectBox
          aria-label="Paper size"
          value={size}
          onChange={(e) => void save(e.target.value as PaperSize)}
          className="w-full max-w-[260px]"
        >
          {SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </SelectBox>
      ) : (
        <p className={cn('m-0 text-[13px] text-ink')}>
          {SIZES.find((s) => s.value === size)?.label}
        </p>
      )}
      <p className="m-0 text-[12px] text-muted">The paper cue sheet PDFs are laid out for.</p>
    </section>
  )
}
