import { useEffect, useRef, useState } from 'react'
import { annotationAccessibleName, toShapeAnnotation } from './AnnotationShape'
import { cueAccessibleName } from './CueMarker'
import { useMarkupSession } from './MarkupSession'
import { useSelection } from './selection'

/**
 * A polite live region that says which cue or annotation is selected, so keyboard and screen reader
 * users hear it.
 */
export function SelectionAnnouncer() {
  const { view, layerName } = useMarkupSession()
  const selection = useSelection()
  const [message, setMessage] = useState('')
  /** What was selected last, to say what was deselected. */
  const had = useRef<'cue' | 'annotation' | null>(null)
  const id = selection?.id ?? null
  const kind = selection?.table === 'annotations' ? 'annotation' : selection ? 'cue' : null

  let name: string | null = null
  if (id && kind === 'cue') {
    const cue = view.ordered.find((c) => c.id === id)
    name = cue ? cueAccessibleName(cue) : null
  } else if (id && kind === 'annotation') {
    for (const rows of view.annotationsByPage.values()) {
      const row = rows.find((r) => r.id === id)
      if (row) {
        const layer = {
          kind: row.layer_kind === 'personal' ? ('personal' as const) : ('department' as const),
          id: row.layer_id ?? '',
        }
        name = annotationAccessibleName(toShapeAnnotation(row), layerName(layer))
        break
      }
    }
  }

  useEffect(() => {
    if (name) {
      had.current = kind
      setMessage(`Selected ${name}`)
    } else if (!id && had.current) {
      setMessage(`No ${had.current} selected`)
      had.current = null
    }
  }, [id, name, kind])

  return (
    <p role="status" aria-live="polite" className="visually-hidden">
      {message}
    </p>
  )
}
