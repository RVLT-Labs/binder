import type { ReanchorReview } from '@binder/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { clearNotices, getNotices } from '../components/noticeStore'

const h = vi.hoisted(() => ({
  getOptional: vi.fn(),
  review: null as unknown,
}))
vi.mock('@powersync/react', () => ({ usePowerSync: () => ({ getOptional: h.getOptional }) }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('../offline/useOnline', () => ({ useOnline: () => true }))
vi.mock('./useReviewCount', () => ({ useReviewCount: () => 1 }))
vi.mock('./api', () => ({
  reviewKey: () => ['review'],
  useReview: () => h.review,
  useResolveItem: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('./ReviewThumb', () => ({ ReviewThumb: () => null }))
vi.mock('../markup/MarkupSession', () => ({
  useMarkupSession: () => ({
    whyCantEdit: () => null,
    whyCantEditAnnotation: () => null,
    layerName: () => 'LX',
    layerColour: () => '#f00',
    view: { ordered: [], annotationsByPage: new Map() },
    viewer: { current: null },
    showCue: vi.fn(),
  }),
}))

import { ReviewPanel } from './ReviewPanel'

const anchor = { documentId: 'd', documentVersionId: 'v2', pageIndex: 0, x: 1, y: 2 }
const data: ReanchorReview = {
  currentVersionId: 'v2',
  pending: [
    {
      table: 'annotations',
      rowId: 'a1',
      layer: 'department:lx',
      title: 'note · hello',
      anchor: { ...anchor, status: 'approximate' },
      previous: null,
    },
  ],
  olderVersions: [],
}

beforeEach(() => {
  clearNotices()
  h.getOptional.mockReset()
  h.review = { data, isPending: false, isError: false, error: null }
})

test('a move that fails shows the error as a notice instead of an unhandled rejection', async () => {
  const unhandled = vi.fn()
  process.on('unhandledRejection', unhandled)
  h.getOptional.mockRejectedValue(new Error('database is locked'))
  render(<ReviewPanel documentId="d" versionNumbers={new Map()} onClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Move' }))
  await waitFor(() => expect(getNotices()).toHaveLength(1))
  expect(getNotices()[0]?.message).toBe('Could not start moving note · hello: database is locked')
  await new Promise((r) => setTimeout(r, 10))
  expect(unhandled).not.toHaveBeenCalled()
  process.off('unhandledRejection', unhandled)
})
