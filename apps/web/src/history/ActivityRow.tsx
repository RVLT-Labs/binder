import type { ActivityGroup } from '@binder/shared'
import { PersonAvatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { targetOfGroup } from './api'
import { formatClock } from './time'

/** Above this many rows a revert says how many it takes back ("Revert 42 rows…"). */
const MANY_ROWS = 10

/** The row's button: plain "Revert", or the count with an ellipsis when it undoes a big batch. */
export function revertLabel(count: number): string {
  return count > MANY_ROWS ? `Revert ${count} rows…` : 'Revert'
}

/** "Jayden via Claude Code" is the person and the way they acted; the label has them in one string. */
function splitActor(group: ActivityGroup): { name: string; via: string | null } {
  if (!group.agent) return { name: group.label, via: null }
  const at = group.label.lastIndexOf(' via ')
  return at < 0
    ? { name: group.label, via: null }
    : { name: group.label.slice(0, at), via: group.label.slice(at + 1) }
}

/** What the row's second line says: how many rows the batch changed, and that an agent made it. */
function metaOf(group: ActivityGroup): string {
  const rows = `${group.count} ${group.count === 1 ? 'row' : 'rows'}`
  return group.agent ? `${rows} · agent batch` : rows
}

export interface ActivityRowProps {
  group: ActivityGroup
  /** The row's sentence gets this id, so Revert can be described by it. */
  textId?: string
  /** Revert's `aria-describedby`: the reason it is off, then the sentence. */
  describedBy?: string
  disabled: boolean
  onRevert: (target: ReturnType<typeof targetOfGroup>) => void
}

/**
 * One batch in the feed (the mockup's `.feed-row`): the person's avatar, a sentence ("Oli placed 6
 * SND cues and relabelled 1", with "via Claude Code" in purple when an agent acted), a meta line, a
 * mono time and Revert. On a phone it is a card (`.mb-act`) with Revert in view under the text.
 */
export function ActivityRow({ group, textId, describedBy, disabled, onRevert }: ActivityRowProps) {
  const { name, via } = splitActor(group)
  const system = name === 'Binder'
  return (
    <li
      className={cn(
        'activity-row grid grid-cols-[28px_1fr_auto] items-center gap-x-2.5 border-t border-line py-2.5 text-[13px] first:border-t-0',
        // phone: a card with the avatar at 36 px and Revert on a row of its own
        'max-md:grid-cols-[36px_1fr_auto] max-md:items-start max-md:gap-x-3 max-md:gap-y-2 max-md:rounded-[14px] max-md:border-2 max-md:border-line-2 max-md:bg-card max-md:p-3.5 max-md:text-[14px] max-md:shadow-card max-md:first:border-t-2',
      )}
      data-seq={group.toSeq}
    >
      <PersonAvatar
        name={name}
        className={cn(
          'activity-avatar size-[26px] justify-self-start max-md:size-9',
          system && '[&>span]:bg-elev [&>span]:text-muted',
        )}
      />
      <div className="min-w-0">
        <div id={textId} className="activity-text leading-[1.35] text-ink max-md:leading-[1.35]">
          <b className="font-semibold">{name}</b>
          {via && (
            <>
              {' '}
              <span className="activity-via text-purple">{via}</span>
            </>
          )}{' '}
          {group.summary}
        </div>
        <div className="activity-meta mt-0.5 text-[12px] text-muted">{metaOf(group)}</div>
      </div>
      <div className="flex items-center gap-3.5 max-md:contents">
        <time
          dateTime={group.at}
          className="font-mono text-[11.5px] whitespace-nowrap text-muted tabular-nums max-md:col-start-3 max-md:row-start-1 max-md:pt-0.5"
        >
          {formatClock(group.at)}
        </time>
        <Button
          type="button"
          variant="line"
          size="sm"
          className="max-md:col-span-2 max-md:col-start-2 max-md:w-full"
          disabled={disabled}
          aria-describedby={describedBy}
          onClick={() => onRevert(targetOfGroup(group))}
        >
          {revertLabel(group.count)}
        </Button>
      </div>
    </li>
  )
}
