import { useEffect, useRef, useState } from 'react'
import { cueAccessibleName } from './CueMarker'
import { useMarkupSession } from './MarkupSession'
import { useSelection } from './selection'

/** A polite live region that says which cue is selected, so keyboard and screen reader users hear it. */
export function SelectionAnnouncer() {
  const { view } = useMarkupSession()
  const selection = useSelection()
  const [message, setMessage] = useState('')
  const had = useRef(false)
  const id = selection?.table === 'cues' ? selection.id : null
  const cue = id ? view.ordered.find((c) => c.id === id) : undefined
  const name = cue ? cueAccessibleName(cue) : null

  useEffect(() => {
    if (name) {
      had.current = true
      setMessage(`Selected ${name}`)
    } else if (!id && had.current) {
      had.current = false
      setMessage('No cue selected')
    }
  }, [id, name])

  return (
    <p role="status" aria-live="polite" className="visually-hidden">
      {message}
    </p>
  )
}
