import { useEffect, useRef, useState } from 'react'

/**
 * The one polite live region for Calling mode: it says when the script goes into Calling or back to
 * markup, and each page turn while calling ("Page 2 of 3"). It lives outside the Calling layer, so
 * it is still there to say the way out. `page` is zero-based.
 */
export function ModeAnnouncer({
  calling,
  page,
  pageCount,
}: {
  calling: boolean
  page: number
  pageCount: number
}) {
  const [message, setMessage] = useState('')
  const last = useRef<{ calling: boolean; page: number } | null>(null)
  useEffect(() => {
    const before = last.current
    last.current = { calling, page }
    const where = `Page ${page + 1} of ${pageCount}`
    if (!before) {
      if (calling) setMessage(`Calling mode. ${where}`)
    } else if (before.calling !== calling) {
      setMessage(calling ? `Calling mode. ${where}` : `Markup mode. ${where}`)
    } else if (calling && before.page !== page) {
      setMessage(where)
    }
  }, [calling, page, pageCount])
  return (
    <p role="status" aria-live="polite" className="visually-hidden">
      {message}
    </p>
  )
}
