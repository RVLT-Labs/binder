import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { expect, test, vi } from 'vitest'
import { DocumentRow } from '../documents/DocumentRow'
import type {
  DocumentEntry,
  FailedEntry,
  ProcessingEntry,
  ReadyEntry,
} from '../documents/documentEntries'
import { DepartmentCards } from './DepartmentCards'
import { NeedsYou } from './NeedsYou'
import { OfflineLine } from './OfflineCard'
import { RecentActivity } from './RecentActivity'

const online = vi.hoisted(() => ({ value: true }))
const activity = vi.hoisted(() => ({
  state: {
    isPending: false,
    isError: false,
    data: undefined as unknown,
  },
}))
vi.mock('../offline/useOnline', () => ({ useOnline: () => online.value }))
vi.mock('../history/api', () => ({ useActivity: () => activity.state }))

/** Renders `ui` where links resolve (any path), and waits for it. */
async function renderInRouter(ui: ReactElement) {
  const root = createRootRoute({ component: () => ui })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/' }),
      createRoute({ getParentRoute: () => root, path: '$' }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const view = render(<RouterProvider router={router} />)
  await waitFor(() => expect(view.container.innerHTML).not.toBe(''))
  return view
}

const href = (el: HTMLElement) => el.getAttribute('href') ?? ''
/** The text of each list item: its sentence, then its link. */
const items = () => screen.getAllByRole('listitem').map((li) => li.textContent)

// ---------------------------------------------------------------------------------------------
// Needs you

test('Needs you lists the cues to review after a revision, with a Review link to that document', async () => {
  await renderInRouter(
    <NeedsYou showId="s1" review={{ count: 4, documentId: 'd1' }} duplicates={[]} />,
  )
  expect(screen.getByRole('heading', { name: 'Needs you' })).toBeTruthy()
  expect(items()).toEqual(['4 cues to review after the revisionReview'])
  const review = screen.getByRole('link', { name: 'Review' })
  expect(href(review)).toContain('/shows/s1/docs/d1')
  expect(href(review)).toContain('review=true')
})

test('says "1 cue" for one', async () => {
  await renderInRouter(
    <NeedsYou showId="s1" review={{ count: 1, documentId: 'd1' }} duplicates={[]} />,
  )
  expect(items()).toEqual(['1 cue to review after the revisionReview'])
})

test('Needs you lists a department with duplicate numbers, with a Fix link to its filtered cue list', async () => {
  await renderInRouter(
    <NeedsYou
      showId="s1"
      review={null}
      duplicates={[
        { departmentId: 'lx', code: 'LX', numbers: 2 },
        { departmentId: 'snd', code: 'SND', numbers: 1 },
      ]}
    />,
  )
  expect(items()).toEqual(['LX has 2 duplicate numbersFix', 'SND has 1 duplicate numberFix'])
  const fixes = screen.getAllByRole('link', { name: 'Fix' })
  expect(fixes).toHaveLength(2)
  expect(href(fixes[0])).toContain('/shows/s1/cues')
  expect(href(fixes[0])).toContain('department=lx')
  expect(href(fixes[0])).toContain('duplicates=true')
  // No review item when nothing is waiting.
  expect(screen.queryByRole('link', { name: 'Review' })).toBeNull()
})

test('Needs you draws nothing when there is nothing to do', async () => {
  const { container } = await renderInRouter(
    <div data-testid="host">
      <NeedsYou showId="s1" review={null} duplicates={[]} />
    </div>,
  )
  expect(screen.queryByRole('heading', { name: 'Needs you' })).toBeNull()
  expect(container.querySelector('[data-testid="host"]')?.children).toHaveLength(0)
})

// ---------------------------------------------------------------------------------------------
// Department cards

test('a department card shows its code, its cue count in mono, and "N duplicates" or "clean"', async () => {
  await renderInRouter(
    <DepartmentCards
      showId="s1"
      canAdd={false}
      departments={[
        { id: 'lx', code: 'LX', colour: '#C9811F', count: 61, duplicateNumbers: 2 },
        { id: 'snd', code: 'SND', colour: '#2F6BD6', count: 28, duplicateNumbers: 0 },
        { id: 'tm', code: 'TM', colour: '#7A5CD0', count: 1, duplicateNumbers: 1 },
      ]}
    />,
  )
  const nav = screen.getByRole('navigation', { name: 'Cue lists' })
  const lx = within(nav).getByRole('link', { name: /^LX cue list/ })
  expect(href(lx)).toContain('/shows/s1/cues')
  expect(href(lx)).toContain('department=lx')
  expect(within(lx).getByText('61').className).toContain('font-mono')
  expect(within(lx).getByText('2 duplicates')).toBeTruthy()
  const snd = within(nav).getByRole('link', { name: /^SND cue list/ })
  expect(within(snd).getByText('clean')).toBeTruthy()
  expect(
    within(within(nav).getByRole('link', { name: /^TM cue list/ })).getByText('1 duplicate'),
  ).toBeTruthy()
})

test('only someone who can change departments gets the add card', async () => {
  const props = { showId: 's1', departments: [] }
  const { unmount } = await renderInRouter(<DepartmentCards {...props} canAdd={false} />)
  expect(screen.queryByRole('link', { name: 'Add department' })).toBeNull()
  unmount()
  await renderInRouter(<DepartmentCards {...props} canAdd />)
  expect(href(screen.getByRole('link', { name: 'Add department' }))).toContain('/shows/s1/settings')
})

// ---------------------------------------------------------------------------------------------
// Document rows

const ready: ReadyEntry = {
  kind: 'ready',
  key: 'd1:v2',
  docId: 'd1',
  title: 'Libretto',
  docKind: 'libretto',
  version: { id: 'v2', number: 2, label: null, pageCount: 43, searchable: true },
  kept: { number: 1, pageCount: 48 },
  compare: { from: 1, to: 2 },
}
const processing: ProcessingEntry = {
  kind: 'processing',
  key: 'd1:v3',
  docId: 'd1',
  versionId: 'v3',
  title: 'Libretto',
  versionNumber: 3,
  currentNumber: 2,
  status: 'processing',
  progress: { ready: 16, total: 40 },
  steps: [
    { key: 'upload', label: 'Upload', state: 'done' },
    { key: 'extract', label: 'Extract text', state: 'current' },
    { key: 'layer', label: 'Build word layer', state: 'pending' },
    { key: 'reanchor', label: 'Re-anchor 96 cues', state: 'pending' },
  ],
}
const failed: FailedEntry = {
  kind: 'failed',
  key: 'd2:v1',
  docId: 'd2',
  versionId: 'v1',
  title: 'Blocking notes.pdf',
  versionNumber: null,
  currentNumber: null,
  reason: 'No text layer and OCR is off',
  detail: null,
  isNewVersion: false,
}

function row(entry: DocumentEntry, over: Partial<Parameters<typeof DocumentRow>[0]> = {}) {
  const onUpload = vi.fn()
  const ui = (
    <ul>
      <DocumentRow showId="s1" entry={entry} canUpload onUpload={onUpload} {...over} />
    </ul>
  )
  return { ui, onUpload }
}

test('a ready document row shows version, pages, review count, cached chip and its actions', async () => {
  const { ui } = row(ready, { reviewCount: 4, cached: true })
  await renderInRouter(ui)
  const item = screen.getByRole('listitem')
  expect(within(item).getByRole('link', { name: 'Libretto' })).toBeTruthy()
  expect(item.textContent).toContain('v2 current')
  expect(item.textContent).toContain('43 pages')
  expect(item.textContent).toContain('searchable')
  expect(item.textContent).toContain('v1 kept')
  expect(within(item).getByRole('link', { name: '4 to review' })).toBeTruthy()
  expect(within(item).getByText('cached on this device')).toBeTruthy()
  expect(href(within(item).getByRole('link', { name: 'Open' }))).toContain('/shows/s1/docs/d1')
  expect(href(within(item).getByRole('link', { name: 'Cue lists' }))).toContain('/shows/s1/cues')
  expect(href(within(item).getByRole('link', { name: 'Compare v1 → v2' }))).toContain(
    '/shows/s1/docs/d1/compare',
  )
  expect(item.querySelector('.version-status')?.getAttribute('data-status')).toBe('ready')
})

test('Upload new version opens the upload for that document, and is absent without permission', async () => {
  const { ui, onUpload } = row(ready)
  const { unmount } = await renderInRouter(ui)
  fireEvent.click(screen.getByRole('button', { name: 'Upload new version' }))
  expect(onUpload).toHaveBeenCalledWith(
    { kind: 'version', documentId: 'd1', documentTitle: 'Libretto' },
    expect.anything(),
  )
  unmount()
  await renderInRouter(row(ready, { canUpload: false }).ui)
  expect(screen.queryByRole('button', { name: 'Upload new version' })).toBeNull()
})

test('a processing row shows a progress bar with its value, the four steps and what it waits on', async () => {
  await renderInRouter(row(processing).ui)
  const [item] = screen.getAllByRole('listitem')
  const bar = within(item).getByRole('progressbar')
  expect(bar.getAttribute('aria-valuenow')).toBe('40')
  expect(bar.getAttribute('aria-valuemin')).toBe('0')
  expect(bar.getAttribute('aria-valuemax')).toBe('100')
  expect(item.textContent).toContain('Libretto v3')
  // The mockup's figure is a percentage; the pages behind it are the bar's value text.
  expect(item.textContent).toContain('40 %')
  expect(bar.getAttribute('aria-valuetext')).toBe('16 of 40 pages')
  const steps = within(item).getAllByRole('listitem')
  expect(steps.map((s) => s.textContent)).toEqual([
    expect.stringContaining('Upload'),
    expect.stringContaining('Extract text'),
    expect.stringContaining('Build word layer'),
    expect.stringContaining('Re-anchor 96 cues'),
  ])
  expect(steps[1].getAttribute('aria-current')).toBe('step')
  expect(item.querySelector('.version-status')?.getAttribute('data-status')).toBe('processing')
  // Nothing in it claims a size or a speed the data does not have.
  expect(item.textContent).not.toMatch(/\bMB\b/)
})

test('with no page rows yet the progress bar is indeterminate: it has no value', async () => {
  await renderInRouter(row({ ...processing, progress: null }).ui)
  const bar = screen.getByRole('progressbar')
  expect(bar.hasAttribute('aria-valuenow')).toBe(false)
  expect(bar.getAttribute('aria-valuetext')).toBeTruthy()
})

test('a failed row shows the reason it gives, and Upload again opens the upload; it invents no Try again or Remove', async () => {
  const { ui, onUpload } = row(failed)
  await renderInRouter(ui)
  const item = screen.getByRole('listitem')
  expect(item.textContent).toContain('No text layer and OCR is off')
  expect(item.querySelector('.version-status')?.getAttribute('data-status')).toBe('failed')
  expect(within(item).queryByRole('button', { name: 'Try again' })).toBeNull()
  expect(within(item).queryByRole('button', { name: 'Remove' })).toBeNull()
  fireEvent.click(within(item).getByRole('button', { name: 'Upload again' }))
  // A failed first upload is retried as a version of that same document, never a second document.
  expect(onUpload).toHaveBeenCalledWith(
    { kind: 'version', documentId: 'd2', documentTitle: 'Blocking notes.pdf' },
    expect.anything(),
  )
})

test('a failed row puts tool output behind Details, and shows only the plain sentence', async () => {
  const raw = 'This file could not be read as a PDF. (ocrmypdf exit 2: InputFileError)'
  await renderInRouter(
    row({ ...failed, reason: 'This file could not be read as a PDF.', detail: raw }).ui,
  )
  const item = screen.getByRole('listitem')
  const details = item.querySelector('details') as HTMLDetailsElement
  expect(details.querySelector('summary')?.textContent).toBe('Details')
  expect(details.open).toBe(false)
  expect(details.textContent).toContain(raw)
  expect(details.querySelector('p')?.className).toContain('font-mono')
  // Outside the disclosure only the plain sentence is on the row.
  expect(item.querySelector(':scope > div > div > div > p')?.textContent).toBe(
    'This file could not be read as a PDF.',
  )
})

test('a failed row with nothing more to say has no Details', async () => {
  await renderInRouter(row(failed).ui)
  expect(document.querySelector('details')).toBeNull()
})

test('Upload again on a failed new version uploads another version of that document', async () => {
  const { ui, onUpload } = row({
    ...failed,
    docId: 'd1',
    title: 'Libretto',
    versionNumber: 3,
    currentNumber: 2,
    isNewVersion: true,
  })
  await renderInRouter(ui)
  fireEvent.click(screen.getByRole('button', { name: 'Upload again' }))
  expect(onUpload).toHaveBeenCalledWith(
    { kind: 'version', documentId: 'd1', documentTitle: 'Libretto' },
    expect.anything(),
  )
})

// ---------------------------------------------------------------------------------------------
// Recent activity and the offline line

const group = (seq: number, label: string, summary: string) => ({
  batchId: null,
  userId: 'u',
  label,
  summary,
  at: '2026-10-16T13:40:00',
  fromSeq: seq,
  toSeq: seq,
  count: 1,
  via: 'web',
  agent: null,
})

test('Recent activity shows the latest three changes from the feed, with who and through what', async () => {
  online.value = true
  activity.state = {
    isPending: false,
    isError: false,
    data: {
      pages: [
        {
          groups: [
            group(5, 'Oli', 'placed 6 SND cues'),
            group(4, 'Jayden via Claude Code', 'placed 42 LX cues'),
            group(3, 'Binder', 're-anchored 96 cues'),
            group(2, 'Oli', 'relabelled 1 cue'),
          ],
        },
      ],
    },
  }
  await renderInRouter(<RecentActivity showId="s1" />)
  const list = screen.getByRole('list')
  expect(within(list).getAllByRole('listitem')).toHaveLength(3)
  expect(list.textContent).toContain('Oli placed 6 SND cues')
  expect(list.textContent).toContain('Jayden via Claude Code placed 42 LX cues')
  expect(list.textContent).not.toContain('relabelled 1 cue')
  // The mockup's feed has no footer link (the rail has Activity).
  expect(screen.queryByRole('link', { name: 'All activity' })).toBeNull()
})

test('offline, Recent activity says history needs a connection instead of listing', async () => {
  online.value = false
  activity.state = { isPending: true, isError: false, data: undefined }
  await renderInRouter(<RecentActivity showId="s1" />)
  expect(screen.getByText('History needs a connection.')).toBeTruthy()
  expect(screen.queryByRole('list')).toBeNull()
  online.value = true
})

test('the offline line is plain about how much of the show is on this device', () => {
  const text = (cached: number, total: number) =>
    render(<OfflineLine summary={{ cached, total }} />).container.textContent
  expect(text(311, 311)).toBe('All 311 files are cached on this device.')
  expect(text(100, 311)).toBe('100 of 311 files are cached on this device.')
  expect(text(0, 311)).toBe('Nothing is saved on this device yet.')
  expect(text(0, 0)).toBe('No document is ready to save yet.')
})

// ---------------------------------------------------------------------------------------------
// Mockup compliance (Task C2)

test('Needs you is the mockup card: radius 14, an over-label inside, small buttons, no dividers', async () => {
  await renderInRouter(
    <NeedsYou showId="s1" review={{ count: 4, documentId: 'd1' }} duplicates={[]} />,
  )
  const card = screen.getByRole('heading', { name: 'Needs you' }).closest('section') as HTMLElement
  expect(card.className).toContain('rounded-[var(--r)]')
  expect(card.className).toContain('px-4')
  expect(screen.getByRole('heading', { name: 'Needs you' }).className).toContain('t-over')
  expect(screen.getByRole('list').className).not.toContain('divide-y')
  // size sm: 26 px at 768 and up
  expect(screen.getByRole('link', { name: 'Review' }).className).toContain('md:h-[26px]')
})

test('the phone Needs you has its label above a padding-0 card with 52 px rows', async () => {
  await renderInRouter(
    <NeedsYou
      showId="s1"
      variant="phone"
      review={{ count: 4, documentId: 'd1' }}
      duplicates={[]}
    />,
  )
  const heading = screen.getByRole('heading', { name: 'Needs you' })
  const section = heading.closest('section') as HTMLElement
  // the label is outside the card that holds the rows
  expect(section.querySelector('div.rounded-\\[var\\(--r\\)\\]')?.contains(heading)).toBe(false)
  expect(screen.getByRole('listitem').className).toContain('min-h-[52px]')
})

test('an upload that could not be processed is one of the things that need you', async () => {
  await renderInRouter(<NeedsYou showId="s1" review={null} duplicates={[]} failed={2} />)
  expect(items()).toEqual(['2 uploads couldn’t be processedSee'])
  expect(href(screen.getByRole('link', { name: 'See' }))).toContain('/shows/s1/docs')
})

test('on the Scripts card Open is the red button, after Cue lists and Compare', async () => {
  await renderInRouter(row(ready, { compact: true }).ui)
  const links = within(screen.getByRole('listitem'))
    .getAllByRole('link')
    .filter((l) => ['Cue lists', 'Compare v1 → v2', 'Open'].includes(l.textContent ?? ''))
  expect(links.map((l) => l.textContent)).toEqual(['Cue lists', 'Compare v1 → v2', 'Open'])
  expect(links[2].className).toContain('bg-red')
  expect(links[0].className).not.toContain('bg-red')
  // The version number in the compare button is plain text, not mono.
  expect(links[1].querySelector('.font-mono')).toBeNull()
})

test('on the Documents screen Open stays plain, and the row is the mockup card with elev buttons', async () => {
  await renderInRouter(row(ready, { reviewCount: 4, cached: true }).ui)
  const item = screen.getByRole('listitem')
  expect(item.className).toContain('rounded-[var(--r)]')
  const names = within(item)
    .getAllByRole('link')
    .map((l) => l.textContent)
    .filter((t) => ['Open', 'Cue lists', 'Compare v1 → v2'].includes(t ?? ''))
  expect(names).toEqual(['Open', 'Cue lists', 'Compare v1 → v2'])
  const open = within(item).getByRole('link', { name: 'Open' })
  expect(open.className).not.toContain('bg-red')
  expect(open.className).toContain('md:bg-elev')
  expect(within(item).getByRole('button', { name: 'Upload new version' })).toBeTruthy()
  // the title is Hanken 15 px / 600, the meta line 12 px
  expect(within(item).getByRole('heading').className).toContain('text-[15px]')
  expect(item.querySelector('.version-status')?.parentElement?.className).toContain('text-[12px]')
})

test('a processing row has the percentage in mono, a bordered bar and the mockup steps', async () => {
  await renderInRouter(row(processing, { thumbKey: 't1' }).ui)
  const [item] = screen.getAllByRole('listitem')
  expect(within(item).getByText('40 %').className).toContain('font-mono')
  expect(within(item).getByRole('progressbar').className).toContain('border-line-2')
  // the current step is a ring with an ink arc, the done one a tick circle
  const steps = within(item).getAllByRole('listitem')
  expect(steps[0].querySelector('svg')).not.toBeNull()
  expect(steps[1].querySelector('span[aria-hidden].border-t-ink')).not.toBeNull()
  // the document's current page, dimmed, in place of the empty box
  expect(item.querySelector('img')).not.toBeNull()
})

test('a failed row has the red-tinted border and 12 px reason text', async () => {
  await renderInRouter(row(failed).ui)
  const item = screen.getByRole('listitem')
  expect(item.className).toContain('color-mix(in_srgb,var(--red)_38%,var(--line-2))')
  expect(within(item).getByText('No text layer and OCR is off').className).toContain('text-[12px]')
})

test('the add-department card lists the default departments the show lacks', async () => {
  await renderInRouter(
    <DepartmentCards showId="s1" departments={[]} canAdd missing={['SM', 'VID', 'STG', 'FLY']} />,
  )
  const add = screen.getByRole('link', { name: 'Add department' })
  expect(add.textContent).toContain('+ SM, VID, STG, FLY')
})

test('department cards are the mockup grid and card: 4 up, gap 10, 12 px count, sub-line never amber', async () => {
  await renderInRouter(
    <DepartmentCards
      showId="s1"
      canAdd={false}
      departments={[{ id: 'lx', code: 'LX', colour: '#C9811F', count: 61, duplicateNumbers: 2 }]}
    />,
  )
  const grid = screen.getByRole('list')
  expect(grid.className).toContain('md:grid-cols-4')
  expect(grid.className).toContain('gap-2.5')
  const link = screen.getByRole('link', { name: /^LX cue list/ })
  expect(link.className).toContain('rounded-[var(--r)]')
  expect(within(link).getByText('61').className).toContain('md:text-[12px]')
  expect(within(link).getByText('2 duplicates').className).not.toContain('text-warn')
})

test('the offline line names the cached documents when every file is stored', () => {
  const view = render(
    <OfflineLine summary={{ cached: 311, total: 311 }} names={['Libretto v1, v2', 'Score v1']} />,
  )
  expect(view.container.textContent).toBe(
    'Libretto v1, v2 and Score v1 are cached on this device. 311 files.',
  )
})

test('the Recent activity row is the mockup feed row: 28 px avatar, 13 px text in ink, mono 11.5 px time', async () => {
  online.value = true
  activity.state = {
    isPending: false,
    isError: false,
    data: {
      pages: [
        {
          groups: [
            {
              batchId: null,
              userId: 'u',
              label: 'Oli',
              summary: 'placed 6 SND cues',
              at: '2026-10-16T13:40:00',
              fromSeq: 1,
              toSeq: 1,
              count: 1,
              via: 'web',
              agent: null,
            },
          ],
        },
      ],
    },
  }
  await renderInRouter(<RecentActivity showId="s1" />)
  const li = screen.getByRole('listitem')
  expect(li.className).toContain('text-[13px]')
  expect(li.querySelector('time')?.className).toContain('text-[11.5px]')
})
