import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { ExportRow } from './ExportRow'

test('a row has the file-type tile, the file name in mono, the meta line and the actions', () => {
  const { container } = render(
    <ul>
      <ExportRow
        data-export-id="e1"
        filename="songs-libretto-v2-LX.pdf"
        meta={<span>LX only</span>}
        actions={<button type="button">Download again</button>}
      />
    </ul>,
  )
  const row = container.querySelector('li') as HTMLElement
  expect(row.getAttribute('data-export-id')).toBe('e1')
  const tile = row.querySelector('.export-tile') as HTMLElement
  expect(tile.textContent).toBe('PDF')
  expect(tile.className).toContain('font-mono')
  expect(tile.className).toContain('border-line-2')
  const name = row.querySelector('.export-name') as HTMLElement
  expect(name.textContent).toBe('songs-libretto-v2-LX.pdf')
  expect(name.className).toContain('font-mono')
  expect(name.className).toContain('tabular-nums')
  expect(screen.getByText('LX only')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Download again' })).toBeTruthy()
})

test('a long file name wraps instead of widening the row', () => {
  const { container } = render(
    <ul>
      <ExportRow filename={`${'very-long-name-'.repeat(8)}.pdf`} meta={null} actions={null} />
    </ul>,
  )
  const name = container.querySelector('.export-name') as HTMLElement
  expect(name.className).toContain('break-all')
})
