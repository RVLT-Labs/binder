import { usePowerSync, useQuery } from '@powersync/react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { SECTION_LABEL } from '../panel/fields'
import { ADD_ROW, Field } from '../settings/parts'
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
    <section aria-labelledby={`${ids}-heading`} className="flex flex-col gap-2">
      <h2 id={`${ids}-heading`} className={SECTION_LABEL}>
        Stamps
      </h2>
      <ul aria-label="Stamps" className="m-0 list-none p-0">
        {stamps.map((stamp, i) => (
          <li
            key={stamp}
            className="flex min-h-11 items-center gap-3 border-t border-line text-[13px] text-ink first:border-t-0 md:min-h-10"
          >
            {editable ? (
              <>
                <CommitInput
                  id={`${ids}-${i}`}
                  aria-label={`Stamp ${i + 1} name`}
                  value={stamp}
                  onCommit={(value) => rename(i, value)}
                  onCancel={() => setError(null)}
                  className="-ml-1.5 max-w-[260px] flex-1 border-transparent bg-transparent px-1.5 hover:border-input focus-visible:bg-paper md:-ml-[9px] md:px-[9px]"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-muted"
                  aria-label={`Remove ${stamp}`}
                  disabled={stamps.length === 1}
                  title={stamps.length === 1 ? 'A show keeps at least one stamp.' : undefined}
                  onClick={() => void save(stamps.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
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
          className={cn(ADD_ROW, 'flex flex-wrap items-end gap-3')}
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <Field label="New stamp" className="max-w-[260px] flex-1 max-md:max-w-none">
            <Input
              aria-label="New stamp name"
              placeholder="Stamp (Hold)"
              value={name}
              maxLength={STAMP_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="line">
            Add stamp
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="m-0 text-[12px] text-ink-2">
          {error}
        </p>
      )}
      <p className="m-0 text-[12px] text-muted">
        The stamps the stamp tool offers. Stamps already placed keep their text when one is renamed
        or removed.
      </p>
    </section>
  )
}
