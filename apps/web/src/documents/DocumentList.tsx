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
  const { thumbs, cachedVersions, reviewCounts } = data
  // The overview's Scripts card lists the scripts that are ready; what is still processing or
  // could not be read is on the Documents screen (and a failure is in Needs you).
  const entries = compact ? data.entries.filter((e) => e.kind === 'ready') : data.entries
  // A version being processed shows its document's current page, quieted.
  const readyThumb = (docId: string) => {
    const ready = data.entries.find((e) => e.kind === 'ready' && e.docId === docId)
    return ready?.kind === 'ready' ? thumbs.get(ready.version.id) : null
  }
  return (
    <ul
      aria-label="Documents"
      // focusable by script only: where focus goes when the last row it held is removed
      tabIndex={-1}
      className={cn(
        'm-0 list-none p-0 focus:outline-none',
        compact
          ? 'divide-y divide-line overflow-hidden rounded-[var(--r)] border-2 border-line-2 bg-card shadow-card'
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
            thumbKey={
              versionId
                ? thumbs.get(versionId)
                : entry.kind === 'processing'
                  ? readyThumb(entry.docId)
                  : null
            }
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

/** Failures that are about the file itself: the mockup's "couldn’t be read". */
const UNREADABLE = new Set(['unreadable', 'password_protected', 'no_text', 'low_resolution'])

/**
 * "2 current · 1 processing · 1 couldn’t be read": only the kinds there are. A failure that is not
 * about the file (cancelled, timed out, did not start) is counted apart as "didn’t finish".
 */
export function documentsSummary(entries: DocumentsData['entries']) {
  const current = entries.filter((e) => e.kind === 'ready').length
  const processing = entries.filter((e) => e.kind === 'processing').length
  const failed = entries.filter((e) => e.kind === 'failed')
  const unread = failed.filter((e) => e.code !== null && UNREADABLE.has(e.code)).length
  return [
    current > 0 && { n: current, text: 'current' },
    processing > 0 && { n: processing, text: 'processing' },
    unread > 0 && { n: unread, text: 'couldn’t be read' },
    failed.length - unread > 0 && { n: failed.length - unread, text: 'didn’t finish' },
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
            // `.ghost-card.dx-drop`: dashed, 56 px, 13 px. A phone has nothing to drag from.
            'flex h-14 items-center justify-center gap-2.5 rounded-[var(--r)] border-2 border-dashed text-[13px] text-muted max-md:hidden',
            over ? 'border-ink bg-paper-2 text-ink' : 'border-line-2',
          )}
        >
          <span>
            Drop a PDF here, or use{' '}
            <span className="font-semibold text-ink-2">Upload document</span>
          </span>
        </div>
      )}
    </div>
  )
}
