import { usePowerSync, useQuery, useStatus } from '@powersync/react'
import { useEffect, useMemo, useState } from 'react'
import { blobCacheChanged } from '../cacheStatus'
import { setActiveRunner } from './active'
import { browserRunnerDeps } from './browser'
import { createKeepOfflineRunner, type KeepOfflineRunner as Runner } from './runner'
import { publishKeepOfflineStatus } from './status'
import { loadOfflinePrefs, useOfflinePrefs } from './store'

const SHOWS_SQL = 'SELECT id FROM shows'
/** Ready versions of every local show: a new revision becoming ready is a new row here. */
export const VERSIONS_SQL =
  "SELECT id, show_id, searchable_key FROM document_versions WHERE status = 'ready' ORDER BY id"
/** What each version's pages hold, so thumbnails and word layers arriving change the signature. */
export const PAGES_SQL = `
  SELECT show_id, document_version_id, count(thumb_key) AS thumbs, count(words_key) AS words
  FROM pages GROUP BY show_id, document_version_id ORDER BY document_version_id`

interface VersionRow {
  id: string
  show_id: string
  searchable_key: string | null
}
interface PageSummaryRow {
  show_id: string
  document_version_id: string
  thumbs: number
  words: number
}

/**
 * Runs keep-offline for the whole signed-in app: one runner, mounted once inside the PowerSync
 * provider, so it keeps working on the home page and on other shows. It reads the preferences
 * (which shows are On), tells the runner which shows exist on this device and when the ready
 * versions or their pages change, and resumes it when the network or the page comes back. Renders
 * nothing; the switch reads the status this publishes.
 */
export function KeepOfflineRunner({ userId }: { userId: string }) {
  const db = usePowerSync()
  const { userId: loadedFor, prefs } = useOfflinePrefs()
  const hasSynced = useStatus().hasSynced === true
  const shows = useQuery<{ id: string }>(SHOWS_SQL)
  const versions = useQuery<VersionRow>(VERSIONS_SQL)
  const pages = useQuery<PageSummaryRow>(PAGES_SQL)
  const [runner, setRunner] = useState<Runner | null>(null)

  // The preferences live in IndexedDB; the switch and the runner read the in-memory mirror.
  useEffect(() => {
    loadOfflinePrefs(userId).catch((err) => {
      // Blocked or failing storage: every show reads Off, and nothing is fetched.
      console.error('could not read the keep-offline preferences', err)
    })
  }, [userId])

  useEffect(() => {
    const next = createKeepOfflineRunner(
      browserRunnerDeps({ db, userId, onStored: blobCacheChanged }),
    )
    setActiveRunner(next)
    const unsubscribe = next.subscribe(() => publishKeepOfflineStatus(next.getStatus()))
    const resume = () => next.resume()
    const onVisible = () => {
      if (document.visibilityState === 'visible') next.resume()
    }
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', onVisible)
    setRunner(next)
    return () => {
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', onVisible)
      unsubscribe()
      setRunner(null)
      setActiveRunner(null)
      publishKeepOfflineStatus(new Map())
      // Aborts its fetches and drops any late response; sign-out has stopped it already.
      void next.stop()
    }
  }, [db, userId])

  const mine = loadedFor === userId
  // Until the first sync has landed the local `shows` table may simply be empty, which must not
  // look like "every show was removed" (that prunes preferences and cached files).
  const localShows = useMemo<ReadonlySet<string> | null>(
    () => (hasSynced && !shows.isLoading ? new Set(shows.data.map((s) => s.id)) : null),
    [hasSynced, shows.isLoading, shows.data],
  )
  useEffect(() => {
    if (!runner || !mine) return
    runner.update({ enabled: [...prefs.keys()], localShows })
  }, [runner, mine, prefs, localShows])

  // What the runner fetches depends on the enabled shows' ready versions and their pages' files.
  // The signature is only made once both queries have answered: a signature taken from an empty,
  // still-loading table would make the first real answer look like a change.
  const loaded = !versions.isLoading && !pages.isLoading
  const signature = useMemo(() => {
    if (!loaded) return null
    const readyIds = new Set<string>()
    const parts: string[] = []
    for (const v of versions.data) {
      if (!prefs.has(v.show_id)) continue
      readyIds.add(v.id)
      parts.push(`v:${v.id}:${v.searchable_key ?? ''}`)
    }
    for (const p of pages.data) {
      if (readyIds.has(p.document_version_id)) {
        parts.push(`p:${p.document_version_id}:${p.thumbs}:${p.words}`)
      }
    }
    return parts.join('|')
  }, [loaded, versions.data, pages.data, prefs])
  useEffect(() => {
    if (runner && signature !== null) runner.notifySync(signature)
  }, [runner, signature])

  return null
}
