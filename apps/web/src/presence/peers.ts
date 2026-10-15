import type { PresencePeer, PresenceSelection } from '@binder/shared'

/** The most recently updated connection of each user, in the order the client heard from them. */
export function latestPerUser(peers: readonly PresencePeer[]): PresencePeer[] {
  const last = new Map<string, number>()
  peers.forEach((p, i) => {
    last.set(p.userId, i)
  })
  return peers.filter((p, i) => last.get(p.userId) === i)
}

/**
 * The peers on each page of a version, one entry per user: the user's most recently updated
 * connection on that version. The client keeps `peers` in update order, oldest first. A peer with
 * no location (in the show, not on a document) is on no page.
 */
export function peersByPage(
  peers: readonly PresencePeer[],
  versionId: string,
): Map<number, PresencePeer[]> {
  const here = peers.filter((p) => p.versionId === versionId && p.pageIndex !== null)
  const byPage = new Map<number, PresencePeer[]>()
  for (const peer of latestPerUser(here)) {
    const page = peer.pageIndex as number
    const list = byPage.get(page)
    if (list) list.push(peer)
    else byPage.set(page, [peer])
  }
  return byPage
}

/** The key a selection is looked up by: `cues:<id>` or `annotations:<id>`. */
export const selectionKey = (s: PresenceSelection): string => `${s.table}:${s.id}`

/**
 * Who has each row selected on a version, one peer per user (their latest connection on it).
 * Peers on other versions are left out: a row id on v1 means nothing on v2's page.
 */
export function peerSelections(
  peers: readonly PresencePeer[],
  versionId: string,
): Map<string, PresencePeer[]> {
  const bySelection = new Map<string, PresencePeer[]>()
  for (const peer of latestPerUser(peers.filter((p) => p.versionId === versionId))) {
    if (!peer.selection) continue
    const key = selectionKey(peer.selection)
    const list = bySelection.get(key)
    if (list) list.push(peer)
    else bySelection.set(key, [peer])
  }
  return bySelection
}

/**
 * Everyone in the binder, once each: a user's most recently updated connection that says where it
 * is, else their latest connection (in the show but not on a document, e.g. a tab just opened).
 */
export function whoIsHere(peers: readonly PresencePeer[]): PresencePeer[] {
  const located = latestPerUser(peers.filter((p) => p.documentId !== null))
  const locatedUsers = new Set(located.map((p) => p.userId))
  const bare = latestPerUser(peers.filter((p) => !locatedUsers.has(p.userId)))
  const chosen = new Set([...located, ...bare])
  return peers.filter((p) => chosen.has(p))
}

/**
 * The selection to broadcast. Presence carries only rows every member can see, so anything on a
 * personal layer, and anything whose layer is not known to be a department, is never sent: a
 * personal note's id must not reach another user, even though it reveals no text.
 */
export function presenceSelection(
  sel: PresenceSelection | null,
  layerKind: 'department' | 'personal' | null | undefined,
): PresenceSelection | null {
  if (!sel || layerKind !== 'department') return null
  return { table: sel.table, id: sel.id }
}

/** Up to two letters for an avatar: `Ana Lopez` is `AL`. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words
    .slice(0, 2)
    .map((w) => Array.from(w)[0]?.toUpperCase() ?? '')
    .join('')
  return letters || '?'
}

/** Black or white, whichever has more contrast on the colour (`#rrggbb`); white if it is not one. */
export function readableTextOn(colour: string): '#000' | '#fff' {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour)
  if (!m) return '#fff'
  const lin = (hex: string) => {
    const c = Number.parseInt(hex, 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3])
  // Contrast with white is 1.05 / (L + 0.05); with black (L + 0.05) / 0.05.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? '#fff' : '#000'
}
