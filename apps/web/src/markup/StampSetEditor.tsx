import { usePowerSync, useQuery } from '@powersync/react'
import { useId, useState } from 'react'
import { CommitInput } from './CommitInput'
import { checkStampName, readStamps, STAMP_NAME_MAX, withStamps } from './stampSettings'

/**
 * The show's stamp set: what the stamp tool offers. The owner adds, renames and removes stamps; the
 * list is saved in the show's settings through the same local write every show edit uses, which
 * syncs up (the server accepts it from the owner only). Everyone else reads it.
 */
export function StampSetEditor({ showId, editable }: { showId: string; editable: boolean }) {
  const db = usePowerSync()
  const { data } = useQuery<{ settings: string | null }>(
    'SELECT settings FROM shows WHERE id = ?',
    [showId],
  )
  const settings = data[0]?.settings ?? null
  const stamps = readStamps(settings)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const ids = useId()

  async function save(next: string[]) {
    setError(null)
    // Read just before writing so a settings change made elsewhere is not overwritten.
    const latest = await db.getOptional<{ settings: string | null }>(
      'SELECT settings FROM shows WHERE id = ?',
      [showId],
    )
    await db.execute('UPDATE shows SET settings = ? WHERE id = ?', [
      withStamps(latest?.settings ?? settings, next),
      showId,
    ])
  }

  function rename(index: number, value: string) {
    const trimmed = value.trim()
    if (trimmed === stamps[index]) return
    const problem = checkStampName(
      trimmed,
      stamps.filter((_, i) => i !== index),
    )
    if (problem) return setError(problem)
    void save(stamps.map((s, i) => (i === index ? trimmed : s)))
  }

  function add() {
    const problem = checkStampName(name, stamps)
    if (problem) return setError(problem)
    void save([...stamps, name.trim()])
    setName('')
  }

  return (
    <section aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>Stamps</h2>
      <p>
        The stamps the stamp tool offers. Stamps already placed keep their text when one is renamed
        or removed.
      </p>
      <ul aria-label="Stamps" className="settings-list">
        {stamps.map((stamp, i) => (
          <li key={stamp}>
            {editable ? (
              <>
                <CommitInput
                  id={`${ids}-${i}`}
                  aria-label={`Stamp ${i + 1} name`}
                  value={stamp}
                  onCommit={(value) => rename(i, value)}
                  onCancel={() => setError(null)}
                />
                <button
                  type="button"
                  disabled={stamps.length === 1}
                  title={stamps.length === 1 ? 'A show keeps at least one stamp.' : undefined}
                  onClick={() => void save(stamps.filter((_, j) => j !== i))}
                >
                  Remove {stamp}
                </button>
              </>
            ) : (
              stamp
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form
          aria-label="Add stamp"
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <input
            aria-label="New stamp name"
            placeholder="Stamp (Hold)"
            value={name}
            maxLength={STAMP_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit">Add stamp</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
