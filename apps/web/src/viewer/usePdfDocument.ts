import { useEffect, useState } from 'react'
import { fetchBlob } from '../blobs/fetchBlob'
import { openPdf, type PDFDocumentProxy } from './pdfjs'

export interface PdfDocumentState {
  pdf: PDFDocumentProxy | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
}

/** Loads the PDF at `url` (cache-first) and destroys it when the url changes or the caller unmounts. */
export function usePdfDocument(url: string | null): PdfDocumentState {
  const [state, setState] = useState<PdfDocumentState & { url: string | null }>({
    url,
    pdf: null,
    status: url ? 'loading' : 'idle',
  })

  useEffect(() => {
    if (!url) {
      setState({ url, pdf: null, status: 'idle' })
      return
    }
    let cancelled = false
    let destroy: (() => Promise<void>) | undefined
    setState({ url, pdf: null, status: 'loading' })
    void (async () => {
      try {
        const res = await fetchBlob(url)
        if (!res.ok) throw new Error(`the server answered ${res.status}`)
        // Each Response yields a fresh buffer; PDF.js detaches it, so it is never reused.
        const data = new Uint8Array(await res.arrayBuffer())
        if (cancelled) return
        const task = openPdf(data)
        destroy = () => task.destroy()
        const pdf = await task.promise
        if (!cancelled) setState({ url, pdf, status: 'ready' })
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setState({ url, pdf: null, status: 'error', error: `Could not open the PDF: ${message}` })
      }
    })()
    return () => {
      cancelled = true
      void destroy?.()
    }
  }, [url])

  // Until the effect catches up with a new url, report it as loading rather than the old document.
  if (state.url !== url) return { pdf: null, status: url ? 'loading' : 'idle' }
  return { pdf: state.pdf, status: state.status, error: state.error }
}
