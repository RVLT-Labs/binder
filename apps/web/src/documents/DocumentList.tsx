import { type DragEvent, useState } from 'react'
import { pushNotice } from '@/components/noticeStore'
import { cn } from '@/lib/utils'
import { DocumentRow } from './DocumentRow'
import { useUpload } from './UploadProvider'
import type { DocumentsData } from './useDocumentEntries'

/**
 * The show's documents as a list named "Documents": ready ones with their versions, and any version
 * still processing or failed in its own row. `compact` is the overview's Scripts card.
 */
export function DocumentRows({
  showId,
  data,
  compact,
}: {
  showId: string
  data: DocumentsData
  compact?: boolean
}) {
  const { canUpload, openUpload } = useUpload()
  const { entries, thumbs, cachedVersions, reviewCounts } = data
  return (
    <ul
      aria-label="Documents"
      className={cn(
        'm-0 list-none p-0',
        compact
          ? 'divide-y divide-line overflow-hidden rounded-[20px] border-2 border-line-2 bg-card shadow-card'
          : 'flex flex-col gap-3',
      )}
    >
      {entries.map((entry) => {
        const versionId = entry.kind === 'ready' ? entry.version.id : null
        return (
          <DocumentRow
            key={entry.key}
            showId={showId}
            entry={entry}
            thumbKey={versionId ? thumbs.get(versionId) : null}
            cached={versionId ? cachedVersions.has(versionId) : false}
            reviewCount={entry.kind === 'ready' ? (reviewCounts.get(entry.docId) ?? 0) : 0}
            canUpload={canUpload}
            compact={compact}
            onUpload={(target, opener) => openUpload(target, { opener })}
          />
        )
      })}
    </ul>
  )
}

/** "2 current · 1 processing · 1 couldn't be processed": only the kinds there are. */
export function documentsSummary(entries: DocumentsData['entries']) {
  const current = entries.filter((e) => e.kind === 'ready').length
  const processing = entries.filter((e) => e.kind === 'processing').length
  const failed = entries.filter((e) => e.kind === 'failed').length
  return [
    current > 0 && { n: current, text: 'current' },
    processing > 0 && { n: processing, text: 'processing' },
    failed > 0 && { n: failed, text: 'couldn’t be processed' },
  ].filter((p): p is { n: number; text: string } => p !== false)
}

/** The Documents screen's body: the list and, for people who can upload, a place to drop a PDF. */
export function DocumentList({ showId, data }: { showId: string; data: DocumentsData }) {
  const { canUpload, openUpload } = useUpload()
  const [over, setOver] = useState(false)
  const isFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  function drop(e: DragEvent) {
    e.preventDefault()
    setOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      pushNotice({ kind: 'error', message: 'Only PDF files can be uploaded.' })
      return
    }
    openUpload({ kind: 'document' }, { file })
  }

  return (
    <div className="flex flex-col gap-3">
      {data.loading ? (
        <p className="m-0 text-muted">Loading…</p>
      ) : data.entries.length === 0 ? (
        <p className="m-0 text-muted">No documents yet.</p>
      ) : (
        <DocumentRows showId={showId} data={data} />
      )}
      {canUpload && (
        // biome-ignore lint/a11y/noStaticElementInteractions: dropping a file is a pointer shortcut; the top bar's Upload document is the keyboard way in
        <div
          onDragOver={(e) => {
            if (!isFiles(e)) return
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          className={cn(
            'rounded-[20px] border-2 border-dashed px-4 py-6 text-center text-[14px] text-muted',
            over ? 'border-ink bg-paper-2 text-ink' : 'border-line-2',
          )}
        >
          Drop a PDF here, or use <span className="font-semibold text-ink-2">Upload document</span>{' '}
          above.
        </div>
      )}
    </div>
  )
}
