import { Link } from '@tanstack/react-router'
import { Check, ChevronRight, Circle, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn, focusRing } from '@/lib/utils'
import { blobUrl } from '../blobs/fetchBlob'
import type {
  DocumentEntry,
  FailedEntry,
  ProcessingEntry,
  ReadyEntry,
  VersionStep,
} from './documentEntries'
import type { UploadTarget } from './UploadDialog'

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
const ACTION = cn(buttonVariants({ variant: 'line', size: 'sm' }), focusRing)

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

function shell(compact: boolean | undefined, failed = false) {
  return compact
    ? 'relative px-4 py-3.5'
    : cn(
        'relative rounded-[20px] border-2 bg-card p-4 shadow-card',
        failed ? 'border-t-out' : 'border-line-2',
      )
}

function Thumb({ thumbKey, dashed }: { thumbKey?: string | null; dashed?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[3px]',
        dashed ? 'border-2 border-dashed border-line-2' : thumbKey ? 'bg-page' : 'bg-paper-2',
      )}
    >
      {thumbKey && !dashed && (
        <img
          src={blobUrl(thumbKey)}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          width={40}
          height={56}
        />
      )}
    </span>
  )
}

const pages = (n: number | null) =>
  n === null ? null : (
    <>
      <span className={mono}>{n}</span> {n === 1 ? 'page' : 'pages'}
    </>
  )

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
  return (
    <li className={shell(compact)}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <Thumb thumbKey={thumbKey} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <h3 className="m-0 min-w-0 font-display text-[17px] font-extrabold leading-tight text-ink">
                <Link
                  to="/shows/$showId/docs/$docId"
                  params={{ showId, docId: entry.docId }}
                  className="[overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-[18px] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-red"
                >
                  {entry.title}
                </Link>
              </h3>
              {reviewCount > 0 && (
                <Link
                  to="/shows/$showId/docs/$docId"
                  params={{ showId, docId: entry.docId }}
                  search={{ review: true }}
                  className={cn('relative z-10 flex min-h-11 items-center md:min-h-0', focusRing)}
                >
                  <Badge status="info">
                    <span>
                      <span className={mono}>{reviewCount}</span> to review
                    </span>
                  </Badge>
                </Link>
              )}
              {cached && (
                <span className="inline-flex items-center gap-1 rounded-full border border-line-2 px-2.5 py-1 text-[11px] leading-none text-muted">
                  <Check className="size-3" strokeWidth={2} aria-hidden />
                  cached on this device
                </span>
              )}
            </div>
            <p className="m-0 mt-1 text-[13px] text-muted">
              <span className="version-status" data-status="ready">
                <span className={mono}>v{version.number}</span> current
                {version.pageCount !== null && <> · {pages(version.pageCount)}</>}
                {version.searchable && ' · searchable'}
              </span>
            </p>
            {entry.kept && (
              <p className="m-0 text-[13px] text-faint">
                <span className={mono}>v{entry.kept.number}</span> kept
                {entry.kept.pageCount !== null && <> · {pages(entry.kept.pageCount)}</>}
              </p>
            )}
          </div>
        </div>
        <div className={cn('flex flex-wrap items-center gap-2', compact && 'max-md:hidden')}>
          <Link
            to="/shows/$showId/docs/$docId"
            params={{ showId, docId: entry.docId }}
            className={cn(ACTION, 'relative z-10')}
          >
            Open
          </Link>
          <Link
            to="/shows/$showId/cues"
            params={{ showId }}
            className={cn(ACTION, 'relative z-10')}
          >
            Cue lists
          </Link>
          {entry.compare && (
            <Link
              to="/shows/$showId/docs/$docId/compare"
              params={{ showId, docId: entry.docId }}
              className={cn(ACTION, 'relative z-10')}
            >
              Compare <span className={mono}>v{entry.compare.from}</span> →{' '}
              <span className={mono}>v{entry.compare.to}</span>
            </Link>
          )}
          {canUpload && !compact && (
            <Button
              type="button"
              variant="line"
              size="sm"
              className="relative z-10"
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
              New version
            </Button>
          )}
        </div>
        {compact && (
          <ChevronRight
            className="absolute top-1/2 right-4 size-5 -translate-y-1/2 text-muted md:hidden"
            aria-hidden
          />
        )}
      </div>
    </li>
  )
}

