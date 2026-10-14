import { usePowerSync } from '@powersync/react'
import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { pushNotice } from '../components/noticeStore'
import { useMarkupSession } from '../markup/MarkupSession'
import { type LocalEdit, subscribeLocalEdits } from '../markup/mutations'
import { powersyncApply } from './powersyncApply'

type Db = ReturnType<typeof usePowerSync>

import { type EditGuard, type UndoOutcome, UndoStack } from './undoStack'

interface Entry {
  stack: UndoStack
  /** The mounted session's database, user, and rights check: refreshed on every commit. */
  live: { db: Db; userId: string; guard: EditGuard }
  busy: boolean
  version: number
  listeners: Set<() => void>
}

/** One stack per user and show for the page's lifetime: leaving a document and returning keeps it. */
const entries = new Map<string, Entry>()
let stopRecording: (() => void) | null = null

/**
 * The stack for a user and show, created on first use. Another user's stacks are dropped: a
 * sign-in change starts clean. Called from commit effects, which are safe to repeat.
 */
function entryFor(key: string, userId: string, live: Entry['live']): Entry {
  for (const other of [...entries.keys()])
    if (!other.startsWith(`${userId}:`)) entries.delete(other)
  let found = entries.get(key)
  if (!found) {
    const created: Entry = {
      stack: undefined as unknown as UndoStack,
      live,
      busy: false,
      version: 0,
      listeners: new Set(),
    }
    created.stack = new UndoStack(
      powersyncApply(
        () => created.live.db,
        () => created.live.userId,
      ),
      100,
      (table, row) => created.live.guard(table, row),
    )
    entries.set(key, created)
    found = created
  }
  return found
}

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

  // The shared entry is found or created after commit, never during render.
  const [entry, setEntry] = useState<Entry | null>(null)

  useLayoutEffect(() => {
    if (!key || !userId) {
      setEntry(null)
      return
    }
    // The newest committed session is the live one, so undo always checks the rights as they are.
    const live: Entry['live'] = {
      db,
      userId,
      guard: (table, row) =>
        table === 'cues'
          ? session.whyCantEdit(row as { department_id: string | null })
          : session.whyCantEditAnnotation(
              row as { layer_kind: string | null; layer_id: string | null },
            ),
    }
    const found = entryFor(key, userId, live)
    found.live = live
    setEntry(found)
  })

  useLayoutEffect(() => {
    ensureRecording()
  }, [])
  const current = entry

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
