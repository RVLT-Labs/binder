import type { PaperSize } from '@binder/shared'
import { usePowerSync, useQuery } from '@powersync/react'
import { useId } from 'react'
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
    <section aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>Cue sheet paper</h2>
      <p>The paper cue sheet PDFs are laid out for.</p>
      {editable ? (
        <select
          aria-label="Paper size"
          value={size}
          onChange={(e) => void save(e.target.value as PaperSize)}
        >
          {SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      ) : (
        <p>{SIZES.find((s) => s.value === size)?.label}</p>
      )}
    </section>
  )
}
