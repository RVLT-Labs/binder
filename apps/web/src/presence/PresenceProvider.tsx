import { EMPTY_PRESENCE_STATE, type PresencePeer, type PresenceState } from '@binder/shared'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSessionUser } from '../auth/session'
import { useOnline } from '../offline/useOnline'
import { createPresenceClient, type PresenceClient } from './client'

export interface PresenceValue {
  /** The show this value is for; '' outside a provider. */
  showId: string
  /** The other people in the show (never this user), oldest update first. Empty offline. */
  peers: PresencePeer[]
  connected: boolean
  /** Tells the show where this tab is. Remembered, and sent once the socket is open. */
  setState(state: PresenceState): void
}

const NO_PEERS: PresencePeer[] = []
const NONE: PresenceValue = { showId: '', peers: NO_PEERS, connected: false, setState: () => {} }

export const PresenceContext = createContext<PresenceValue>(NONE)

/** `ws:` or `wss:` to match the page, same origin as the API (the dev and preview proxies forward it). */
export function presenceUrl(
  showId: string,
  loc: Pick<Location, 'protocol' | 'host'> = location,
): string {
  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${loc.host}/api/shows/${encodeURIComponent(showId)}/presence`
}

/**
 * The one presence connection for a show, shared by everything under it: thumbnails, pages,
 * outlines, and the show header all read the same peers. With no network there is no socket and no
 * peers, and nothing says so: presence is best-effort (spec 3.9).
 */
export function PresenceProvider({ showId, children }: { showId: string; children: ReactNode }) {
  const online = useOnline()
  const { data: me } = useSessionUser()
  const myId = me?.id
  const [heard, setHeard] = useState<{ peers: PresencePeer[]; connected: boolean }>({
    peers: NO_PEERS,
    connected: false,
  })
  const client = useRef<PresenceClient | null>(null)
  /** What the tab last said, kept for a client that does not exist yet or is replaced. */
  const desired = useRef<PresenceState>(EMPTY_PRESENCE_STATE)

  useEffect(() => {
    if (!online) return
    const c = createPresenceClient({ url: presenceUrl(showId) })
    client.current = c
    c.setState(desired.current)
    const off = c.subscribe((peers, connected) => setHeard({ peers, connected }))
    return () => {
      off()
      c.close()
      if (client.current === c) client.current = null
      setHeard({ peers: NO_PEERS, connected: false })
    }
  }, [online, showId])

  const setState = useCallback((state: PresenceState) => {
    desired.current = state
    client.current?.setState(state)
  }, [])

  const value = useMemo<PresenceValue>(() => {
    // The user's own other tabs are not "someone else in the binder".
    const peers = online ? heard.peers.filter((p) => p.userId !== myId) : NO_PEERS
    return { showId, peers, connected: online && heard.connected, setState }
  }, [showId, online, heard, myId, setState])

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>
}

/** The other people in the show, for components that only look. Empty outside a provider and offline. */
export function usePresencePeers(): { peers: PresencePeer[]; connected: boolean } {
  const { peers, connected } = useContext(PresenceContext)
  return { peers, connected }
}
