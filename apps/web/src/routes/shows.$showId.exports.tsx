import { deptChrome } from '@binder/shared'
import { useQuery } from '@powersync/react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { cn, focusRing } from '@/lib/utils'
import { DownloadAgain, DownloadLocal } from '../exports/DownloadAgain'
import { ExportRow } from '../exports/ExportRow'
import { useExports, useLayerView } from '../exports/useExports'
import { whenParts } from '../exports/when'
import { formatClock } from '../history/time'
import { useOnline } from '../offline/useOnline'
import { SECTION_LABEL, Swatch } from '../panel/fields'
import type { ShowRow } from '../powersync/schema'

export const Route = createFileRoute('/shows/$showId/exports')({ component: ExportsPage })

// The mockup's `.card`: radius 14, a 2px outline, the card shadow.
const card = 'overflow-hidden rounded-[var(--r)] border-2 border-line-2 bg-card shadow-card'

/** "SND" with its swatch and "only", or the footer's words ("All layers", "LX, SND"). */
function Layers({
  label,
  only,
}: {
  label: string
  only: { code: string; colour: string | null } | null
}) {
  if (!only) return <span>{label}</span>
  return (
    <>
      <span className="inline-flex items-center gap-[5px] font-semibold text-ink-2">
        {only.colour && <Swatch colour={deptChrome(only.colour)} />}
        {only.code}
      </span>
      <span>only</span>
    </>
  )
}

function When({ iso }: { iso: string }) {
  return (
    <span>
      {whenParts(iso).map((p) => (
        <span key={p.text} className={cn(p.mono && 'font-mono tabular-nums')}>
          {p.text}
        </span>
      ))}
    </span>
  )
}

const Dot = () => <span aria-hidden>·</span>

/**
 * The show's exports, newest first: each with "Download again" (the stored file, saved rather than
 * opened) and "What changed since this" (the activity feed from the moment it was made). Exports
 * made offline are listed as waiting until their upload goes through.
 */
function ExportsPage() {
  const { showId } = Route.useParams()
  const { records, pending } = useExports(showId)
  const layerView = useLayerView(showId)
  const online = useOnline()
  const { data: shows } = useQuery<Pick<ShowRow, 'title'>>('SELECT title FROM shows WHERE id = ?', [
    showId,
  ])
  const empty = records.length === 0 && pending.length === 0

  return (
    // The mockup's page padding is 24 32 and the shell's 28 32, so the top and bottom give 4 back.
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3.5 md:-my-1">
      <header>
        <p className="t-over m-0 truncate max-md:sr-only">{shows[0]?.title}</p>
        <h1 className="t-page-title m-0 max-md:sr-only">Exports</h1>
        <p className="m-0 mt-1 text-[13px] text-muted">
          {empty
            ? 'No exports yet. Use Print in a document, or Export on a cue list, to make one.'
            : 'Make one with Print in a document, or Export on a cue list.'}
        </p>
      </header>
      {pending.length > 0 && (
        <section aria-label="Waiting to upload" className="flex flex-col gap-3.5">
          <h2 className={cn(SECTION_LABEL, 'mt-2')}>Waiting to upload</h2>
          <ul className={cn(card, 'm-0 list-none p-0')}>
            {pending.map((p) => {
              const view = layerView(JSON.stringify(p.meta.layerSelection))
              return (
                <ExportRow
                  key={p.id}
                  data-pending="true"
                  filename={p.meta.filename}
                  meta={
                    <>
                      <Badge status="neutral" size="sm">
                        <span aria-hidden className="size-1.5 rounded-full bg-current" />
                        Waiting to upload
                      </Badge>
                      <Layers {...view} />
                      <span className="font-mono tabular-nums">
                        {formatClock(p.meta.createdAt)}
                      </span>
                      <Dot />
                      <span>
                        {online
                          ? 'Downloaded to this device. Binder is recording it now.'
                          : 'Downloaded to this device. Binder records it when you are back online.'}
                      </span>
                    </>
                  }
                  actions={
                    <DownloadLocal
                      bytes={p.bytes}
                      contentType={p.contentType}
                      filename={p.meta.filename}
                    />
                  }
                />
              )
            })}
          </ul>
        </section>
      )}
      {records.length > 0 && (
        <section aria-label="Made with Binder" className="flex flex-col gap-3.5">
          <h2 className={cn(SECTION_LABEL, 'mt-2')}>
            <span>
              Made with Binder <span className="font-normal text-faint">· newest first</span>
            </span>
          </h2>
          <ul className={cn(card, 'm-0 list-none p-0')} aria-label="Exports">
            {records.map((r) => {
              const view = layerView(r.layer_selection)
              return (
                <ExportRow
                  key={r.id}
                  data-export-id={r.id}
                  filename={r.filename ?? 'export'}
                  meta={
                    <>
                      <Layers {...view} />
                      {r.created_at && (
                        <>
                          <Dot />
                          <When iso={r.created_at} />
                        </>
                      )}
                      {r.private_to && (
                        <Badge status="neutral" size="sm">
                          Only you
                        </Badge>
                      )}
                    </>
                  }
                  actions={
                    <>
                      {r.file_key && (
                        <DownloadAgain fileKey={r.file_key} filename={r.filename ?? 'export.pdf'} />
                      )}
                      {r.created_at && (
                        <Link
                          to="/shows/$showId/activity"
                          params={{ showId }}
                          search={{ from: r.created_at }}
                          className={cn(
                            'inline-flex items-center rounded-[6px] text-[12.5px] font-semibold text-blue hover:underline max-md:min-h-11',
                            focusRing,
                          )}
                        >
                          What changed since this
                        </Link>
                      )}
                    </>
                  }
                />
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
