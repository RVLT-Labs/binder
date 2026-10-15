import type { PresencePeer } from '@binder/shared'
import { useQuery } from '@powersync/react'
import type { DocumentRow } from '../powersync/schema'
import { usePresencePeers } from './PresenceProvider'
import { initials, readableTextOn, whoIsHere } from './peers'

/** Avatars shown on one thumbnail or page before the rest collapse into "+n". */
const MAX_SHOWN = 3

/** A person's initials on their colour. Named for assistive technology unless it is decorative. */
export function Avatar({
  peer,
  label,
  decorative = false,
}: {
  peer: PresencePeer
  /** What it is called, e.g. "Ana on page 3". */
  label: string
  /** The text beside it already says all this. */
  decorative?: boolean
}) {
  const style = { background: peer.colour, color: readableTextOn(peer.colour) }
  if (decorative) {
    return (
      <span className="presence-avatar" aria-hidden="true" data-user-id={peer.userId} style={style}>
        {initials(peer.name)}
      </span>
    )
  }
  return (
    <span
      className="presence-avatar"
      role="img"
      aria-label={label}
      title={label}
      data-user-id={peer.userId}
      style={style}
    >
      {initials(peer.name)}
    </span>
  )
}

/**
 * The people on one page, as a labelled group of avatars. Draws nothing for an empty page. It
 * never takes the pointer: it sits over a thumbnail or a page and must not steal clicks from them.
 */
export function AvatarGroup({
  peers,
  pageIndex,
  className,
}: {
  peers: readonly PresencePeer[]
  /** Zero-based. */
  pageIndex: number
  className: string
}) {
  if (peers.length === 0) return null
  const page = pageIndex + 1
  const shown = peers.slice(0, MAX_SHOWN)
  const more = peers.length - shown.length
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> is a form control group; this labels inline avatars
    <span className={className} role="group" aria-label={`People on page ${page}`}>
      {shown.map((peer) => (
        <Avatar key={peer.userId} peer={peer} label={`${peer.name} on page ${page}`} />
      ))}
      {more > 0 && (
        <span
          className="presence-avatar presence-more"
          role="img"
          aria-label={`${more} more on page ${page}`}
        >
          +{more}
        </span>
      )}
    </span>
  )
}

/**
 * Who is in the binder, on the show page: each person once, with the document and page they are
 * on, or "in the show" when they have not opened one. Absent when nobody else is here, and offline.
 */
export function BinderPresence({ showId }: { showId: string }) {
  const { peers } = usePresencePeers()
  const { data: docs } = useQuery<Pick<DocumentRow, 'id' | 'title'>>(
    'SELECT id, title FROM documents WHERE show_id = ?',
    [showId],
  )
  const people = whoIsHere(peers)
  if (people.length === 0) return null

  const where = (p: PresencePeer): string => {
    if (!p.documentId) return 'in the show'
    const title = docs.find((d) => d.id === p.documentId)?.title ?? 'a document'
    return p.pageIndex === null ? title : `${title}, page ${p.pageIndex + 1}`
  }

  return (
    <section className="presence-list" aria-labelledby="presence-list-title">
      <h2 id="presence-list-title">Who is in the binder</h2>
      <ul>
        {people.map((p) => (
          <li key={p.userId}>
            <Avatar peer={p} label={p.name} decorative />{' '}
            <span>
              {p.name} — {where(p)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
