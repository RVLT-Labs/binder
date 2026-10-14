import { columnEqual } from '@binder/core'
import { JSON_COLUMNS, type LocalEdit, type MarkupTable } from '../markup/mutations'

type Row = Record<string, unknown>

export interface ApplyFns {
  read(table: MarkupTable, id: string): Promise<Row | null>
  insert(table: MarkupTable, row: Row): Promise<void>
  update(table: MarkupTable, id: string, cols: Row): Promise<void>
  remove(table: MarkupTable, id: string): Promise<void>
  /** One local write transaction for a whole group. `source` tells listeners which direction it ran. */
  transaction(fn: () => Promise<void>, source?: 'undo' | 'redo'): Promise<void>
}

export type UndoOutcome =
  | { status: 'done' }
  | { status: 'blocked'; reason: 'changed-by-someone-else' | 'row-gone' | 'not-editable' }
  | { status: 'empty' }

/**
 * Says why the user may not change this row now (archived show, outside scope, locked layer), or
 * null when they may. Undo and redo are new writes, so they answer to the user's current rights.
 */
export type EditGuard = (table: MarkupTable, row: Row) => string | null

/** Bookkeeping columns: they change on every write and never decide whether a row is "ours". */
const IGNORED = new Set(['updated_at', 'updated_by', 'created_at'])

type Step =
  | { kind: 'insert'; table: MarkupTable; row: Row }
  | { kind: 'update'; table: MarkupTable; id: string; cols: Row }
  | { kind: 'remove'; table: MarkupTable; id: string }

type Planned = { steps: Step[] } | { blocked: Exclude<UndoOutcome, { status: 'done' | 'empty' }> }

function same(table: MarkupTable, col: string, a: unknown, b: unknown): boolean {
  return JSON_COLUMNS[table].includes(col) ? columnEqual(a, b) : (a ?? null) === (b ?? null)
}

/** Redo is undo of the opposite edit: an insert becomes a delete, and `before` and `after` swap. */
function inverse(e: LocalEdit): LocalEdit {
  const op = e.op === 'insert' ? 'delete' : e.op === 'delete' ? 'insert' : 'update'
  return { ...e, op, before: e.after, after: e.before }
}

/**
 * A personal, in-session stack of the user's own edits. Undo and redo are new writes, checked
 * against the rows as they are now, so one never undoes someone else's change.
 */
export class UndoStack {
  private undoable: LocalEdit[][] = []
  private redoable: LocalEdit[][] = []
  /** The guard's reason for the most recent `not-editable` block. */
  lastBlockedMessage: string | null = null

  constructor(
    private readonly apply: ApplyFns,
    private readonly limit = 100,
    private readonly guard?: EditGuard,
  ) {}

  get canUndo(): boolean {
    return this.undoable.length > 0
  }
  get canRedo(): boolean {
    return this.redoable.length > 0
  }

  record(edits: LocalEdit[]): void {
    if (edits.length === 0) return
    this.undoable.push(edits)
    if (this.undoable.length > this.limit) this.undoable.shift()
    this.redoable = []
  }

  clear(): void {
    this.undoable = []
    this.redoable = []
  }

  async undo(): Promise<UndoOutcome> {
    const group = this.undoable.pop()
    if (!group) return { status: 'empty' }
    let outcome: UndoOutcome
    try {
      outcome = await this.run([...group].reverse(), 'undo')
    } catch (err) {
      // The write failed, so nothing changed: the group is still the next thing to undo.
      this.undoable.push(group)
      throw err
    }
    if (outcome.status === 'done') {
      this.redoable.push(group)
      if (this.redoable.length > this.limit) this.redoable.shift()
    }
    return outcome
  }

  async redo(): Promise<UndoOutcome> {
    const group = this.redoable.pop()
    if (!group) return { status: 'empty' }
    let outcome: UndoOutcome
    try {
      outcome = await this.run(group.map(inverse), 'redo')
    } catch (err) {
      this.redoable.push(group)
      throw err
    }
    if (outcome.status === 'done') {
      this.undoable.push(group)
      if (this.undoable.length > this.limit) this.undoable.shift()
    }
    return outcome
  }

  /** Checks the whole group, then writes it in one transaction; a blocked edit writes nothing. */
  private async run(edits: LocalEdit[], source: 'undo' | 'redo'): Promise<UndoOutcome> {
    let outcome: UndoOutcome = { status: 'done' }
    await this.apply.transaction(async () => {
      const planned = await this.plan(edits)
      if ('blocked' in planned) {
        outcome = planned.blocked
        return
      }
      for (const step of planned.steps) {
        if (step.kind === 'insert') await this.apply.insert(step.table, step.row)
        else if (step.kind === 'update') await this.apply.update(step.table, step.id, step.cols)
        else await this.apply.remove(step.table, step.id)
      }
    }, source)
    return outcome
  }

  /** Reads each row (through the earlier edits of the group) and decides what undoing it writes. */
  private async plan(edits: LocalEdit[]): Promise<Planned> {
    const virtual = new Map<string, Row | null>()
    const steps: Step[] = []
    const gone = { blocked: { status: 'blocked', reason: 'row-gone' } } as const
    const changed = { blocked: { status: 'blocked', reason: 'changed-by-someone-else' } } as const

    for (const e of edits) {
      const key = `${e.table}:${e.id}`
      const current = virtual.has(key)
        ? (virtual.get(key) ?? null)
        : await this.apply.read(e.table, e.id)
      // Current rights come first: a locked or archived layer is reported as such, whatever else
      // has happened to the row.
      const refusal = this.refusal(e.table, [current, e.before, e.after])
      if (refusal !== null) {
        this.lastBlockedMessage = refusal
        return { blocked: { status: 'blocked', reason: 'not-editable' } }
      }
      let next: Row | null = current

      if (e.op === 'insert') {
        if (!current) return gone
        if (!e.after || !equalRows(e.table, current, e.after)) return changed
        steps.push({ kind: 'remove', table: e.table, id: e.id })
        next = null
      } else if (e.op === 'update') {
        if (!current) return gone
        const after = e.after ?? {}
        const before = e.before ?? {}
        const cols: Row = {}
        for (const col of Object.keys(after)) {
          if (IGNORED.has(col) || col === 'id') continue
          if (same(e.table, col, before[col], after[col])) continue
          if (same(e.table, col, current[col], after[col])) cols[col] = before[col] ?? null
        }
        if (Object.keys(cols).length === 0) return changed
        steps.push({ kind: 'update', table: e.table, id: e.id, cols })
        next = { ...current, ...cols }
      } else {
        if (current) return changed
        if (!e.before) return gone
        steps.push({ kind: 'insert', table: e.table, row: e.before })
        next = e.before
      }

      virtual.set(key, next)
    }
    return { steps }
  }

  /** The guard's reason for the first of these rows it refuses, or null. */
  private refusal(table: MarkupTable, rows: Array<Row | null>): string | null {
    if (!this.guard) return null
    for (const row of rows) {
      if (!row) continue
      const why = this.guard(table, row)
      if (why !== null) return why
    }
    return null
  }
}

function equalRows(table: MarkupTable, a: Row, b: Row): boolean {
  return Object.keys(b).every((col) => IGNORED.has(col) || same(table, col, a[col], b[col]))
}
