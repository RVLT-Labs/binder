import { usePowerSync } from '@powersync/react'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { pushNotice } from '../components/noticeStore'
import { useMarkupSession } from '../markup/MarkupSession'
import { type LocalEdit, subscribeLocalEdits } from '../markup/mutations'
import { powersyncApply } from './powersyncApply'
import { type EditGuard, type UndoOutcome, UndoStack } from './undoStack'

interface Entry {
  stack: UndoStack
  /** The current rights check, replaced on every render of the session that owns the hook. */
  guard: { current: EditGuard }
  busy: boolean
  version: number
  listeners: Set<() => void>
}

/** One stack per user and show for the page's lifetime: leaving a document and returning keeps it. */
const entries = new Map<string, Entry>()
let stopRecording: (() => void) | null = null

function bump(entry: Entry) {
  entry.version++
  for (const fn of [...entry.listeners]) fn()
}

/** Records the user's own edits, whichever screen made them, into their show's stack. */
function ensureRecording() {
  if (stopRecording) return
  stopRecording = subscribeLocalEdits((edits: LocalEdit[], source) => {
    if (source !== 'user') return
    const showId = (edits[0]?.after ?? edits[0]?.before)?.show_id
    if (typeof showId !== 'string') return
    // Only the signed-in user writes through the mutations, so every entry for the show is theirs.
    for (const [key, entry] of entries) {
      if (key.endsWith(`:${showId}`)) {
        entry.stack.record(edits)
        bump(entry)
      }
    }
  })
}

export interface Undo {
  canUndo: boolean
  canRedo: boolean
  undo(): Promise<UndoOutcome>
  redo(): Promise<UndoOutcome>
}

const EMPTY: UndoOutcome = { status: 'empty' }

function explain(verb: 'undo' | 'redo', outcome: UndoOutcome, entry: Entry): string | null {
  if (outcome.status !== 'blocked') return null
  if (outcome.reason === 'not-editable') {
    return `Can't ${verb}: ${entry.stack.lastBlockedMessage ?? "you can't edit that layer now"}`
  }
  return `Can't ${verb}: someone else has changed this since`
}

/**
 * The personal undo stack of this user for this show: records their own edits, and undoes and
 * redoes them as new writes. Must run inside a `MarkupSessionProvider`, whose live rights it checks.
 */
export function useUndo(showId: string): Undo {
  const db = usePowerSync()
  const session = useMarkupSession()
  const userId = session.userId
  const key = userId ? `${userId}:${showId}` : null

  const sessionRef = useRef(session)
  sessionRef.current = session

  let entry = key ? entries.get(key) : undefined
  if (key && userId && !entry) {
    const guard = {
      current: ((table, row) =>
        table === 'cues'
          ? sessionRef.current.whyCantEdit(row as { department_id: string | null })
          : sessionRef.current.whyCantEditAnnotation(
              row as { layer_kind: string | null; layer_id: string | null },
            )) as EditGuard,
    }
    const created: Entry = {
      stack: new UndoStack(powersyncApply(db, userId), 100, (t, r) => guard.current(t, r)),
      guard,
      busy: false,
      version: 0,
      listeners: new Set(),
    }
    for (const other of [...entries.keys()])
      if (!other.startsWith(`${userId}:`)) entries.delete(other)
    entries.set(key, created)
    entry = created
  }
  const current = entry

  useEffect(() => {
    ensureRecording()
  }, [])

  const subscribe = useCallback(
    (fn: () => void) => {
      current?.listeners.add(fn)
      return () => {
        current?.listeners.delete(fn)
      }
    },
    [current],
  )
  useSyncExternalStore(subscribe, () => current?.version ?? 0)

  const run = useCallback(
    async (verb: 'undo' | 'redo'): Promise<UndoOutcome> => {
      if (!current || current.busy) return EMPTY
      current.busy = true
      try {
        const outcome = await current.stack[verb]()
        const message = explain(verb, outcome, current)
        if (message) pushNotice({ kind: 'info', message })
        return outcome
      } catch (err) {
        pushNotice({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
        return EMPTY
      } finally {
        current.busy = false
        bump(current)
      }
    },
    [current],
  )

  return {
    canUndo: current?.stack.canUndo ?? false,
    canRedo: current?.stack.canRedo ?? false,
    undo: useCallback(() => run('undo'), [run]),
    redo: useCallback(() => run('redo'), [run]),
  }
}
