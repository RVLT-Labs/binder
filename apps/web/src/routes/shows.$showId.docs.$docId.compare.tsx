import { useQuery } from '@powersync/react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'
import { ContextPanel } from '../panel/ContextPanel'
import type { DocumentRow, DocumentVersionRow } from '../powersync/schema'
import { ChangeList, type ChangeListState, ChangeSteps } from '../revisions/ChangeList'
import { ComparePane } from '../revisions/ComparePane'
import { CompareVersionPicker } from '../revisions/CompareVersionPicker'
import {
  type Change,
  changeHunks,
  changeList,
  compareTexts,
  incompleteMessage,
  TOO_MANY_MESSAGE,
  tintedLines,
} from '../revisions/compareModel'
import { useReviewCount } from '../revisions/useReviewCount'
import { clearVersionTextCache, useVersionText } from '../revisions/useVersionText'
import { TopBarActions } from '../shell/TopBarSlots'
import { useBreakpoint } from '../shell/useBreakpoint'

interface CompareSearch {
  from?: string
  to?: string
}

export const Route = createFileRoute('/shows/$showId/docs/$docId/compare')({
  validateSearch: (search: Record<string, unknown>): CompareSearch => ({
    from: typeof search.from === 'string' && search.from ? search.from : undefined,
    to: typeof search.to === 'string' && search.to ? search.to : undefined,
  }),
  component: ComparePage,
})

const label = (v: DocumentVersionRow) => `v${v.version_number}${v.label ? ` · ${v.label}` : ''}`
const short = (v: DocumentVersionRow) => `v${v.version_number}`

/** "Cut" and "Added" with the wash each draws on the page (the mockup's `.dx-key`). */
function Key() {
  const swatch = 'inline-block h-2.5 w-3.5 rounded-[2px] border border-line-2'
  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        <i className={cn(swatch, 'bg-[color-mix(in_srgb,var(--red)_14%,var(--page))]')} />
        Cut
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i className={cn(swatch, 'bg-[color-mix(in_srgb,var(--green)_16%,var(--page))]')} />
        Added
      </span>
    </>
  )
}

/**
 * Two versions of a document side by side: removed lines tinted on the old one, added lines on the
 * new, and a list of the changes that takes both sides to the page it is on. The diff is computed
 * here from the word layers in the blob cache, so it works offline. The list is the context panel:
 * docked at desktop, a sheet from the top bar at tablet, a bottom drawer at phone (where one
 * version shows at a time).
 */
