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
  /** What "ago" is measured from. */
  now?: Date
  /** Called with the trimmed new title, only when it is not empty and differs from the old one. */
  onRename: (title: string) => void | Promise<void>
}

const CARD = 'relative rounded-[20px] border-2 p-5'

/**
 * One show on the shows home (DESIGN §8): a status pill with a word, the title as the card's link,
 * what is in it and when it last changed. An archived show is a dashed, muted card that says
 * read-only. It is a list item; put it in a `ul`.
 *
 * The show has no opening date or phase, and presence is per show over a socket, so the card
 * carries neither: the pill is Active or Archived.
 */
export function ShowCard({ show, cueCount, now = new Date(), onRename }: ShowCardProps) {
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
        'flex flex-col gap-3 transition-[transform,box-shadow] has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-red has-[a:focus-visible]:ring-offset-2 has-[a:focus-visible]:ring-offset-paper',
        archived
          ? 'border-dashed border-line-2 bg-transparent'
          : 'border-line-2 bg-card shadow-card hover:-translate-y-1 hover:shadow-hover',
      )}
    >
      <div className="-my-2.5 flex items-center justify-between gap-2">
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
          'font-display text-[20px] font-extrabold leading-tight',
          archived ? 'text-ink-2' : 'text-ink',
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

      <div className="mt-auto flex flex-col gap-1 text-[13px] text-muted">
        {archived ? (
          <span>read-only</span>
        ) : cueCount === undefined ? null : cueCount === 0 ? (
          <span className="font-hand text-[16px] leading-snug text-ink-2">nothing placed yet</span>
        ) : (
          <span>
            <span className="font-mono tabular-nums text-ink-2">{cueCount}</span>{' '}
            {cueCount === 1 ? 'cue' : 'cues'}
          </span>
        )}
        {ago && (
          <span>
            Updated{' '}
            <time dateTime={show.updated_at ?? undefined} className="font-mono tabular-nums">
              {ago}
            </time>
          </span>
        )}
      </div>
    </li>
  )
}
