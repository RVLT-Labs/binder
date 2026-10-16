import { cueListRows } from '@binder/core'
import { type CueFields, canEditLayer, deptChrome, layerKey } from '@binder/shared'
import { usePowerSync, useQuery } from '@powersync/react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { FilterIcon, MoreIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { pushNotice } from '../components/noticeStore'
import { CueCardList } from '../cuelist/CueCard'
import { CueDetail } from '../cuelist/CueDetail'
import {
  DepartmentSwitch,
  FilterBox,
  type FlagCounts,
  type FlagFilter,
  FlagPills,
} from '../cuelist/CueListFilters'
import { CueListTable } from '../cuelist/CueListTable'
import { CueSheetButtons } from '../cuelist/CueSheetButtons'
import { duplicateStats } from '../cuelist/duplicates'
import { firstCueDocument } from '../cuelist/placeFirstCue'
import { RenumberDialog } from '../cuelist/RenumberDialog'
import { type CuePanelTab, useCuePanel } from '../cuelist/useCuePanel'
import { HistoryPanel } from '../history/HistoryPanel'
import { ARCHIVED_HINT } from '../markup/MarkupSession'
import { type EditContext, fromCueRow, updateCue } from '../markup/mutations'
import { useLayers } from '../markup/useLayers'
import { ContextPanel, type PanelTab } from '../panel/ContextPanel'
import { Note, Swatch } from '../panel/fields'
import type { Database } from '../powersync/schema'
import { TopBarActions, TopBarPhone } from '../shell/TopBarSlots'
import { useBreakpoint } from '../shell/useBreakpoint'

interface CueListSearch {
  /** The department whose cues are listed; the first visible one by default. */
  department?: string
  /** List only the cues that share a number with another (the overview's "Fix" link). */
  duplicates?: boolean
  /** Open Renumber from script order once (the command palette's action; the address drops it). */
  renumber?: boolean
}

export const Route = createFileRoute('/shows/$showId/cues')({
  validateSearch: (search: Record<string, unknown>): CueListSearch => ({
    department:
      typeof search.department === 'string' && search.department ? search.department : undefined,
    duplicates: search.duplicates === true || search.duplicates === 'true' ? true : undefined,
    renumber: search.renumber === true || search.renumber === 'true' ? true : undefined,
  }),
  component: CueListPage,
})

type CueRow = Database['cues'] & { id: string }
type DocumentInfo = { id: string; title: string; current_version_id: string | null }

/** The latest this many changes are on the Cue tab (the mockup draws three); the History tab has them all. */
const HISTORY_PREVIEW = 3

const NO_FLAGS: Record<FlagFilter, boolean> = {
  duplicate: false,
  approximate: false,
  unresolved: false,
}

