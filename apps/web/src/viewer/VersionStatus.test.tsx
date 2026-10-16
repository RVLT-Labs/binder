import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { DocumentVersionRow } from '../powersync/schema'
import { VersionStatus } from './VersionStatus'

const version = (over: Partial<DocumentVersionRow>): DocumentVersionRow =>
  ({
    id: 'v1',
    document_id: 'd1',
    version_number: 2,
    label: 'Rehearsal cuts',
    status: 'failed',
    error: null,
    failure_code: null,
    failure_dpi: null,
    ...over,
  }) as DocumentVersionRow

test('a failed version reads as the document rows do, with the raw error behind Details', () => {
  render(
    <VersionStatus
      version={version({
        failure_code: 'low_resolution',
        failure_dpi: 72,
        error: 'No text could be read from the document (ocrmypdf exit 2: boom; median 72 dpi)',
      })}
    />,
  )
  const status = screen.getByRole('status')
  expect(status.textContent).toContain('Version 2 · Rehearsal cuts')
  expect(status.textContent).toContain('Scanned at 72 dpi')
  // The raw text is only in the disclosure, never in the sentence.
  const details = status.querySelector('details') as HTMLElement
  expect(details.textContent).toMatch(/ocrmypdf exit 2: boom/)
  expect(status.querySelector('p')?.textContent).not.toMatch(/ocrmypdf/)
})

test('a cancelled version shows the cancelled copy and no Details', () => {
  render(<VersionStatus version={version({ failure_code: 'cancelled', error: 'Cancelled' })} />)
  const status = screen.getByRole('status')
  expect(status.textContent).toMatch(/Cancelled\. The file is still here/)
  expect(status.querySelector('details')).toBeNull()
})

test('a legacy failure with no code still shows its plain sentence and the tool output behind Details', () => {
  render(
    <VersionStatus
      version={version({ error: 'This file could not be read as a PDF. (pdfinfo: bad xref)' })}
    />,
  )
  const status = screen.getByRole('status')
  expect(status.textContent).toContain('This file could not be read as a PDF.')
  expect(status.querySelector('p')?.textContent).not.toMatch(/pdfinfo/)
  expect(status.querySelector('details')?.textContent).toMatch(/pdfinfo: bad xref/)
})

test('queued and processing keep their one-line status', () => {
  const { rerender } = render(<VersionStatus version={version({ status: 'processing' })} />)
  expect(screen.getByRole('status').textContent).toBe('Version 2 · Rehearsal cuts is processing…')
  rerender(<VersionStatus version={version({ status: 'queued' })} />)
  expect(screen.getByRole('status').textContent).toBe(
    'Version 2 · Rehearsal cuts is queued for processing.',
  )
})
