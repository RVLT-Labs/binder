import { Link } from '@tanstack/react-router'
import { Pencil } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn, focusRing } from '@/lib/utils'
import type { ShowRow } from '../powersync/schema'
import { timeAgo } from './timeAgo'

export interface ShowCardProps {
  show: Pick<ShowRow, 'id' | 'title' | 'status' | 'updated_at'>
  /** Cues in the show, once counted. Left off until then. */
  cueCount?: number
  /** The show's documents with their current version number, in order ("Libretto v3"). */
  documents?: { title: string; version: number }[]
  /** Items waiting for review across the show's documents; the blue "N to review" flag when above 0. */
  toReview?: number
  /** What "ago" is measured from. */
  now?: Date
  /** Called with the trimmed new title, only when it is not empty and differs from the old one. */
  onRename: (title: string) => void | Promise<void>
}

// The mockup's `.show-card`: radius 20, padding 16, gap 10, at least 168 px high (phone: 14, 8, none).
const CARD = 'relative rounded-[20px] border-2 p-3.5 md:p-4'

/**
 * One show on the shows home (DESIGN §8, mockup `.show-card`): a status pill with a word, the title
 * as the card's link, its documents and cue count, a "to review" flag, and when it last changed. A
 * show with nothing placed yet says so in a red Kalam chip. An archived show is a dashed card at
 * 75 % that says read-only; on a phone it is one compact row. It is a list item; put it in a `ul`.
 *
 * The show has no opening date or phase, and presence is per show over a socket, so the card
 * carries neither: the pill is Active or Archived.
 */
export function ShowCard({
  show,
  cueCount,
  documents = [],
  toReview = 0,
  now = new Date(),
  onRename,
}: ShowCardProps) {
  const archived = show.status === 'archived'
  const title = show.title ?? ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function save(e: FormEvent) {
    e.preventDefault()
    const next = draft.trim()
    setEditing(false)
    if (!next || next === title) return
    void onRename(next)
  }

  if (editing) {
    return (
      <li className={cn(CARD, 'border-line-2 bg-card')}>
        <form onSubmit={save} className="flex flex-col gap-3">
          <Input
            aria-label="Show title"
            autoFocus
            value={draft}
            maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" variant="line" size="sm">
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </li>
    )
  }

  const ago = timeAgo(show.updated_at, now)
  return (
    <li
      className={cn(
        CARD,
        'flex transition-[transform,box-shadow] has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-red has-[a:focus-visible]:ring-offset-2 has-[a:focus-visible]:ring-offset-paper',
        archived
          ? // A compact row on a phone: the name left, the pill and the rename button right.
            'max-md:flex-row max-md:flex-wrap max-md:items-center max-md:justify-between max-md:gap-x-2 max-md:p-[12px_14px] md:flex-col md:gap-2.5 border-dashed border-line-2 bg-card opacity-75'
          : 'flex-col gap-2 border-line-2 bg-card shadow-card hover:-translate-y-1 hover:shadow-hover md:min-h-[168px] md:gap-2.5',
      )}
    >
      <div
        className={cn(
          '-my-2.5 flex items-center justify-between gap-2',
          archived && 'max-md:order-2 max-md:-my-2',
        )}
      >
        <Badge status={archived ? 'neutral' : 'ok'}>
          {!archived && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
          {archived ? 'Archived' : 'Active'}
        </Badge>
        <button
          type="button"
          aria-label={`Rename ${title}`}
          onClick={() => {
            setDraft(title)
            setEditing(true)
          }}
          className={cn(
            'relative z-10 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-faint hover:text-ink md:size-9',
            focusRing,
          )}
        >
          <Pencil className="size-4" strokeWidth={1.8} aria-hidden />
        </button>
      </div>

      <h3
        className={cn(
          'font-display font-extrabold leading-[1.15] tracking-[-.02em] text-ink',
          archived
            ? 'text-[16px] max-md:order-1 max-md:min-w-0 max-md:flex-1'
            : 'text-[18px] md:text-[19px]',
        )}
      >
        <Link
          to="/shows/$showId"
          params={{ showId: show.id }}
          // The whole card is the target; the rename button sits above it.
          className="[overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-[18px] focus-visible:outline-none"
        >
          {title}
        </Link>
      </h3>

      {archived ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-muted max-md:hidden">
          <span>read-only</span>
          <span>exports still work</span>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
            {documents.map((doc, i) => (
              // By position: two documents can share a title.
              // biome-ignore lint/suspicious/noArrayIndexKey: titles can repeat
              <span key={i}>
                {doc.title} v{doc.version}
              </span>
            ))}
            {cueCount !== undefined && (
              <span className="font-mono tabular-nums">
                {cueCount} {cueCount === 1 ? 'cue' : 'cues'}
              </span>
            )}
            {toReview > 0 && (
              <Badge status="info" size="sm">
                <span className="font-mono tabular-nums">{toReview}</span> to review
              </Badge>
            )}
          </div>
          <div className="mt-auto flex items-center justify-between gap-2">
            {cueCount === 0 && (
              <span className="inline-flex items-center rounded-[var(--r)] border border-line-2 px-2.5 py-1.5 font-hand text-[15px] leading-snug text-red">
                {documents.length > 0 ? 'script in, nothing placed yet' : 'nothing placed yet'}
              </span>
            )}
            {ago && (
              <span className="ml-auto text-[12px] text-muted">
                Updated{' '}
                <time dateTime={show.updated_at ?? undefined} className="font-mono tabular-nums">
                  {ago}
                </time>
              </span>
            )}
          </div>
        </>
      )}
    </li>
  )
}
