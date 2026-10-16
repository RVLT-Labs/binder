import { formatCueNumber } from '@binder/core'
import { layerKey } from '@binder/shared'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SyncStatus } from '@/components/SyncStatus'
import { Badge } from '@/components/ui/badge'
import { restoreFocus } from '@/lib/modalDialog'
import { useMarkupSession } from '../markup/MarkupSession'
import { useOnline } from '../offline/useOnline'
import { useBreakpoint } from '../shell/useBreakpoint'
import { CallingStrip, type StripNext } from './CallingStrip'
import { recordJump, useRecentJumps } from './callingHistory'
import {
  type GoTarget,
  GoToKeypad,
  type KeypadCue,
  type KeypadDepartment,
  type RecentChip,
} from './GoToKeypad'
import { closeKeypad, openKeypad, useKeypadOpen } from './keypadState'
import { nextCue } from './nextCue'

/** `HH:MM` on the device's clock, kept current: the status line's time. */
function useClock(): string {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(timer)
  }, [])
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * The slim status line above the page (DESIGN §9): the red "Calling" pill, show and document with
 * its version, the time, and the sync state. Offline and cached is the normal state here, so it
 * reads as calm text, never as an error. On a phone the pill is its dot and the line is 11 px mono.
 */
export function CallingStatusLine({ show, document }: { show: string; document: string }) {
  const phone = useBreakpoint() === 'phone'
  const online = useOnline()
  const time = useClock()
  return (
    <section
      aria-label="Calling status"
      className="flex h-[34px] shrink-0 items-center justify-between gap-3 px-[18px] text-[12px] text-faint max-md:font-mono max-md:text-[11px]"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {phone ? (
          <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
            <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-red" />
            <span className="truncate">Calling · {document}</span>
          </span>
        ) : (
          <>
            <Badge status="primary" size="sm" className="shrink-0">
              <span aria-hidden className="size-1.5 rounded-full bg-current" />
              Calling
            </Badge>
            <span className="truncate">
              {show} · {document}
            </span>
          </>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2.5">
        <span className="font-mono tabular-nums">{time}</span>
        {online ? (
          <SyncStatus />
        ) : (
          <output
            aria-label="Sync status"
            data-state="offline"
            className="sync-status inline-flex items-center gap-1.5"
          >
            <span
              aria-hidden
              className="size-[7px] rounded-full bg-muted shadow-[0_0_0_2px_var(--muted-soft)]"
            />
            offline, cached
          </output>
        )}
      </span>
    </section>
  )
}

/**
 * Floating over the foot of the page: the CallingStrip and, when it is open, the go-to keypad. Reads
 * the page in view (zero-based) and what to call from the markup session, which is read-only here.
 */
export function CallingView({
  page,
  pageCount,
  onExit,
}: {
  page: number
  pageCount: number
  onExit: () => void
}) {
  const session = useMarkupSession()
  const open = useKeypadOpen()
  const recent = useRecentJumps()
  const goToButton = useRef<HTMLButtonElement>(null)
  const { departments, view, layers } = session
  // A keypad left open (Back out of Calling) must not greet the next visit.
  useEffect(() => closeKeypad, [])

  const keypadDepartments = useMemo<KeypadDepartment[]>(
    () =>
      departments.map((d) => ({
        id: d.id,
        code: d.code ?? '',
        numberFormat: d.number_format === 'point' ? 'point' : 'decimal',
        colour: d.colour,
      })),
    [departments],
  )
  const cues = useMemo<KeypadCue[]>(
    () =>
      view.ordered.map((c) => ({
        id: c.id,
        departmentId: c.department_id ?? '',
        major: Number(c.major ?? 0),
        minor: Number(c.minor ?? 0),
        label: c.label ?? '',
        anchor: { pageIndex: c.anchor.pageIndex, y: c.anchor.y },
      })),
    [view.ordered],
  )

  // The department whose cues the strip announces: the active layer's, or the first one shown when
  // the active layer is the personal one (or its department is hidden).
  const shown = (id: string) =>
    departments.some((d) => d.id === id && !d.hidden) &&
    !layers.hidden.includes(layerKey({ kind: 'department', id }))
  const activeId =
    session.active?.kind === 'department' && shown(session.active.id)
      ? session.active.id
      : (departments.find((d) => shown(d.id))?.id ?? null)
  const department = departments.find((d) => d.id === activeId)

  const found = nextCue(cues, {
    departmentId: activeId,
    page,
    y: session.pages[page]?.height ?? Number.POSITIVE_INFINITY,
  })
  const next: StripNext | null =
    found && department
      ? {
          department: department.code ?? '',
          colour: department.colour,
          number: formatCueNumber(
            found.major,
            found.minor,
            department.number_format === 'point' ? 'point' : 'decimal',
          ),
          label: found.label,
        }
      : null

  const codeOf = (c: KeypadCue) => {
    const d = keypadDepartments.find((x) => x.id === c.departmentId)
    return `${d?.code ?? ''} ${formatCueNumber(c.major, c.minor, d?.numberFormat ?? 'decimal')}`.trim()
  }
  const chips: RecentChip[] = recent.flatMap((jump): RecentChip[] => {
    if (jump.kind === 'page') {
      return jump.index < pageCount
        ? [{ label: jump.label, target: { kind: 'page', index: jump.index } }]
        : []
    }
    const cue = cues.find((c) => c.id === jump.cueId)
    return cue ? [{ label: jump.label, target: { kind: 'cue', cue } }] : []
  })

  function go(target: GoTarget) {
    closeKeypad()
    if (target.kind === 'page') {
      recordJump({ kind: 'page', index: target.index, label: `p.${target.index + 1}` })
      session.viewer.current?.goToPage(target.index)
      restoreFocus(goToButton.current)
      return
    }
    recordJump({ kind: 'cue', cueId: target.cue.id, label: codeOf(target.cue) })
    const row = view.ordered.find((c) => c.id === target.cue.id)
    if (row) session.showCue(row)
  }

  return (
    <>
      <CallingStrip
        page={page + 1}
        pages={pageCount}
        next={next}
        departmentCode={department?.code ?? undefined}
        onPrev={() => session.viewer.current?.turnPage(-1)}
        onNext={() => session.viewer.current?.turnPage(1)}
        onGoTo={openKeypad}
        onExit={onExit}
        goToRef={goToButton}
      />
      {open && (
        <GoToKeypad
          cues={cues}
          departments={keypadDepartments}
          pageCount={pageCount}
          recent={chips}
          onGo={go}
          onCancel={() => {
            closeKeypad()
            restoreFocus(goToButton.current)
          }}
        />
      )}
    </>
  )
}
