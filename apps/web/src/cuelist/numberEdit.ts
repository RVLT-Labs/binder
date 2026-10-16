import { type CueListRow, parseCueNumber } from '@binder/core'
import type { CueFields } from '@binder/shared'
import { useState } from 'react'
import { NUMBER_HINT } from '../markup/CueEditor'

/**
 * Number edits for a place that lists cues (the table's cells, the phone panel's field): the typed
 * text is parsed, a bad one is an error against that cue's id and changes nothing, and retyping the
 * stored number is not an edit and ends any complaint about an earlier try.
 */
export function useNumberEdit(onEdit: (id: string, patch: Partial<CueFields>) => void) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const clear = (id: string) =>
    setErrors((prev) => {
      const { [id]: _gone, ...rest } = prev
      return rest
    })
  function commit(row: Pick<CueListRow, 'id' | 'display'>, text: string) {
    if (text === row.display) {
      clear(row.id)
      return
    }
    const parsed = parseCueNumber(text)
    if (!parsed) {
      setErrors((prev) => ({ ...prev, [row.id]: NUMBER_HINT }))
      return
    }
    clear(row.id)
    onEdit(row.id, parsed)
  }
  return { errors, commit, clear }
}