function ComparePage() {
  const { showId, docId } = Route.useParams()
  const { from, to } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const breakpoint = useBreakpoint()
  const phone = breakpoint === 'phone'
  const { data: docs } = useQuery<DocumentRow>(
    'SELECT * FROM documents WHERE id = ? AND show_id = ?',
    [docId, showId],
  )
  const { data: versions } = useQuery<DocumentVersionRow>(
    "SELECT * FROM document_versions WHERE document_id = ? AND status = 'ready' ORDER BY version_number",
    [docId],
  )
  const reviewCount = useReviewCount(docId)
  const doc = docs[0]
  const toVersion =
    versions.find((v) => v.id === to) ??
    versions.find((v) => v.id === doc?.current_version_id) ??
    versions.at(-1)
  const fromVersion =
    versions.find((v) => v.id === from) ??
    versions.filter((v) => (v.version_number ?? 0) < (toVersion?.version_number ?? 0)).at(-1)

  const oldState = useVersionText(fromVersion?.id ?? null)
  const newState = useVersionText(toVersion?.id ?? null)
  const oldText = oldState.text
  const newText = newState.text
  // The parsed texts are large; they go when the screen does.
  useEffect(() => clearVersionTextCache, [])
  const outcome = useMemo(
    () =>
      oldText && newText
        ? compareTexts(
            { text: oldText, unavailable: oldState.unavailable },
            { text: newText, unavailable: newState.unavailable },
          )
        : null,
    [oldText, newText, oldState.unavailable, newState.unavailable],
  )
  const diff = outcome?.kind === 'diff' ? outcome.diff : null
  const hunks = useMemo(() => changeHunks(diff ? changeList(diff.entries) : []), [diff])
  const oldTint = useMemo(() => (diff ? tintedLines(diff.entries, 'old') : new Map()), [diff])
  const newTint = useMemo(() => (diff ? tintedLines(diff.entries, 'new') : new Map()), [diff])
  const [oldPage, setOldPage] = useState(0)
  const [newPage, setNewPage] = useState(0)
  const [active, setActive] = useState<number | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  // Phone: one version at a time
  const [side, setSide] = useState<'old' | 'new'>('new')
  const opener = useRef<HTMLElement | null>(null)

  const choose = (patch: CompareSearch) =>
    void navigate({
      search: { from: fromVersion?.id, to: toVersion?.id, ...patch },
      replace: true,
    })

  /** Both sides go to the change; on a phone or tablet the sheet gets out of the way of the page. */
  const show = useCallback(
    (c: Change, keepOpen = false) => {
      setActive(c.index)
      setOldPage(c.oldPage)
      setNewPage(c.newPage)
      setSide(c.op === 'removed' ? 'old' : 'new')
      if (!keepOpen && breakpoint !== 'desktop') setPanelOpen(false)
    },
    [breakpoint],
  )
  // The comparison opens on its first change, as the mockup does, rather than on two first pages.
  const first = hunks[0]?.changes[0]
  const opened = useRef<string | null>(null)
  useEffect(() => {
    const key = first ? `${fromVersion?.id}:${toVersion?.id}` : null
    if (!first || opened.current === key) return
    opened.current = key
    show(first, true)
  }, [first, fromVersion?.id, toVersion?.id, show])
  const position = hunks.findIndex((h) => h.changes.some((c) => c.index === active))
  const step = (delta: -1 | 1) => {
    const at = position < 0 ? (delta === 1 ? -1 : hunks.length) : position
    const next = hunks[at + delta]
    if (next) show(next.changes[0], true)
  }

  const listState: ChangeListState = !outcome
    ? { kind: 'comparing' }
    : outcome.kind === 'incomplete'
      ? { kind: 'message', role: 'alert', text: incompleteMessage(outcome.unavailable) }
      : outcome.kind === 'too-many' || !diff
        ? { kind: 'message', role: 'status', text: TOO_MANY_MESSAGE }
        : { kind: 'diff', removed: diff.removed, added: diff.added, hunks }

  const picker = (
    <CompareVersionPicker
      versions={versions}
      from={fromVersion?.id ?? ''}
      to={toVersion?.id ?? ''}
      onFromChange={(id) => {
        setActive(null)
        choose({ from: id })
      }}
      onToChange={(id) => {
        setActive(null)
        choose({ to: id })
      }}
    />
  )
  const reviewLink = (
    <Button asChild variant="line" size="sm">
      <Link to="/shows/$showId/docs/$docId" params={{ showId, docId }} search={{ review: true }}>
        Open review
        {reviewCount > 0 && (
          <Badge status="info" size="sm" className="h-4 px-1.5">
            {reviewCount}
          </Badge>
        )}
      </Link>
    </Button>
  )
  const changesButton = (
    <Button
      type="button"
      variant="line"
      size="sm"
      aria-haspopup="dialog"
      aria-expanded={panelOpen}
      onClick={(e) => {
        opener.current = e.currentTarget
        setPanelOpen((o) => !o)
      }}
    >
      Changes
      {hunks.length > 0 && (
        <Badge status="info" size="sm" className="h-4 px-1.5">
          {hunks.length}
        </Badge>
      )}
    </Button>
  )

  const ready = fromVersion && toVersion && fromVersion.id !== toVersion.id
  let body: ReactNode
  if (!fromVersion || !toVersion) {
    body = (
      <p className="viewer-message m-0 p-6 text-ink-2">
        A document needs two ready versions to compare.
      </p>
    )
  } else if (fromVersion.id === toVersion.id) {
    body = (
      <p className="viewer-message m-0 p-6 text-ink-2">Choose two different versions to compare.</p>
    )
  } else {
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* `.dx-strip`: where the pages are, and what the washes mean */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-[18px] gap-y-1 border-b border-line px-6 py-2 text-[12px] text-muted max-md:gap-x-2 max-md:gap-y-2 max-md:px-4">
          {phone ? (
            <>
              {picker}
              <Segmented
                aria-label="Version shown"
                value={side}
                onValueChange={(v) => setSide(v as 'old' | 'new')}
                options={[
                  { value: 'old', label: short(fromVersion) },
                  { value: 'new', label: short(toVersion) },
                ]}
                className="ml-auto"
              />
              {changesButton}
            </>
          ) : (
            <>
              <span>
                Showing{' '}
                <span className="font-mono text-ink-2 tabular-nums">
                  {short(fromVersion)} p.{oldPage + 1}
                </span>{' '}
                and{' '}
                <span className="font-mono text-ink-2 tabular-nums">
                  {short(toVersion)} p.{newPage + 1}
                </span>
              </span>
              <span className="ml-auto inline-flex items-center gap-[18px]">
                <Key />
              </span>
            </>
          )}
        </div>
        <div className="flex min-h-0 flex-1 justify-center gap-6 px-5 pt-3 max-md:px-3">
          {(!phone || side === 'old') && (
            <ComparePane
              side="old"
              title={`Old · ${label(fromVersion)}`}
              versionName={short(fromVersion)}
              versionId={fromVersion.id}
              text={oldText}
              pageIndex={oldPage}
              onPageChange={setOldPage}
              tint={oldTint}
              tintedTotal={diff?.removed ?? 0}
            />
          )}
          {(!phone || side === 'new') && (
            <ComparePane
              side="new"
              title={`New · ${label(toVersion)}`}
              versionName={short(toVersion)}
              versionId={toVersion.id}
              text={newText}
              pageIndex={newPage}
              onPageChange={setNewPage}
              tint={newTint}
              tintedTotal={diff?.added ?? 0}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="compare-page-root relative flex min-h-0 min-w-0 flex-1">
      <h1 className="sr-only">Compare versions</h1>
      {!phone && (
        <TopBarActions>
          {versions.length > 1 && picker}
          {ready && breakpoint === 'tablet' && changesButton}
          {ready && reviewLink}
        </TopBarActions>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-stage">{body}</div>
      {ready && (
        <ContextPanel
          tabs={[
            {
              id: 'changes',
              label: 'Changes',
              content: (
                <ChangeList
                  docTitle={doc?.title ?? 'Document'}
                  fromName={short(fromVersion)}
                  toName={short(toVersion)}
                  state={listState}
                  active={active}
                  onChoose={show}
                />
              ),
            },
          ]}
          value="changes"
          onValueChange={() => {}}
          open={panelOpen}
          onOpenChange={setPanelOpen}
          returnFocusTo={() => opener.current}
          label="Version changes"
          showDone={breakpoint !== 'desktop'}
          dockedWidth={360}
          footer={
            <ChangeSteps
              count={hunks.length}
              position={position < 0 ? null : position}
              onStep={step}
            />
          }
        />
      )}
    </div>
  )
}
