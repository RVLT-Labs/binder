import { cueListRows } from '@binder/core'
import { type CueFields, canEditLayer, layerKey } from '@binder/shared'
import { usePowerSync, useQuery } from '@powersync/react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { pushNotice } from '../components/noticeStore'
import { CueListTable } from '../cuelist/CueListTable'
import { CueSheetButtons } from '../cuelist/CueSheetButtons'
import { duplicateStats } from '../cuelist/duplicates'
import { RenumberDialog } from '../cuelist/RenumberDialog'
import { ARCHIVED_HINT } from '../markup/MarkupSession'
import { type EditContext, fromCueRow, updateCue } from '../markup/mutations'
import { useLayers } from '../markup/useLayers'
import type { Database } from '../powersync/schema'

interface CueListSearch {
  /** The department whose cues are listed; the first visible one by default. */
  department?: string
  /** List only the cues that share a number with another (the overview's "Fix" link). */
  duplicates?: boolean
}

export const Route = createFileRoute('/shows/$showId/cues')({
  validateSearch: (search: Record<string, unknown>): CueListSearch => ({
    department:
      typeof search.department === 'string' && search.department ? search.department : undefined,
    duplicates: search.duplicates === true || search.duplicates === 'true' ? true : undefined,
  }),
  component: CueListPage,
})

type CueRow = Database['cues'] & { id: string }
type DocumentInfo = { id: string; title: string; current_version_id: string | null }

function CueListPage() {
  const { showId } = Route.useParams()
  const { department, duplicates: onlyDuplicates } = Route.useSearch()
  const db = usePowerSync()
  const navigate = useNavigate()
  const { userId, scope, departments, state: layers } = useLayers(showId)
  const visible = departments.filter((d) => !d.hidden)
  const current = departments.find((d) => d.id === department) ?? visible[0]
  const departmentId = current?.id ?? ''

  const { data: shows } = useQuery<Pick<Database['shows'], 'status'>>(
    'SELECT status FROM shows WHERE id = ?',
    [showId],
  )
  const { data: cues } = useQuery<CueRow>(
    'SELECT * FROM cues WHERE show_id = ? AND department_id = ?',
    [showId, departmentId],
  )
  const { data: documents } = useQuery<DocumentInfo>(
    'SELECT id, title, current_version_id FROM documents WHERE show_id = ? ORDER BY sort_order, title',
    [showId],
  )
  const [renumbering, setRenumbering] = useState(false)

  // The live scope as of the latest render, never a copy captured when a handler was created.
  const ctx: EditContext | null = scope && userId ? { showId, userId, scope } : null
  const archived = shows[0]?.status === 'archived'
  let readOnly: string | null = null
  if (archived) readOnly = ARCHIVED_HINT
  else if (!current) readOnly = null
  else if (!ctx || !canEditLayer(ctx.scope, ctx.userId, { kind: 'department', id: current.id })) {
    readOnly = `You can't edit ${current.code} cues.`
  } else if (layers.locked.includes(layerKey({ kind: 'department', id: current.id }))) {
    readOnly = `The ${current.code} layer is locked.`
  }
  const latest = useRef(ctx)
  latest.current = ctx
  const editContext = useCallback(() => latest.current, [])

  const rows = useMemo(
    () =>
      cueListRows(
        cues.map((row) => ({ id: row.id, ...fromCueRow(row) })),
        departments.map((d) => ({
          id: d.id,
          code: d.code ?? '',
          numberFormat: d.number_format === 'point' ? ('point' as const) : ('decimal' as const),
        })),
        documents.map((d) => ({
          id: d.id,
          title: d.title ?? '',
          currentVersionId: d.current_version_id,
        })),
      ),
    [cues, departments, documents],
  )
  // The same count the show overview's "Needs you" uses.
  const duplicates = duplicateStats(cues.map((row) => ({ id: row.id, ...fromCueRow(row) }))).get(
    departmentId,
  )
  const shownRows = onlyDuplicates ? rows.filter((r) => r.flags.includes('duplicate')) : rows

  async function edit(id: string, patch: Partial<CueFields>) {
    const now = editContext()
    if (!now) return
    try {
      await updateCue(db, now, id, patch)
    } catch (err) {
      pushNotice({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  if (!current) {
    return (
      <>
        <h1>Cue list</h1>
        <p>This show has no departments yet.</p>
      </>
    )
  }

  return (
    <>
      <h1>{current.code} cue list</h1>
      <nav aria-label="Departments" className="cue-list-departments">
        {visible.map((d) => (
          <Link
            key={d.id}
            to="/shows/$showId/cues"
            params={{ showId }}
            search={{ department: d.id }}
            aria-current={d.id === current.id ? 'page' : undefined}
          >
            {d.code}
          </Link>
        ))}
      </nav>
      {readOnly && <p className="muted">{readOnly}</p>}
      {duplicates && (
        <p role="status" className="muted">
          {current.code} has {duplicates.numbers} duplicate{' '}
          {duplicates.numbers === 1 ? 'number' : 'numbers'}: {duplicates.cues} cues share a number
          with another {current.code} cue.{' '}
          {onlyDuplicates ? (
            <Link to="/shows/$showId/cues" params={{ showId }} search={{ department: current.id }}>
              Show all {current.code} cues
            </Link>
          ) : null}
        </p>
      )}
      {onlyDuplicates && !duplicates && (
        <p role="status" className="muted">
          No duplicate numbers in {current.code}.{' '}
          <Link to="/shows/$showId/cues" params={{ showId }} search={{ department: current.id }}>
            Show all {current.code} cues
          </Link>
        </p>
      )}
      <p>
        <button
          type="button"
          disabled={readOnly !== null || documents.length === 0}
          onClick={() => setRenumbering(true)}
        >
          Renumber from script order…
        </button>
      </p>
      <CueSheetButtons
        departmentId={current.id}
        departmentCode={current.code ?? ''}
        editContext={editContext}
      />
      {rows.length === 0 ? (
        <p>No {current.code} cues yet.</p>
      ) : (
        <CueListTable
          rows={shownRows}
          readOnly={readOnly}
          onEdit={(id, patch) => void edit(id, patch)}
          onOpen={(row) => {
            if (!row.anchor) return
            void navigate({
              to: '/shows/$showId/docs/$docId',
              params: { showId, docId: row.anchor.documentId },
              search: { v: row.anchor.documentVersionId, p: row.anchor.pageIndex + 1, cue: row.id },
            })
          }}
        />
      )}
      {renumbering && (
        <RenumberDialog
          departmentId={current.id}
          departmentCode={current.code ?? ''}
          documents={documents.map((d) => ({ id: d.id, title: d.title ?? '' }))}
          editContext={editContext}
          onClose={() => setRenumbering(false)}
        />
      )}
    </>
  )
}
