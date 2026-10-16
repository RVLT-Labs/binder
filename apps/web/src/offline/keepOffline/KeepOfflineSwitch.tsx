import { useId, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useSessionUser } from '../../auth/session'
import type { ShowStatus } from './runner'
import { useKeepOfflineStatus } from './status'
import { setKeepOffline, useKeepOffline } from './store'

const mono = 'font-mono tabular-nums'
const files = (n: number) => (n === 1 ? 'file' : 'files')

/**
 * What a screen reader hears, which is deliberately not the visible line: the runner reports after
 * every stored file, so a live region carrying the moving count would be re-announced hundreds of
 * times. This changes only with the state, never with a count.
 */
function announcement(status: ShowStatus | undefined): string {
  switch (status?.state) {
    case 'working':
      return 'Updating files…'
    case 'offline':
      return 'Waiting for a connection'
    case 'paused':
      return 'Paused while data saver is on'
    case 'full':
      return 'Storage is full'
    case 'failed':
      return 'Some files couldn’t be saved'
    default:
      return ''
  }
}

/**
 * What keep-offline is doing, in words (the state is never the colour alone). Null when there is
 * nothing to say: all cached is the card's own line, which this sits under.
 */
function StatusLine({ status }: { status: ShowStatus }) {
  const { state, missing, failed, total } = status
  const n = <span className={mono}>{missing}</span>
  switch (state) {
    case 'working':
      return (
        <>
          <progress
            aria-label="Keeping up to date offline"
            value={Math.max(total - missing, 0)}
            max={Math.max(total, 1)}
            className="h-2 w-full appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-ink-2 [&::-webkit-progress-bar]:bg-paper-2 [&::-webkit-progress-value]:bg-ink-2"
          />
          <p className="m-0">
            Updating {n} {files(missing)}…
          </p>
        </>
      )
    case 'offline':
      // Being offline is a state, not an error (DESIGN §11).
      return (
        <p className="m-0">
          Waiting for a connection. {n} {files(missing)} to fetch.
        </p>
      )
    case 'paused':
      return (
        <p className="m-0">
          Paused while data saver is on. {n} {files(missing)} to fetch.
        </p>
      )
    case 'full':
      return (
        <>
          <Badge status="warn" className="self-start">
            Storage full
          </Badge>
          <p className="m-0">
            Storage is full. Binder couldn’t save {n} {files(missing)}. Free some space on this
            device.
          </p>
        </>
      )
    case 'failed':
      return (
        <p className="m-0">
          <span className={mono}>{failed}</span> {files(failed)} couldn’t be saved. Binder will try
          again.
        </p>
      )
    default:
      return null
  }
}

/**
 * Keeps a show on this device: the mockup's toggle with the word On (or Off) beside it, and under
 * it, while On, what Binder is doing about it. The whole row is the target, so the 32 px toggle is
 * still a 44 px one on a phone. The preference is per device and per user (`store.ts`); the runner
 * mounted in the root does the fetching and publishes the status shown here.
 */
export function KeepOfflineSwitch({
  showId,
  label = 'Make available offline',
  className,
}: {
  showId: string
  label?: string
  className?: string
}) {
  const id = useId()
  const { data: user } = useSessionUser()
  const on = useKeepOffline(showId)
  const status = useKeepOfflineStatus(showId)
  const [problem, setProblem] = useState(false)

  const change = (next: boolean) => {
    if (!user) return
    setProblem(false)
    setKeepOffline(user.id, showId, next).catch((err) => {
      console.error('could not save the keep-offline preference', err)
      setProblem(true)
    })
  }

  const line = on && status ? <StatusLine status={status} /> : null
  return (
    <div className={cn('flex flex-col', className)}>
      {/* One live region that is always mounted (one that appears already filled is often not
          announced), so it hears each change of state; the visible line below is not live. */}
      <div role="status" className="sr-only">
        {on ? announcement(status) : ''}
      </div>
      <div className="flex min-h-[33px] items-center gap-2.5">
        <label
          htmlFor={id}
          className="-my-[5.5px] flex min-h-11 min-w-0 flex-1 items-center text-[14px] font-semibold text-ink"
        >
          {label}
        </label>
        {/* The state in words; the switch itself carries it for assistive technology. */}
        <span
          aria-hidden
          className={cn('text-[12px] font-semibold', on ? 'text-ok' : 'text-muted')}
        >
          {on ? 'On' : 'Off'}
        </span>
        <Switch
          id={id}
          checked={on}
          disabled={!user}
          onCheckedChange={change}
          className="relative after:absolute after:-inset-1.5 after:content-['']"
        />
      </div>
      {line && (
        <div
          data-keep-offline-line
          className="mt-2.5 flex flex-col gap-2 text-[13px] leading-[1.5] text-muted"
        >
          {line}
        </div>
      )}
      {problem && (
        <p role="alert" className="m-0 mt-2.5 text-[13px] leading-[1.5] text-muted">
          Binder couldn’t save this setting on this device.
        </p>
      )}
    </div>
  )
}
