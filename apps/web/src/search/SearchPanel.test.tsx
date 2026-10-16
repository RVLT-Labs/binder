import type { DocHit } from '@binder/core'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { SearchPanel } from './SearchPanel'

const hit = (pageIndex: number, snippet: string): DocHit => ({
  pageIndex,
  lineIndex: 0,
  wordStart: 0,
  wordEnd: 0,
  snippet,
})
const HITS = [hit(2, 'the Pirate King'), hit(4, 'pirate ship ahoy'), hit(9, 'a pirate')]

/** Holds the hits and active index the way the viewer does. */
function Harness({
  search,
  onActivate,
  loading = false,
  unavailable = 0,
}: {
  search: (q: string) => Promise<DocHit[]>
  onActivate: (hit: DocHit) => void
  loading?: boolean
  unavailable?: number
}) {
  const [hits, setHits] = useState<DocHit[]>([])
  const [active, setActive] = useState<number | null>(null)
  return (
    <SearchPanel
      search={search}
      loading={loading}
      unavailable={unavailable}
      hits={hits}
      active={active}
      onResults={(h, jump) => {
        setHits(h)
        setActive(jump && h.length > 0 ? 0 : null)
        if (jump && h.length > 0) onActivate(h[0])
      }}
      onActivate={(i) => {
        setActive(i)
        onActivate(hits[i])
      }}
    />
  )
}

async function typeQuery(text: string) {
  const box = screen.getByRole('searchbox', { name: 'Search document' })
  fireEvent.change(box, { target: { value: text } })
  return box
}

test('lists hits with page number and snippet', async () => {
  const search = vi.fn(async () => HITS)
  render(<Harness search={search} onActivate={() => {}} />)
  await typeQuery('pirate')
  const list = await screen.findByRole('list', { name: 'Search results' })
  const items = within(list).getAllByRole('listitem')
  expect(items).toHaveLength(3)
  expect(items[0].textContent).toContain('Page 3')
  expect(items[0].textContent).toContain('the Pirate King')
  expect(items[2].textContent).toContain('Page 10')
  expect(search).toHaveBeenCalledWith('pirate')
  expect(screen.getByRole('status').textContent).toContain('3 results')
})

test('Enter goes to the next hit and wraps around', async () => {
  const onActivate = vi.fn()
  render(<Harness search={async () => HITS} onActivate={onActivate} />)
  const box = await typeQuery('pirate')
  await screen.findByRole('list', { name: 'Search results' })
  for (const expected of [HITS[0], HITS[1], HITS[2], HITS[0]]) {
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(onActivate).toHaveBeenLastCalledWith(expected))
  }
})

test('Enter before the typed query has results searches now and jumps to the first hit', async () => {
  const onActivate = vi.fn()
  render(<Harness search={async () => HITS} onActivate={onActivate} />)
  const box = await typeQuery('pirate')
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(onActivate).toHaveBeenCalledWith(HITS[0]))
})

test('clicking a hit activates it and marks it current', async () => {
  const onActivate = vi.fn()
  render(<Harness search={async () => HITS} onActivate={onActivate} />)
  await typeQuery('pirate')
  const second = await screen.findByRole('button', { name: /Page 5/ })
  fireEvent.click(second)
  expect(onActivate).toHaveBeenCalledWith(HITS[1])
  expect(second.getAttribute('aria-current')).toBe('true')
})

test('says so when nothing matches, and clears results for an empty query', async () => {
  const search = vi.fn(async (q: string) => (q === 'zzz' ? [] : HITS))
  render(<Harness search={search} onActivate={() => {}} />)
  await typeQuery('zzz')
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('No results'))
  await typeQuery('pirate')
  await screen.findByRole('list', { name: 'Search results' })
  await typeQuery('')
  await waitFor(() => expect(screen.queryByRole('list', { name: 'Search results' })).toBeNull())
  expect(search).not.toHaveBeenCalledWith('')
})

test('a slow earlier search never overwrites a later one', async () => {
  let release!: (hits: DocHit[]) => void
  const search = vi.fn((q: string) =>
    q === 'pi' ? new Promise<DocHit[]>((r) => (release = r)) : Promise.resolve([hit(0, 'pirate')]),
  )
  render(<Harness search={search} onActivate={() => {}} />)
  const box = await typeQuery('pi')
  fireEvent.keyDown(box, { key: 'Enter' })
  await typeQuery('pirate')
  fireEvent.keyDown(box, { key: 'Enter' })
  await screen.findByRole('list', { name: 'Search results' })
  release([hit(7, 'pi stale')])
  await new Promise((r) => setTimeout(r, 20))
  expect(screen.getByRole('list', { name: 'Search results' }).textContent).not.toContain('pi stale')
})

test('shows that words are loading and how many pages cannot be searched', async () => {
  render(<Harness search={async () => []} onActivate={() => {}} loading unavailable={2} />)
  expect(screen.getByText(/Loading the document text/)).not.toBeNull()
  expect(screen.getByText(/2 pages could not be searched/)).not.toBeNull()
})

test('a search that fails shows an error', async () => {
  render(
    <Harness
      search={async () => {
        throw new Error('db closed')
      }}
      onActivate={() => {}}
    />,
  )
  await typeQuery('pirate')
  expect((await screen.findByRole('alert')).textContent).toContain('db closed')
})

test('the box has the cursor when the card opens, and Escape closes the card without the markup keys seeing it', () => {
  const onClose = vi.fn()
  render(
    <SearchPanel
      search={async () => []}
      loading={false}
      unavailable={0}
      hits={[]}
      active={null}
      onResults={() => {}}
      onActivate={() => {}}
      onClose={onClose}
    />,
  )
  const box = screen.getByRole('searchbox', { name: 'Search document' })
  expect(document.activeElement).toBe(box)
  const escapeKey = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  box.dispatchEvent(escapeKey)
  expect(onClose).toHaveBeenCalledTimes(1)
  // handled here: the viewer's Escape-deselects shortcut skips an event that is already prevented
  expect(escapeKey.defaultPrevented).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
  expect(onClose).toHaveBeenCalledTimes(2)
})
