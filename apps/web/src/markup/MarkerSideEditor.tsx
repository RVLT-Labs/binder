import type { MarkerSide } from '@binder/shared'
import { usePowerSync, useQuery } from '@powersync/react'
import { useId } from 'react'
import { readMarkerSide, withMarkerSide } from './markerSideSettings'
import { useDepartments } from './useDepartments'

const SIDES: Array<{ value: MarkerSide; label: string }> = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
]

/**
 * Which page margin each department's cue tags sit in, so lighting can be on the left and sound on
 * the right of the same page. The owner picks; the choice is saved in the show's settings through
 * the same local write every show edit uses, which syncs up (the server accepts it from the owner
 * only). Everyone else reads it. Hidden departments are not listed: their cues are not drawn.
 */
export function MarkerSideEditor({ showId, editable }: { showId: string; editable: boolean }) {
  const db = usePowerSync()
  const departments = useDepartments(showId).filter((d) => !d.hidden)
  const { data } = useQuery<{ settings: string | null }>(
    'SELECT settings FROM shows WHERE id = ?',
    [showId],
  )
  const settings = data[0]?.settings ?? null
  const ids = useId()

  async function save(departmentId: string, side: MarkerSide) {
    // Read just before writing so a settings change made elsewhere is not overwritten.
    const latest = await db.getOptional<{ settings: string | null }>(
      'SELECT settings FROM shows WHERE id = ?',
      [showId],
    )
    await db.execute('UPDATE shows SET settings = ? WHERE id = ?', [
      withMarkerSide(latest?.settings ?? settings, departmentId, side),
      showId,
    ])
  }

  return (
    <section aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>Cue tag sides</h2>
      <p>
        The page margin each department’s cue tags sit in, on screen and in print. A cue’s trigger
        words are highlighted and joined to its tag.
      </p>
      {editable ? (
        <div className="settings-list">
          {departments.map((d) => {
            const side = readMarkerSide(settings, d.id)
            return (
              <fieldset key={d.id} className="scope">
                <legend>{d.code}</legend>
                {SIDES.map((s) => (
                  <label key={s.value}>
                    <input
                      type="radio"
                      name={`${ids}-${d.id}`}
                      checked={side === s.value}
                      onChange={() => void save(d.id, s.value)}
                    />{' '}
                    {s.label}
                  </label>
                ))}
              </fieldset>
            )
          })}
        </div>
      ) : (
        <ul aria-label="Tag sides" className="settings-list">
          {departments.map((d) => (
            <li key={d.id}>
              {d.code}: {readMarkerSide(settings, d.id)}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
