import type { VersionText } from '@binder/core'
import type { WordLayer } from '@binder/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('@powersync/react', () => ({
  useQuery: (sql: string) => ({
    data: sql.includes('FROM pages')
      ? [
          { index: 0, width: 600, height: 800 },
          { index: 1, width: 600, height: 800 },
        ]
      : [{ searchable_key: 'k' }],
  }),
}))
vi.mock('../viewer/usePdfDocument', () => ({
  usePdfDocument: () => ({ pdf: {}, status: 'ready', error: null }),
}))
vi.mock('../viewer/PageCanvas', () => ({
  PageCanvas: ({ children }: { children: ReactNode }) => (
    <div className="page-sheet">{children}</div>
  ),
}))
const { ComparePane } = await import('./ComparePane')

const layer: WordLayer = {
  words: [
    { t: 'a', x: 40, y: 700, w: 100, h: 10 },
    { t: 'b', x: 40, y: 686, w: 120, h: 10 },
    { t: 'c', x: 40, y: 600, w: 90, h: 10 },
  ],
  lines: [[0], [1], [2]],
}
const text = { layers: new Map([[0, layer]]) } as unknown as VersionText

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})

const props = {
  side: 'old' as const,
  title: 'Old · v1',
  versionName: 'v1',
  versionId: 'a',
  text,
  pageIndex: 0,
  onPageChange: () => {},
  tint: new Map([[0, [{ lineIndex: 0 }, { lineIndex: 1 }]]]),
  tintedTotal: 16,
}

test('the old side tints the cut lines (`.compare-tint[data-op=removed]`), strikes them and counts the band', () => {
  const { container } = render(<ComparePane {...props} />)
  const tints = container.querySelectorAll('.compare-tint[data-op="removed"]')
  expect(tints).toHaveLength(2)
  // each wash says which line it is on, so a test can tell the line that was cut
  expect(Array.from(tints).map((t) => t.getAttribute('aria-label'))).toEqual(['a', 'b'])
  expect(container.querySelectorAll('line')).toHaveLength(2)
  expect(container.querySelector('text')?.textContent).toBe('−2')
})

test('the new side tints added lines and counts them with a plus; nothing is struck', () => {
  const { container } = render(
    <ComparePane {...props} side="new" title="New · v2" versionName="v2" />,
  )
  expect(container.querySelectorAll('.compare-tint[data-op="added"]')).toHaveLength(2)
  expect(container.querySelectorAll('line')).toHaveLength(0)
  expect(container.querySelector('text')?.textContent).toBe('+2')
})

test('the caption is the version and page in mono, and what is on this page', () => {
  render(<ComparePane {...props} />)
  const caption = screen.getByRole('heading', { name: 'v1 · p.1' })
  expect(caption.className).toContain('font-mono')
  expect(screen.getByText('2 of the 16 cut lines are on this page')).toBeTruthy()
})

test('the new side says how many lines were added on the page', () => {
  render(<ComparePane {...props} side="new" versionName="v2" title="New · v2" tintedTotal={2} />)
  expect(screen.getByText('2 lines added here')).toBeTruthy()
})

test('the pane keeps its accessible name and the page buttons step the page', () => {
  const onPageChange = vi.fn()
  render(<ComparePane {...props} onPageChange={onPageChange} />)
  expect(screen.getByRole('region', { name: 'Old · v1' })).toBeTruthy()
  expect(
    (screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  expect(onPageChange).toHaveBeenCalledWith(1)
})