/** What a processing or failed row is called: the document, and its version number for a new one. */
function Name({ title, versionNumber }: { title: string; versionNumber: number | null }) {
  return (
    <h3 className="m-0 min-w-0 font-display text-[17px] font-extrabold leading-tight text-ink [overflow-wrap:anywhere]">
      {title}
      {versionNumber !== null && (
        <>
          {' '}
          <span className={mono}>v{versionNumber}</span>
        </>
      )}
    </h3>
  )
}

function ProcessingRow({ entry, compact }: DocumentRowProps & { entry: ProcessingEntry }) {
  const { progress } = entry
  const known = progress !== null && progress.total > 0
  const pct = known ? Math.min(100, Math.round((progress.ready / progress.total) * 100)) : null
  const queued = entry.status === 'queued'
  const reanchoring = entry.status === 'reanchoring'
  return (
    <li className={shell(compact)}>
      <div className="flex items-start gap-4">
        <Thumb dashed />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Name title={entry.title} versionNumber={entry.versionNumber} />
            <Badge status="neutral">
              <span className="version-status" data-status={entry.status}>
                {queued ? 'Queued' : reanchoring ? 'Re-anchoring' : 'Processing'}
              </span>
            </Badge>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3 text-[13px] text-muted">
            <span>
              {queued
                ? 'Uploaded, waiting to start'
                : reanchoring
                  ? 'Text is ready, now moving cues across'
                  : 'Uploaded, now extracting text'}
            </span>
            {known && (
              <span className={cn(mono, 'shrink-0')}>
                {progress.ready} of {progress.total} pages
              </span>
            )}
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
            className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-paper-2"
          >
            <div
              className={cn('h-full rounded-full bg-ink-2', pct === null && 'animate-pulse')}
              style={{ width: `${pct ?? 100}%` }}
            />
          </div>
          {!compact && <Steps steps={entry.steps} />}
          {!compact && entry.versionNumber !== null && entry.currentNumber !== null && (
            <p className="m-0 mt-3 text-[13px] text-muted">
              You can keep working on <span className={mono}>v{entry.currentNumber}</span>. Cues
              move to <span className={mono}>v{entry.versionNumber}</span> when it is ready, and
              anything uncertain goes to review.
            </p>
          )}
        </div>
      </div>
    </li>
  )
}

function Steps({ steps }: { steps: VersionStep[] }) {
  return (
    <ol
      aria-label="Processing steps"
      className="m-0 mt-3 flex list-none flex-wrap items-center gap-x-2 gap-y-1.5 p-0 text-[13px]"
    >
      {steps.map((step, i) => (
        <li
          key={step.key}
          aria-current={step.state === 'current' ? 'step' : undefined}
          className={cn(
            'flex items-center gap-2',
            step.state === 'current' ? 'font-bold text-ink' : 'text-ink-2',
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
            <span aria-hidden className="ml-1 hidden h-px w-5 bg-line-2 sm:block" />
          )}
        </li>
      ))}
    </ol>
  )
}

function StepIcon({ state }: { state: VersionStep['state'] }) {
  const cls = 'size-4 shrink-0'
  if (state === 'done')
    return <Check className={cn(cls, 'text-ink-2')} strokeWidth={2.2} aria-hidden />
  if (state === 'current')
    return <Loader2 className={cn(cls, 'animate-spin')} strokeWidth={2.2} aria-hidden />
  return <Circle className={cls} strokeWidth={1.8} aria-hidden />
}

function FailedRow({
  entry,
  canUpload,
  onUpload,
  compact,
}: DocumentRowProps & { entry: FailedEntry }) {
  // There is no retry or remove for a version, so the way forward is another upload: another
  // version of the document when it already had one, otherwise a new document.
  const target: UploadTarget = entry.isNewVersion
    ? { kind: 'version', documentId: entry.docId, documentTitle: entry.title || 'document' }
    : { kind: 'document' }
  return (
    <li className={shell(compact, true)}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <Thumb dashed />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Name title={entry.title} versionNumber={entry.versionNumber} />
              <Badge status="overbooked">
                <span aria-hidden className="size-1.5 rounded-full bg-current" />
                <span className="version-status" data-status="failed">
                  Couldn’t be processed
                </span>
              </Badge>
            </div>
            <p className="m-0 mt-1 text-[13px] text-ink-2 [overflow-wrap:anywhere]">
              {entry.reason}
            </p>
          </div>
        </div>
        {canUpload && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="line"
              size="sm"
              onClick={(e) => onUpload(target, e.currentTarget)}
            >
              Upload again
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}
