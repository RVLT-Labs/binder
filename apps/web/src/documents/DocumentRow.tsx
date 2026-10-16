import { formatBytes } from '@binder/shared'
import { Link } from '@tanstack/react-router'
import { Fragment, type ReactNode, useId, useLayoutEffect, useRef } from 'react'
import { CheckIcon, ChevronRightIcon, MoreIcon } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn, focusRing } from '@/lib/utils'
import { blobUrl } from '../blobs/fetchBlob'
import { useConfirm } from '../shell/useConfirm'
import type {
  DocumentEntry,
  FailedEntry,
  ProcessingEntry,
  ReadyEntry,
  VersionStep,
} from './documentEntries'
import type { UploadTarget } from './UploadDialog'
import { useVersionActions } from './useVersionActions'

export interface DocumentRowProps {
  showId: string
  entry: DocumentEntry
  /** First-page thumbnail blob key of the version shown. */
  thumbKey?: string | null
  /** The version's PDF is stored on this device. */
  cached?: boolean
  /** Items waiting for review on the current version. */
  reviewCount?: number
  /** May upload (an owner or editor of a show that is not archived). */
  canUpload: boolean
  /** Opens the upload dialog for this target; gets the control that was pressed. */
  onUpload: (target: UploadTarget, opener: HTMLElement) => void
  /** The overview's Scripts card: a row in a shared card, no upload action, tappable at phone. */
  compact?: boolean
}

const mono = 'font-mono tabular-nums'
// On the Documents screen the buttons sit on the row's card, and the mockup fills them with
// `--elev` there (`.dx-row .btn`); in the overview's shared card, and on the phone, they keep the
// card fill.
const ACTION = cn(buttonVariants({ variant: 'line', size: 'sm' }), focusRing)
const ROW_ACTION = cn(ACTION, 'md:bg-elev')
const PRIMARY_ACTION = cn(buttonVariants({ variant: 'primary', size: 'sm' }), focusRing)

/**
 * One document on the Documents screen and the overview's Scripts card (DESIGN §8): a thumbnail,
 * the title, its version and page count, status pills and actions. A version still processing
 * shows a progress bar and the steps; a failed one says why. It is a list item; put it in a `ul`.
 *
 * Everything shown comes from the version and page rows: the steps are derived from the version's
 * status and whether the document has caught up to it (see documentEntries), and nothing claims a size or a speed the data does not have.
 */
export function DocumentRow(props: DocumentRowProps) {
  const { entry } = props
  if (entry.kind === 'ready') return <ReadyRow {...props} entry={entry} />
  if (entry.kind === 'processing') return <ProcessingRow {...props} entry={entry} />
  return <FailedRow {...props} entry={entry} />
}

/** The mockup's `.card` row (radius 14, padding 14 16; 16 for a processing or failed one). */
function shell(compact: boolean | undefined, tone: 'ready' | 'busy' | 'failed' = 'ready') {
  if (compact) return 'relative px-4 py-3.5 max-md:min-h-14 max-md:py-2 max-md:pr-2 max-md:pl-3.5'
  return cn(
    'relative rounded-[var(--r)] border-2 bg-card shadow-card',
    tone === 'ready' ? 'p-3.5 md:px-4' : 'p-3.5 md:p-4',
    // `.dx-failed`: the red at 38 % over the outline colour, an alert so it is plain
    tone === 'failed'
      ? 'border-[color-mix(in_srgb,var(--red)_38%,var(--line-2))]'
      : 'border-line-2',
  )
}

/** The mockup's page thumbnail: 44 x 58, radius 3, a 1 px drop line. Hidden at phone. */
function Thumb({
  thumbKey,
  dashed,
  dim,
}: {
  thumbKey?: string | null
  dashed?: boolean
  /** A processing version's document: its current page, quieted (`opacity .45`). */
  dim?: boolean
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-[58px] w-11 shrink-0 items-center justify-center overflow-hidden rounded-[3px] max-md:hidden',
        dashed
          ? 'border-2 border-dashed border-line-2 bg-paper-2'
          : cn(
              'shadow-[0_1px_0_rgba(0,0,0,0.6)]',
              thumbKey ? 'bg-page' : 'bg-paper-2',
              dim && 'opacity-45',
            ),
      )}
    >
      {thumbKey && !dashed && (
        <img
          src={blobUrl(thumbKey)}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          width={44}
          height={58}
        />
      )}
    </span>
  )
}

/** "43 pages" with the number in mono (the mockup's `m()`); version numbers stay in sans. */
const pages = (n: number | null) =>
  n === null ? null : (
    <>
      <span className={mono}>{n}</span> {n === 1 ? 'page' : 'pages'}
    </>
  )

