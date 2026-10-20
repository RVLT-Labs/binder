import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { SearchPanel } from './SearchPanel'

test('extra B09: search close/results reserve coarse targets and 8px neighbours without losing focus or activation', async () => {
  const close = vi.fn(),
    activate = vi.fn()
  const hits = [0, 1].map((pageIndex) => ({
    pageIndex,
    lineIndex: 0,
    wordStart: 0,
    wordEnd: 1,
    snippet: 'Fixture search hit',
  }))
  render(
    <SearchPanel
      search={async () => hits}
      loading={false}
      unavailable={0}
      hits={hits}
      active={1}
      onResults={vi.fn()}
      onActivate={activate}
      onClose={close}
    />,
  )
  const box = screen.getByRole('searchbox', { name: 'Search document' })
  expect(document.activeElement).toBe(box)
  const closeButton = screen.getByRole('button', { name: 'Close search' })
  expect(closeButton.className).toContain('[@media(pointer:coarse)]:size-11')
  // Keep the approved 32px desktop face within the layout target.
  expect(closeButton.className).toContain('md:before:size-8')
  expect(closeButton.className).toContain('before:pointer-events-none')
  fireEvent.change(box, { target: { value: 'Fixture' } })
  const list = screen.getByRole('list', { name: 'Search results' })
  expect(list.className).toContain('[@media(pointer:coarse)]:space-y-2')
  for (const row of screen.getAllByRole('button', { name: /Page \d/ })) {
    expect(row.className).toContain('[@media(pointer:coarse)]:min-h-11')
    expect(row.className).toContain('[@media(pointer:coarse)]:min-w-11')
  }
  fireEvent.click(screen.getByRole('button', { name: /Page 2/ }))
  expect(activate).toHaveBeenCalledWith(1)
  fireEvent.keyDown(box, { key: 'Escape' })
  fireEvent.click(closeButton)
  expect(close).toHaveBeenCalledTimes(2)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Page 2/ }).getAttribute('aria-current')).toBe(
      'true',
    ),
  )
})
