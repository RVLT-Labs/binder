import type { ShowLastChange, ShowPresence } from '@binder/shared'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useOnline } from '../offline/useOnline'

/** Presence is polled this often while the tab is visible (the hub drops a silent socket after 15 s). */
export const PRESENCE_POLL_MS = 15_000
const LAST_CHANGES_STALE_MS = 30_000
const LAST_CHANGES_POLL_MS = 60_000

export interface ShowPulse {
  /** Who is in each show right now, by show id; a show nobody is in has no entry. Undefined until known, and offline. */
  presence: Record<string, ShowPresence> | undefined
  /** The newest change per show, null for a show without one. Undefined until known, and offline. */
  lastChanges: Record<string, ShowLastChange | null> | undefined
}

/**
 * What the shows home says beyond the local data (spec "Who's in, on the show cards"): who has each
 * show open, and what changed last. Both are server views, so they run only while online and the
 * cards fall back to local data without them. Both keys sit under `['home']`, which sign-out and
 * the user switch clear with the rest of the cache.
 */
export function useShowPulse(): ShowPulse {
  const online = useOnline()
  const presence = useQuery({
    queryKey: ['home', 'presence'],
    queryFn: () => api.get<{ shows: Record<string, ShowPresence> }>('/me/shows/presence'),
    enabled: online,
    refetchInterval: PRESENCE_POLL_MS,
    refetchIntervalInBackground: false,
    // Presence is a snapshot: always ask again on mount, never serve an old one as fresh.
    staleTime: 0,
  })
  const lastChanges = useQuery({
    queryKey: ['home', 'last-changes'],
    queryFn: () =>
      api.get<{ shows: Record<string, ShowLastChange | null> }>('/me/shows/last-changes'),
    enabled: online,
    staleTime: LAST_CHANGES_STALE_MS,
    refetchInterval: LAST_CHANGES_POLL_MS,
    refetchOnWindowFocus: true,
  })
  return {
    // A cached answer from before the connection dropped is not drawn: offline shows no avatars.
    presence: online ? presence.data?.shows : undefined,
    lastChanges: online ? lastChanges.data?.shows : undefined,
  }
}