/** The title: Hanken 15 px / 600. */
const NAME = 'm-0 min-w-0 font-sans text-[15px] font-semibold leading-tight text-ink'

function ReadyRow({
  showId,
  entry,
  thumbKey,
  cached,
  reviewCount = 0,
  canUpload,
  onUpload,
  compact,
}: DocumentRowProps & { entry: ReadyEntry }) {
  const { version } = entry
  const reviewLink = (className?: string) => (
    <Link
      to="/shows/$showId/docs/$docId"
      params={{ showId, docId: entry.docId }}
      search={{ review: true }}
      // 44 px to touch on the phone without growing the row: the extra height is negative margin
      className={cn(
        'relative z-10 flex min-h-11 items-center max-md:-my-[13px] md:min-h-0',
        focusRing,
        className,
      )}
    >
      <Badge status="info" size="sm">
        <span>
          <span className={mono}>{reviewCount}</span> to review
        </span>
      </Badge>
    </Link>
  )
  const compare = entry.compare && (
    <Link
      to="/shows/$showId/docs/$docId/compare"
      params={{ showId, docId: entry.docId }}
      className={cn(compact ? ACTION : ROW_ACTION, 'relative z-10', !compact && 'max-md:hidden')}
    >
      Compare v{entry.compare.from} → v{entry.compare.to}
    </Link>
  )
  const uploadNew = canUpload && !compact && (
    <Button
      type="button"
      variant="line"
      size="sm"
      className="relative z-10 md:bg-elev max-md:hidden"
      onClick={(e) =>
        onUpload(
          {
            kind: 'version',
            documentId: entry.docId,
            documentTitle: entry.title || 'document',
          },
          e.currentTarget,
        )
      }
    >
      Upload new version
    </Button>
  )
  return (
    <li className={shell(compact)}>
      <div
        className={cn(
          'flex md:items-center md:gap-4',
          compact ? 'items-center gap-2' : 'flex-col gap-3 md:flex-row',
        )}
      >
        <div className={cn('flex min-w-0 flex-1 items-center', compact ? 'gap-3.5' : 'gap-4')}>
          <Thumb thumbKey={thumbKey} />
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 max-md:justify-between">
              <h3 className={NAME}>
                <Link
                  to="/shows/$showId/docs/$docId"
                  params={{ showId, docId: entry.docId }}
                  className="[overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-[12px] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-red"
                >
                  {entry.title}
                </Link>
              </h3>
              {/* On the overview a review count belongs to the meta line, but the phone's row has
                  it beside the name; the Documents screen has it beside the name everywhere. */}
              {(reviewCount > 0 || cached) && (
                <span className="flex items-center gap-1.5 md:gap-2.5">
                  {reviewCount > 0 && reviewLink(compact ? 'md:hidden' : undefined)}
                  {cached && !compact && (
                    <span className="inline-flex h-5 items-center gap-[5px] rounded-full border border-line-2 pr-2 pl-1.5 text-[11px] leading-none font-medium text-muted md:h-[18px]">
                      <CheckIcon className="size-[11px]" strokeWidth={2.4} />
                      <span className="max-md:hidden">cached on this device</span>
                      <span className="md:hidden">cached</span>
                    </span>
                  )}
                </span>
              )}
            </div>
            <p className="m-0 flex flex-wrap items-center gap-x-1 text-[12px] text-muted">
              <span className="version-status" data-status="ready">
                v{version.number} current
                {version.pageCount !== null && <> · {pages(version.pageCount)}</>}
                {version.searchable && (
                  <span className={cn(compact && 'max-md:hidden')}> · searchable</span>
                )}
              </span>
              {compact && reviewCount > 0 && (
                <>
                  <span aria-hidden className="max-md:hidden">
                    ·
                  </span>
                  {reviewLink('max-md:hidden')}
                </>
              )}
            </p>
            {entry.kept && !compact && (
              <p className="m-0 text-[12px] text-faint">
                v{entry.kept.number} kept
                {entry.kept.pageCount !== null && <> · {pages(entry.kept.pageCount)}</>}
              </p>
            )}
          </div>
        </div>
        <div className={cn('flex items-center gap-2', compact && 'max-md:hidden')}>
          {compact ? (
            <>
              <CueLists showId={showId} className="relative z-10" />
              {compare}
              <Link
                to="/shows/$showId/docs/$docId"
                params={{ showId, docId: entry.docId }}
                // The mockup's "Open" on a script row is the red one (a ruling, R20).
                className={cn(PRIMARY_ACTION, 'relative z-10')}
              >
                Open
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/shows/$showId/docs/$docId"
                params={{ showId, docId: entry.docId }}
                className={cn(ROW_ACTION, 'relative z-10 max-md:flex-1')}
              >
                Open
              </Link>
              <CueLists showId={showId} elev className="relative z-10 max-md:flex-1" />
              {compare}
              {uploadNew}
              {(entry.compare || canUpload) && (
                <PhoneMore
                  showId={showId}
                  entry={entry}
                  canUpload={canUpload}
                  onUpload={onUpload}
                />
              )}
            </>
          )}
        </div>
        {compact && (
          <ChevronRightIcon className="size-5 shrink-0 text-faint md:hidden" aria-hidden />
        )}
      </div>
    </li>
  )
}

