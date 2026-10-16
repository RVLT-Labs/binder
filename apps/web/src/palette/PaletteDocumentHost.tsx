import { useEffect, useRef } from 'react'
import { modalIsOpen } from '@/lib/modalDialog'
import { useMarkupSession } from '../markup/MarkupSession'
import { isPaletteOpen, registerDocumentHost } from './paletteState'

/**
 * Tells the command palette about the open document (see `PaletteDocumentHost`), and gives Print
 * its ⌘P. Mounted by the document page inside the markup session, while a ready version is shown.
 */
export function PaletteDocumentHostRegistration({
  documentId,
  versionId,
  pageCount,
  onPrint,
}: {
  documentId: string
  versionId: string
  pageCount: number
  /** Opens the page's print dialog; focus returns to `opener` when it closes. */
  onPrint: (opener: HTMLElement | null) => void
}) {
  const session = useMarkupSession()
  // The session changes with every edit; the registration stays put and reads what is current.
  const latest = useRef({ session, onPrint })
  latest.current = { session, onPrint }

  useEffect(
    () =>
      registerDocumentHost({
        documentId,
        versionId,
        pageCount,
        goToPage: (index) => latest.current.session.viewer.current?.goToPage(index),
        searchFor: (query) => latest.current.session.viewer.current?.searchFor(query),
        openPrint: (opener) => latest.current.onPrint(opener),
      }),
    [documentId, versionId, pageCount],
  )

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 'p' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      if (e.defaultPrevented || modalIsOpen() || isPaletteOpen()) return
      // The browser would print the app's chrome; Binder's own Print is what ⌘P means here.
      e.preventDefault()
      latest.current.onPrint(
        document.activeElement instanceof HTMLElement ? document.activeElement : null,
      )
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return null
}
