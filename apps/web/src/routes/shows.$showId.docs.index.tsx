import { useQuery } from '@powersync/react'
import { createFileRoute } from '@tanstack/react-router'
import { DocumentList, documentsSummary } from '../documents/DocumentList'
import { useDocumentEntries } from '../documents/useDocumentEntries'
import type { ShowRow } from '../powersync/schema'

export const Route = createFileRoute('/shows/$showId/docs/')({ component: DocumentsPage })

/** The Documents screen (DESIGN §6): every document with its versions, processing and failures. */
function DocumentsPage() {
  const { showId } = Route.useParams()
  const { data: shows } = useQuery<Pick<ShowRow, 'title'>>('SELECT title FROM shows WHERE id = ?', [
    showId,
  ])
  const data = useDocumentEntries(showId)
  const summary = documentsSummary(data.entries)
  return (
    // The mockup's page padding is 24 32 and the shell's 28 32, so the top and bottom give 4 back.
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 md:-my-1">
      <header className="flex items-end justify-between gap-x-6 gap-y-1 md:mb-1.5">
        <div className="min-w-0 max-md:sr-only">
          <p className="t-over m-0 truncate">{shows[0]?.title}</p>
          <h1 className="t-title m-0">Documents</h1>
        </div>
        {summary.length > 0 && (
          <p className="m-0 text-[12px] text-muted">
            {summary.map((part, i) => (
              <span key={part.text}>
                {i > 0 && ' · '}
                <span className="font-mono tabular-nums">{part.n}</span> {part.text}
              </span>
            ))}
          </p>
        )}
      </header>
      <DocumentList showId={showId} data={data} />
    </div>
  )
}
