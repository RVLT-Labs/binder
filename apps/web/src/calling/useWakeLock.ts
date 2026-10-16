import { useEffect } from 'react'

interface Sentinel {
  release(): Promise<void>
}
interface WakeLockApi {
  request(type: 'screen'): Promise<Sentinel>
}

/**
 * Keeps the screen awake while `active` (Calling mode: a stage manager calling a long scene must not
 * get a dimmed, then locked, tablet). The browser drops the lock whenever the page is hidden, so it
 * is taken again when the page becomes visible. Released on leaving and on unmount. A missing API or
 * a refused request is ignored: the screen then just behaves as it always did.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    const api = (navigator as { wakeLock?: WakeLockApi }).wakeLock
    if (!active || !api) return
    let live = true
    let sentinel: Sentinel | null = null

    const release = () => {
      const held = sentinel
      sentinel = null
      held?.release().catch(() => {})
    }
    const acquire = async () => {
      if (sentinel) return
      try {
        const granted = await api.request('screen')
        if (!live || sentinel) {
          // Left Calling (or took a lock meanwhile) while the request was pending.
          granted.release().catch(() => {})
          return
        }
        sentinel = granted
      } catch {
        // Unsupported here, or refused (low battery, background): nothing to do.
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire()
      else release() // the browser drops it with the page; this just forgets it
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', onVisibility)
      release()
    }
  }, [active])
}
