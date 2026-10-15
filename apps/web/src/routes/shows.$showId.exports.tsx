import { createFileRoute, Link } from '@tanstack/react-router'
import { DownloadAgain } from '../exports/DownloadAgain'
import { useExports, useLayerLabeller } from '../exports/useExports'
import { formatWhen } from '../history/time'
import { useOnline } from '../offline/useOnline'

export const Route = createFileRoute('/shows/$showId/exports')({ component: ExportsPage })

/**
 * The show's exports, newest first: each with "Download again" (the stored file, saved rather than
 * opened) and "What changed since this" (the activity feed from the moment it was made). Exports
 * made offline are listed as waiting until their upload goes through.
 */
function ExportsPage() {
  const { showId } = Route.useParams()
  const { records, pending } = useExports(showId)
  const labelOf = useLayerLabeller(showId)
  const online = useOnline()

  return (
    <>
      <h1>Exports</h1>
      {pending.length > 0 && (
        <section aria-label="Waiting to upload">
          <h2>Waiting to upload</h2>
          <p className="muted">
            These were downloaded to this device.{' '}
            {online
              ? 'Binder is recording them now.'
              : 'They are recorded when you are back online.'}
          </p>
          <ul className="export-list">
            {pending.map((p) => (
              <li key={p.id} className="export-row" data-pending="true">
                <span className="export-name">{p.meta.filename}</span>
                <span className="muted">{formatWhen(p.meta.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {records.length === 0 && pending.length === 0 ? (
        <p className="muted">
          No exports yet. Use Print in a document, or Export on a cue list, to make one.
        </p>
      ) : (
        <ul className="export-list" aria-label="Exports">
          {records.map((r) => (
            <li key={r.id} className="export-row" data-export-id={r.id}>
              <div>
                <span className="export-name">{r.filename}</span>
                <div className="muted">
                  {labelOf(r.layer_selection)} · {r.created_at ? formatWhen(r.created_at) : ''}
                  {r.private_to ? ' · Only you' : ''}
                </div>
              </div>
              <div className="export-actions">
                {r.file_key && (
                  <DownloadAgain fileKey={r.file_key} filename={r.filename ?? 'export.pdf'} />
                )}
                {r.created_at && (
                  <Link
                    to="/shows/$showId/activity"
                    params={{ showId }}
                    search={{ from: r.created_at }}
                  >
                    What changed since this
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
