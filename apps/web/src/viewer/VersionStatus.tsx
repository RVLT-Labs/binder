import { failureWords } from '../documents/documentEntries'
import type { DocumentVersionRow } from '../powersync/schema'

function versionName(v: DocumentVersionRow): string {
  return `Version ${v.version_number}${v.label ? ` · ${v.label}` : ''}`
}

/**
 * What the viewer says in place of a version that has no pages: queued, processing, or failed. A
 * failure reads as the Documents rows do (the coded plain-language reason), with the pipeline's raw
 * text behind a Details disclosure rather than in the sentence.
 */
export function VersionStatus({ version }: { version: DocumentVersionRow }) {
  const name = versionName(version)
  if (version.status === 'failed') {
    const { reason, detail } = failureWords(version)
    return (
      <div role="status" className="viewer-message p-6 text-ink-2" data-status="failed">
        <p className="m-0">
          {name}: {reason}
        </p>
        {detail && (
          <details className="mt-2 text-[13px] text-muted">
            <summary className="inline-flex min-h-11 cursor-pointer items-center">Details</summary>
            <p className="m-0 mt-1 font-mono text-[12px] [overflow-wrap:anywhere]">{detail}</p>
          </details>
        )}
      </div>
    )
  }
  return (
    <p role="status" className="viewer-message p-6 text-ink-2" data-status={version.status}>
      {version.status === 'processing'
        ? `${name} is processing…`
        : `${name} is queued for processing.`}
    </p>
  )
}
