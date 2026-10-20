import type { ShowLastChange } from '@binder/shared'
import { Link } from '@tanstack/react-router'
import { Pencil } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn, focusRing } from '@/lib/utils'
import type { ShowRow } from '../powersync/schema'
import { AvatarStack, type StackPerson } from '../presence/Avatars'
import { timeAgo } from './timeAgo'

export interface ShowCardProps {
  show: Pick<ShowRow, 'id' | 'title' | 'status' | 'updated_at'>
  /** Cues in the show, once counted. Left off until then. */
  cueCount?: number
  /** The show's documents with their current version number, in order ("Libretto v3"). */
  documents?: { title: string; version: number }[]
  /** Items waiting for review across the show's documents; the blue "N to review" flag when above 0. */
  toReview?: number
  /** Who has the show open right now (the card draws their avatars). Left off offline and while loading. */
  inNow?: readonly StackPerson[]
  /** The newest change in the show; `null` or left off falls back to the local "Updated ..." line. */
  lastChange?: Pick<ShowLastChange, 'at' | 'label' | 'summary' | 'sentence'> | null
  /** When the show last changed on this device (local rows), for the fallback; never older than `show.updated_at`. */
  localActivityAt?: string
  /** What "ago" is measured from. */
  now?: Date
  /** Called with the trimmed new title, only when it is not empty and differs from the old one. */
  onRename: (title: string) => void | Promise<void>
}

// The mockup's `.show-card`: radius 20, padding 16, gap 10, at least 168 px high (phone: 14, 8, none).
const CARD = 'relative rounded-[20px] border-2 p-3.5 md:p-4'

/** The pencil artwork is unchanged; its real button reserves a 44px target. */
export function ShowRenameButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Rename ${title}`}
      onClick={onClick}
      style={{ minHeight: 44, minWidth: 44 }}
      className={cn(
        'relative z-10 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:text-ink md:size-9',
        focusRing,
      )}
    >
      <Pencil className="size-4" aria-hidden />
    </button>
  )
}

/**
 * One show on the shows home (DESIGN §8, mockup `.show-card`): a status pill with a word, the title
 * as the card's link, its documents and cue count, a "to review" flag, and when it last changed. A
 * show with nothing placed yet says so in a red Kalam chip. An archived show is a dashed card at
 * 75 % that says read-only; on a phone it is one compact row. It is a list item; put it in a `ul`.
 *
 * The foot says who has the show open (their avatars) and the newest change with its time; offline,
 * or before the first answer, it says "Updated ..." from the local rows and draws no avatars. An
 * archived card has neither. The show has no opening date or phase, so the pill is Active or Archived.
 */
export function ShowCard({
  show,
  cueCount,
  documents = [],
  toReview = 0,
  inNow = [],
  lastChange,
  localActivityAt,
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

  // The server's sentence when there is one; otherwise the local rows' newest update, which is
  // all an offline or still-loading card knows.
  const localAt = [show.updated_at, localActivityAt]
    .filter((t): t is string => !!t && !Number.isNaN(Date.parse(t)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .at(-1)
  const ago = timeAgo(lastChange ? lastChange.at : localAt, now)
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
        <ShowRenameButton
          title={title}
          onClick={() => {
            setDraft(title)
            setEditing(true)
          }}
        />
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
          {/* The foot: the chip or the avatars on the left, the sentence and its time on the right.
              Its height is reserved (the avatars' 24 px) so nothing shifts when data arrives. */}
          <div
            className={cn(
              'show-card-foot mt-auto flex min-h-6 items-center justify-between gap-x-2 gap-y-1.5',
              // With avatars the foot stays on one line, however long the sentence: the sentence
              // (basis 0, truncating) gives way before the avatars wrap under it. Without avatars,
              // or beside the "nothing placed yet" chip (which cannot shrink), it may wrap.
              inNow.length > 0 && cueCount !== 0 ? 'flex-nowrap' : 'flex-wrap',
            )}
          >
            {cueCount === 0 && (
              <span className="inline-flex items-center whitespace-nowrap rounded-[var(--r)] border border-line-2 px-2.5 py-1.5 font-hand text-[15px] leading-snug text-red-text">
                {documents.length > 0 ? 'script in, nothing placed yet' : 'nothing placed yet'}
              </span>
            )}
            <AvatarStack people={inNow} />
            {ago &&
              (lastChange ? (
                <span
                  className={cn(
                    'ml-auto flex min-w-0 items-baseline justify-end gap-1 text-[12px] text-muted',
                    // Beside the chip (which cannot shrink) the sentence takes its own line, so it
                    // reads whole; with avatars it shares the line and truncates before they wrap.
                    cueCount === 0 ? 'basis-full' : 'flex-1 basis-0',
                  )}
                  title={`${lastChange.label} ${lastChange.summary}`}
                >
                  {/* The mockup sets the whole line in the body face, the time included. The tooltip
                      names who; a screen reader hears the same, not the short form. */}
                  <span className="sr-only">
                    {lastChange.label} {lastChange.summary},{' '}
                  </span>
                  <span aria-hidden className="truncate">
                    {lastChange.sentence}
                  </span>
                  <span aria-hidden className="shrink-0">
                    ·
                  </span>
                  <time dateTime={lastChange.at} className="shrink-0 whitespace-nowrap">
                    {ago}
                  </time>
                </span>
              ) : (
                <span className="ml-auto whitespace-nowrap text-[12px] text-muted">
                  Updated <time dateTime={localAt}>{ago}</time>
                </span>
              ))}
          </div>
        </>
      )}
    </li>
  )
}
