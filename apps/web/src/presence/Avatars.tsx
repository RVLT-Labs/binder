import type { PresencePeer } from '@binder/shared'
import { useQuery } from '@powersync/react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
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

  const where = (p: PresencePeer): ReactNode => {
    if (!p.documentId) return 'in the show'
    const title = docs.find((d) => d.id === p.documentId)?.title ?? 'a document'
    return p.pageIndex === null ? (
      title
    ) : (
      <>
        {title}, page <span className="font-mono tabular-nums">{p.pageIndex + 1}</span>
      </>
    )
  }

  return (
    <section
      aria-labelledby="presence-list-title"
      className="rounded-[20px] border-2 border-line-2 bg-card p-4 shadow-card"
    >
      <h2 id="presence-list-title" className="mb-2 text-[12px] font-bold text-muted">
        In the binder now
      </h2>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {people.map((p) => (
          <li key={p.userId} className="flex items-center gap-3">
            {/* The person's own colour, from the data (spec 3.9): never a department's. */}
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
              style={{ background: p.colour, color: readableTextOn(p.colour) }}
            >
              {initials(p.name)}
            </span>
            <span className="min-w-0 text-[14px] leading-tight">
              <span className="font-semibold text-ink">{p.name}</span>
              <span className="sr-only"> — </span>
              <span className="block truncate text-[13px] text-muted">{where(p)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Who is in the binder, in the top bar: a stack of up to three people (then "+n"), each once, in
 * their own colour. Draws nothing when nobody else is here. Never animated, never a toast.
 */
export function BinderAvatars() {
  const { peers } = usePresencePeers()
  const people = whoIsHere(peers)
  if (people.length === 0) return null
  const shown = people.slice(0, 3)
  const more = people.length - shown.length
  const chip =
    // the mockup's `.presence .avatar`: 24 px, a 2 px paper ring, overlapping 6 px
    'flex size-6 items-center justify-center rounded-full border-2 border-paper text-[11px] font-bold'
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> is a form control group; this labels inline avatars
    <span role="group" aria-label="In the binder now" className="flex items-center -space-x-1.5">
      {shown.map((peer) => (
        <span
          key={peer.userId}
          role="img"
          aria-label={`${peer.name} is in the binder`}
          title={peer.name}
          data-user-id={peer.userId}
          className={chip}
          // The person's own colour, from the data: never a department's.
          style={{ background: peer.colour, color: readableTextOn(peer.colour) }}
        >
          {initials(peer.name)}
        </span>
      ))}
      {more > 0 && (
        <span
          role="img"
          aria-label={`${more} more in the binder`}
          className={cn(chip, 'bg-elev text-ink')}
        >
          +{more}
        </span>
      )}
    </span>
  )
}