function CueListPage() {
  const { showId } = Route.useParams()
  const { department, duplicates: onlyDuplicates, renumber } = Route.useSearch()
  const db = usePowerSync()
  const navigate = useNavigate()
  const breakpoint = useBreakpoint()
  const phone = breakpoint === 'phone'
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
  const { data: counts } = useQuery<{ department_id: string; n: number }>(
    'SELECT department_id, COUNT(*) AS n FROM cues WHERE show_id = ? GROUP BY department_id',
    [showId],
  )
  const { data: documents } = useQuery<DocumentInfo>(
    'SELECT id, title, current_version_id FROM documents WHERE show_id = ? ORDER BY sort_order, title',
    [showId],
  )
  const [renumbering, setRenumbering] = useState(false)
  const renumberOpener = useRef<HTMLElement | null>(null)
  const [flags, setFlags] = useState(NO_FLAGS)
  const [filter, setFilter] = useState('')
  const [searching, setSearching] = useState(false)
  const panel = useCuePanel()

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

  // The command palette's "Renumber from script order" arrives as `?renumber`: it opens the same
  // dialog the button does, once, as soon as the membership and documents are known, and says why when it cannot.
  const renumberReady = Boolean(current) && ctx !== null && documents.length > 0
  useEffect(() => {
    if (!renumber || !renumberReady) return
    if (readOnly === null) {
      renumberOpener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      setRenumbering(true)
    } else {
      pushNotice({ kind: 'info', message: readOnly })
    }
    void navigate({
      to: '/shows/$showId/cues',
      params: { showId },
      search: { department, duplicates: onlyDuplicates },
      replace: true,
    })
  }, [renumber, renumberReady, readOnly, navigate, showId, department, onlyDuplicates])

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
  const flagCounts: FlagCounts = {
    duplicate: rows.filter((r) => r.flags.includes('duplicate')).length,
    approximate: rows.filter((r) => r.flags.includes('approximate')).length,
    unresolved: rows.filter((r) => r.flags.includes('unresolved')).length,
  }
  const active = { ...flags, duplicate: onlyDuplicates === true }
  const anyFlag = active.duplicate || active.approximate || active.unresolved
  const needle = filter.trim().toLowerCase()
  const shownRows = rows.filter(
    (r) =>
      (!anyFlag ||
        (Object.keys(active) as FlagFilter[]).some((f) => active[f] && r.flags.includes(f))) &&
      (!needle ||
        [r.display, r.label, r.trigger, r.notes, r.page].some((v) =>
          v.toLowerCase().includes(needle),
        )),
  )

  const selectedRow = rows.find((r) => r.id === panel.selectedId) ?? null
  const selectedCue = cues.find((c) => c.id === panel.selectedId)
  // A cue that went (deleted elsewhere, another department) leaves nothing selected.
  const { clear: clearPanel, selectedId } = panel
  useEffect(() => {
    if (selectedId && !rows.some((r) => r.id === selectedId)) clearPanel()
  }, [selectedId, rows, clearPanel])

  // At phone width the drawer covers the lower part of the list: the card that was tapped is
  // scrolled up into the part still in view (the list gets the drawer's height as room below it).
  const drawerOpen = phone && panel.open
  useEffect(() => {
    if (!drawerOpen || !selectedId) return
    let frame = 0
    let tries = 0
    const check = () => {
      const card = document.querySelector<HTMLElement>(`[data-cue-id="${CSS.escape(selectedId)}"]`)
      const sheet = document.querySelector<HTMLElement>('[data-panel="drawer"]')
      const scroller = card?.closest<HTMLElement>('[data-cue-scroller]')
      if (!card || !sheet || !scroller) {
        if (tries++ < 30) frame = requestAnimationFrame(check)
        return
      }
      const bandTop = scroller.getBoundingClientRect().top
      const bandBottom = window.innerHeight - sheet.offsetHeight
      const at = card.getBoundingClientRect()
      if (at.top >= bandTop + 4 && at.bottom <= bandBottom - 12) return
      // into the middle of what the drawer leaves of the list
      scroller.scrollTop += (at.top + at.bottom) / 2 - (bandTop + bandBottom) / 2
    }
    frame = requestAnimationFrame(check)
    return () => cancelAnimationFrame(frame)
  }, [drawerOpen, selectedId])

  async function edit(id: string, patch: Partial<CueFields>) {
    const now = editContext()
    if (!now) return
    try {
      await updateCue(db, now, id, patch)
    } catch (err) {
      pushNotice({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  function showOnPage(row: (typeof rows)[number]) {
    if (!row.anchor) return
    void navigate({
      to: '/shows/$showId/docs/$docId',
      params: { showId, docId: row.anchor.documentId },
      search: { v: row.anchor.documentVersionId, p: row.anchor.pageIndex + 1, cue: row.id },
    })
  }

  function setDepartment(id: string) {
    panel.clear()
    setFlags(NO_FLAGS)
    setFilter('')
    void navigate({ to: '/shows/$showId/cues', params: { showId }, search: { department: id } })
  }

  function toggleFlag(flag: FlagFilter) {
    if (flag === 'duplicate') {
      void navigate({
        to: '/shows/$showId/cues',
        params: { showId },
        search: { department: current?.id, duplicates: onlyDuplicates ? undefined : true },
        replace: true,
      })
      return
    }
    setFlags((f) => ({ ...f, [flag]: !f[flag] }))
  }

  if (!current) {
    return (
      <div className="px-4 py-3.5 md:px-8 md:py-7">
        <h1 className="sr-only">Cue list</h1>
        <Note>This show has no departments yet.</Note>
      </div>
    )
  }

  const canRenumber = readOnly === null && documents.length > 0
  const countOf = (id: string) => counts.find((c) => c.department_id === id)?.n ?? 0
  const switcher = (
    <DepartmentSwitch
      departments={visible.map((d) => ({
        id: d.id,
        code: d.code ?? '',
        colour: d.colour,
        count: countOf(d.id),
      }))}
      value={current.id}
      onChange={setDepartment}
    />
  )
  const pills = <FlagPills counts={flagCounts} active={active} onToggle={toggleFlag} />
  const hasPills =
    flagCounts.duplicate + flagCounts.approximate + flagCounts.unresolved > 0 || anyFlag

  const notes = (
    <>
      {readOnly && <Note className="mb-3">{readOnly}</Note>}
      {onlyDuplicates && duplicates && (
        <Note role="status" className="mb-3">
          {current.code} has {duplicates.numbers} duplicate{' '}
          {duplicates.numbers === 1 ? 'number' : 'numbers'}: {duplicates.cues} cues share a number
          with another {current.code} cue.
        </Note>
      )}
      {onlyDuplicates && !duplicates && (
        <Note role="status" className="mb-3">
          No duplicate numbers in {current.code}.
        </Note>
      )}
    </>
  )

  const placeInto = firstCueDocument(documents, readOnly)
  const list =
    rows.length === 0 ? (
      <EmptyState
        label={
          <span
            className="inline-flex items-center gap-1.5 text-[13px] font-bold"
            style={{ color: current.colour ? deptChrome(current.colour) : undefined }}
          >
            <Swatch colour={current.colour ? deptChrome(current.colour) : 'var(--faint)'} />
            {current.code}
            <span className="font-mono font-normal text-muted tabular-nums">0</span>
          </span>
        }
        heading={`No ${(current.name || current.code || '').toLowerCase()} cues yet.`}
        hand="the quiet before the pad comes in"
        action={
          // Cues are placed on the page, so the way in is a document that can be marked up, and only
          // for someone who can place cues in this department.
          placeInto ? (
            <Button asChild variant="line">
              <Link to="/shows/$showId/docs/$docId" params={{ showId, docId: placeInto }}>
                Place the first cue
              </Link>
            </Button>
          ) : undefined
        }
      />
    ) : shownRows.length === 0 ? (
      <p className="m-0 text-[13px] text-muted">No cues match.</p>
    ) : phone ? (
      <CueCardList
        rows={shownRows}
        selectedId={panel.selectedId}
        onSelect={(r) => panel.select(r.id)}
      />
    ) : (
      <CueListTable
        rows={shownRows}
        selectedId={panel.selectedId}
        readOnly={readOnly}
        onEdit={(id, patch) => void edit(id, patch)}
        onSelect={(r) => panel.select(r.id)}
      />
    )

  const departmentOf = departments.find((d) => d.id === selectedCue?.department_id) ?? current
  const history = (limit?: number): ReactNode =>
    selectedRow && selectedCue ? (
      <HistoryPanel
        showId={showId}
        table="cues"
        rowId={selectedRow.id}
        rowStamp={selectedCue.updated_at}
        whyCantRevert={readOnly}
        currentNumber={{ major: selectedCue.major ?? 0, minor: selectedCue.minor ?? 0 }}
        departmentId={selectedCue.department_id}
        limit={limit}
      />
    ) : null
  const tabs: PanelTab[] = [
    {
      id: 'cue',
      label: 'Cue',
      content: selectedRow ? (
        <CueDetail
          key={selectedRow.id}
          row={selectedRow}
          department={{ code: departmentOf.code ?? '', colour: departmentOf.colour }}
          readOnly={readOnly}
          phone={phone}
          onEdit={(patch) => void edit(selectedRow.id, patch)}
          onShowOnPage={() => showOnPage(selectedRow)}
          history={history(HISTORY_PREVIEW)}
        />
      ) : (
        <Note>Select a cue to see its details.</Note>
      ),
    },
    {
      id: 'history',
      label: 'History',
      content: selectedRow ? history() : <Note>Select a cue to see its history.</Note>,
    },
  ]

  return (
    <div className="relative flex min-h-0 flex-1">
      {phone ? (
        <PhoneBar
          searching={searching}
          onSearch={() => setSearching((v) => !v)}
          canRenumber={canRenumber}
          onRenumber={(opener) => {
            renumberOpener.current = opener
            setRenumbering(true)
          }}
          departmentId={current.id}
          departmentCode={current.code ?? ''}
          editContext={editContext}
        />
      ) : (
        <TopBarActions>
          <Button
            type="button"
            variant="line"
            size="sm"
            disabled={!canRenumber}
            onClick={(e) => {
              renumberOpener.current = e.currentTarget
              setRenumbering(true)
            }}
          >
            Renumber from script order…
          </Button>
          <CueSheetButtons
            departmentId={current.id}
            departmentCode={current.code ?? ''}
            editContext={editContext}
          />
        </TopBarActions>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="sr-only">{current.code} cue list</h1>
        {phone ? (
          // `.mb-sub`: the department switch and the filters stay pinned while the cards scroll
          <div className="flex shrink-0 flex-col gap-1.5 border-b border-line bg-paper px-4 pt-2.5 pb-1.5">
            {switcher}
            {hasPills && <div className="flex min-h-11 flex-wrap items-center gap-2">{pills}</div>}
            {searching && <FilterBox variant="field" value={filter} onChange={setFilter} />}
          </div>
        ) : null}
        <div
          data-cue-scroller
          className={
            phone
              ? 'min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-4'
              : 'min-h-0 flex-1 overflow-y-auto px-6 py-[18px]'
          }
          style={drawerOpen ? { paddingBottom: '72svh' } : undefined}
        >
          {!phone && (
            <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
              {switcher}
              {hasPills && <span aria-hidden className="h-[18px] w-px bg-line" />}
              {pills}
              <FilterBox value={filter} onChange={setFilter} />
            </div>
          )}
          {notes}
          {list}
        </div>
      </div>
      <ContextPanel
        tabs={tabs}
        value={panel.tab}
        onValueChange={(id) => panel.setTab(id as CuePanelTab)}
        open={panel.open}
        onOpenChange={panel.onOpenChange}
        returnFocusTo={() =>
          panel.lastSelectedId
            ? document.querySelector<HTMLElement>(
                `[data-cue-id="${CSS.escape(panel.lastSelectedId)}"]`,
              )
            : null
        }
        showDone={breakpoint !== 'desktop'}
        dockedWidth={340}
      />
      {renumbering && (
        <RenumberDialog
          departmentId={current.id}
          departmentCode={current.code ?? ''}
          documents={documents.map((d) => ({ id: d.id, title: d.title ?? '' }))}
          editContext={editContext}
          returnFocusTo={renumberOpener.current}
          onClose={() => setRenumbering(false)}
        />
      )}
    </div>
  )
}

/**
 * The phone's top bar controls (the `m-cues` mockup): Search, which opens the filter field, and a
 * "More" menu that holds Renumber and Export, so the title keeps its room.
 */
function PhoneBar({
  searching,
  onSearch,
  canRenumber,
  onRenumber,
  departmentId,
  departmentCode,
  editContext,
}: {
  searching: boolean
  onSearch: () => void
  canRenumber: boolean
  onRenumber: (opener: HTMLElement | null) => void
  departmentId: string
  departmentCode: string
  editContext: () => EditContext | null
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  return (
    <TopBarPhone>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Search"
        aria-expanded={searching}
        className="shrink-0"
        onClick={onSearch}
      >
        <FilterIcon className="!size-[22px]" />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            size="icon"
            aria-label="More"
            className="shrink-0"
          >
            <MoreIcon className="!size-[22px]" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          aria-label="Cue list menu"
          className="flex w-[min(22rem,calc(100vw-24px))] flex-col gap-3 p-3"
          // the dialog the Renumber row opens takes focus itself and hands it back to this button
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <Button
            type="button"
            variant="line"
            disabled={!canRenumber}
            onClick={() => {
              setOpen(false)
              onRenumber(trigger.current)
            }}
          >
            Renumber from script order…
          </Button>
          <CueSheetButtons
            variant="group"
            departmentId={departmentId}
            departmentCode={departmentCode}
            editContext={editContext}
            onDone={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
    </TopBarPhone>
  )
}