function CueLists({
  showId,
  className,
  elev,
}: {
  showId: string
  className?: string
  /** On the Documents screen the button is `--elev`; on the overview's card it is the card fill. */
  elev?: boolean
}) {
  return (
    <Link
      to="/shows/$showId/cues"
      params={{ showId }}
      className={cn(elev ? ROW_ACTION : ACTION, className)}
    >
      Cue lists
    </Link>
  )
}

/**
 * The phone's "..." (the mockup's 44 px button): what the card's row of two buttons has no room
 * for, Compare and Upload new version. Wider screens have those buttons themselves.
 */
function PhoneMore({
  showId,
  entry,
  canUpload,
  onUpload,
}: {
  showId: string
  entry: ReadyEntry
  canUpload: boolean
  onUpload: DocumentRowProps['onUpload']
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={trigger}
          type="button"
          variant="line"
          size="sm"
          aria-label="More actions"
          className="relative z-10 shrink-0 max-md:w-11 max-md:px-0 md:hidden"
        >
          <MoreIcon className="!size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {entry.compare && (
          <DropdownMenuItem asChild className="min-h-11">
            <Link to="/shows/$showId/docs/$docId/compare" params={{ showId, docId: entry.docId }}>
              Compare v{entry.compare.from} → v{entry.compare.to}
            </Link>
          </DropdownMenuItem>
        )}
        {canUpload && (
          <DropdownMenuItem
            className="min-h-11"
            onSelect={() =>
              onUpload(
                {
                  kind: 'version',
                  documentId: entry.docId,
                  documentTitle: entry.title || 'document',
                },
                // the menu closes and focus returns to its trigger; the dialog hands it back there
                trigger.current ?? document.body,
              )
            }
          >
            Upload new version
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** What a processing or failed row is called: the document, and its version number for a new one. */
function Name({ title, versionNumber }: { title: string; versionNumber: number | null }) {
  return (
    <h3 className={cn(NAME, '[overflow-wrap:anywhere]')}>
      {title}
      {versionNumber !== null && <> v{versionNumber}</>}
    </h3>
  )
}

function ProcessingRow({
  showId,
  entry,
  thumbKey,
  canUpload,
  compact,
}: DocumentRowProps & { entry: ProcessingEntry }) {
  const { progress } = entry
  const known = progress !== null && progress.total > 0
  const pct = known ? Math.min(100, Math.round((progress.ready / progress.total) * 100)) : null
  const queued = entry.status === 'queued'
  const reanchoring = entry.status === 'reanchoring'
  const actions = useVersionActions(showId, entry.versionId, entry.status)
  const noteId = useId()
  const name = `${entry.title || 'document'}${entry.versionNumber !== null ? ` v${entry.versionNumber}` : ''}`
  // Cancel stops work that is running; the re-anchoring wait is past that, and a viewer cannot.
  const cancellable = canUpload && entry.canCancel
  return (
    <li className={shell(compact, 'busy')}>
      <div className="flex items-start gap-4 max-md:flex-col max-md:gap-2.5">
        <Thumb thumbKey={thumbKey} dashed={!thumbKey} dim />
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 max-md:w-full">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 max-md:justify-between">
            <Name title={entry.title} versionNumber={entry.versionNumber} />
            <Badge status="neutral" size="sm">
              <span className="version-status" data-status={entry.status}>
                {queued ? 'Queued' : reanchoring ? 'Re-anchoring' : 'Processing'}
              </span>
            </Badge>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-[12.5px] text-muted">
              <span>
                {entry.sizeBytes !== null && !reanchoring && (
                  <>
                    <Size bytes={entry.sizeBytes} />{' '}
                  </>
                )}
                {queued
                  ? entry.sizeBytes !== null
                    ? 'uploaded, waiting to start'
                    : 'Uploaded, waiting to start'
                  : reanchoring
                    ? 'Text is ready, now moving cues across'
                    : entry.sizeBytes !== null
                      ? 'uploaded, now extracting text'
                      : 'Uploaded, now extracting text'}
              </span>
              {pct !== null && <span className={cn(mono, 'shrink-0 text-ink-2')}>{pct} %</span>}
            </div>
            <div
              role="progressbar"
              aria-label={`Processing ${entry.title}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct ?? undefined}
              aria-valuetext={
                known ? `${progress.ready} of ${progress.total} pages` : 'Extracting text'
              }
              className="h-2 w-full overflow-hidden rounded-full border border-line-2 bg-paper"
            >
              <div
                className={cn('h-full rounded-full bg-ink-2', pct === null && 'animate-pulse')}
                style={{ width: `${pct ?? 100}%` }}
              />
            </div>
          </div>
          {!compact && <Steps steps={entry.steps} />}
          {!compact && entry.versionNumber !== null && entry.currentNumber !== null && (
            <p className="m-0 text-[12px] leading-[1.45] text-muted">
              You can keep working on v{entry.currentNumber}. Cues move to v{entry.versionNumber}{' '}
              when it is ready, and anything uncertain goes to review.
            </p>
          )}
        </div>
        {cancellable && (
          // The mockup's ghost Cancel: top right of the card, and under the text on a phone.
          <div className="flex flex-col items-end gap-1 max-md:items-start">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              // the visible word first, then which upload it stops (there can be several rows)
              aria-label={`Cancel ${name}`}
              aria-describedby={!actions.online ? noteId : undefined}
              disabled={!actions.online || actions.busy}
              loading={actions.cancelling}
              onClick={actions.cancel}
            >
              Cancel
            </Button>
            {!actions.online && <NeedsConnection id={noteId} />}
          </div>
        )}
      </div>
    </li>
  )
}

/** "12 MB" in mono (the mockup's `m("12 MB")`); on a phone the unit is sans, as `<span class="mono">12</span> MB`. */
function Size({ bytes }: { bytes: number }) {
  const [value, unit] = formatBytes(bytes).split(' ')
  return (
    <span className={mono}>
      {value}
      <span className="max-md:font-sans"> {unit}</span>
    </span>
  )
}

/** Why a button is greyed offline: cancel, try again and remove are server actions. */
function NeedsConnection({ id, text = 'Needs a connection' }: { id: string; text?: string }) {
  return (
    <span id={id} role="status" className="text-[12px] text-muted">
      {text}
    </span>
  )
}

/** The copy with each "72 dpi" in mono (the mockup's `m("72 dpi")`): a number with its unit. */
function withMonoNumbers(text: string) {
  const nodes: ReactNode[] = []
  let from = 0
  for (const match of text.matchAll(/\d+ dpi/g)) {
    const at = match.index ?? 0
    // each piece is keyed by where it starts in the text, which is stable and unique
    if (at > from) nodes.push(<Fragment key={from}>{text.slice(from, at)}</Fragment>)
    nodes.push(
      <span key={at} className={mono}>
        {match[0]}
      </span>,
    )
    from = at + match[0].length
  }
  if (from < text.length) nodes.push(<Fragment key={from}>{text.slice(from)}</Fragment>)
  return nodes
}

function Steps({ steps }: { steps: VersionStep[] }) {
  return (
    <ol
      aria-label="Processing steps"
      className="m-0 flex list-none flex-wrap items-center gap-x-3.5 gap-y-2 p-0 text-[12.5px] md:gap-0"
    >
      {steps.map((step, i) => (
        <li
          key={step.key}
          aria-current={step.state === 'current' ? 'step' : undefined}
          className={cn(
            'flex items-center gap-1.5 whitespace-nowrap md:gap-[7px]',
            step.state === 'current' && 'font-semibold text-ink',
            step.state === 'done' && 'text-ink-2',
            step.state === 'pending' && 'text-faint',
          )}
        >
          <StepIcon state={step.state} />
          <span>
            {step.label}
            <span className="sr-only">
              {step.state === 'done'
                ? ', done'
                : step.state === 'current'
                  ? ', in progress'
                  : ', waiting'}
            </span>
          </span>
          {i < steps.length - 1 && (
            // `.dx-join`: 28 px rule with 10 px either side (the phone wraps instead)
            <span aria-hidden className="mx-2.5 hidden h-px w-7 shrink-0 bg-line-2 md:block" />
          )}
        </li>
      ))}
    </ol>
  )
}

/** The mockup's `.dx-tick` (a done step) and `.dx-ring` (the rest; the current one has an ink arc). */
function StepIcon({ state }: { state: VersionStep['state'] }) {
  if (state === 'done') {
    return (
      <span
        aria-hidden
        className="grid size-4 shrink-0 place-items-center rounded-full border-2 border-line-2 bg-elev text-ink-2"
      >
        <CheckIcon className="size-[9px]" strokeWidth={3} />
      </span>
    )
  }
  return (
    <span
      aria-hidden
      className={cn(
        'size-4 shrink-0 rounded-full border-2 border-line-2',
        state === 'current' && 'border-t-ink border-r-ink',
      )}
    />
  )
}

function FailedRow({
  showId,
  entry,
  canUpload,
  onUpload,
  compact,
}: DocumentRowProps & { entry: FailedEntry }) {
  const actions = useVersionActions(showId, entry.versionId, entry.code ?? 'legacy')
  const { confirm, dialog } = useConfirm('Remove upload', 'Remove')
  const noteId = useId()
  const row = useRef<HTMLLIElement>(null)
  const removed = useRef(false)
  removed.current = actions.removed
  // A removed row takes its Remove button, and focus with it. Hand focus to the next row's first
  // control, or else to the list, rather than letting it fall to the page. The row is still in
  // the page while its layout cleanup runs.
  useLayoutEffect(
    () => () => {
      const li = row.current
      if (!removed.current || !li) return
      const active = document.activeElement
      if (active !== document.body && !li.contains(active)) return
      const next = li.nextElementSibling?.querySelector<HTMLElement>(
        'a[href], button:not(:disabled)',
      )
      const target = next ?? li.closest<HTMLElement>('ul')
      target?.focus()
    },
    [],
  )
  // A deterministic failure would fail the same way again, so "Try again" asks for another upload.
  // It is always another version of this document: that needs only the document, and when the
  // document has no ready version the new one becomes its current (so no second document is made).
  const target: UploadTarget = {
    kind: 'version',
    documentId: entry.docId,
    documentTitle: entry.title || 'document',
  }
  const name = `${entry.title || 'document'}${entry.versionNumber !== null ? ` v${entry.versionNumber}` : ''}`
  const inPlace = entry.canRetryInPlace
  // Cancelling is the person's own choice, not a fault: it gets the quiet pill and card, no red.
  const cancelled = entry.code === 'cancelled'
  return (
    <li ref={row} className={shell(compact, cancelled ? 'busy' : 'failed')}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Thumb dashed />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <Name title={entry.title} versionNumber={entry.versionNumber} />
              <Badge status={cancelled ? 'neutral' : 'overbooked'} size="sm">
                {!cancelled && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
                <span className="version-status" data-status="failed">
                  {entry.pill}
                </span>
              </Badge>
            </div>
            <p className="m-0 max-w-[640px] text-[12px] text-muted [overflow-wrap:anywhere]">
              {withMonoNumbers(entry.reason)}
            </p>
            {entry.detail && (
              <details className="mt-1 text-[12px] text-muted">
                <summary
                  className={cn(
                    'inline-flex min-h-11 cursor-pointer items-center md:min-h-0',
                    focusRing,
                  )}
                >
                  Details
                </summary>
                <p className="m-0 mt-1 font-mono text-[12px] [overflow-wrap:anywhere]">
                  {entry.detail}
                </p>
              </details>
            )}
          </div>
        </div>
        {canUpload && (
          <div className="flex flex-col items-start gap-1 md:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="line"
                size="sm"
                className="md:bg-elev"
                aria-label={`Try again, ${name}`}
                aria-describedby={inPlace && !actions.online ? noteId : undefined}
                disabled={inPlace && (!actions.online || actions.busy)}
                loading={actions.retrying}
                onClick={(e) => (inPlace ? actions.retry() : onUpload(target, e.currentTarget))}
              >
                Try again
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove ${name}`}
                aria-describedby={!actions.online ? noteId : undefined}
                disabled={!actions.online || actions.busy}
                loading={actions.removing}
                onClick={async () => {
                  const ok = await confirm(
                    `Remove ${name}? The file and its record go. Nothing in the script uses it.`,
                  )
                  if (ok) actions.remove()
                }}
              >
                Remove
              </Button>
            </div>
            {!actions.online && (
              // Try again that opens the upload stays enabled, so the note speaks for Remove alone.
              <NeedsConnection
                id={noteId}
                text={inPlace ? undefined : 'Remove needs a connection'}
              />
            )}
          </div>
        )}
      </div>
      {dialog}
    </li>
  )
}
