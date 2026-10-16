import { useEffect, useState } from 'react'

/**
 * The current time, ticking every `everyMs` so "12 min ago" stays true while the page is open. The
 * tick also runs when the tab becomes visible again, so a backgrounded tab is right on return.
 */
export function useNow(everyMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const id = window.setInterval(tick, everyMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [everyMs])
  return now
}
