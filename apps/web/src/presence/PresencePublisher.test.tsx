import type { PresenceState } from '@binder/shared'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PresencePublisher } from './PresencePublisher'

// Mocked at the edges: the session's rows, the selection, and the hook that would send the state.
const mocks = vi.hoisted(() => ({
  view: {
    ordered: [] as Array<{ id: string }>,
    annotationsByPage: new Map<number, Array<{ id: string; layer_kind: string | null }>>(),
  },
  selection: null as { table: 'cues' | 'annotations'; id: string } | null,
  published: [] as PresenceState[],
}))
vi.mock('../markup/MarkupSession', () => ({ useMarkupSession: () => ({ view: mocks.view }) }))
vi.mock('../markup/selection', () => ({ useSelection: () => mocks.selection }))
vi.mock('./usePresence', () => ({
  usePresence: (_showId: string, state: PresenceState) => {
    mocks.published.push(state)
    return { peers: [], connected: false }
  },
}))

function published(): PresenceState {
  render(<PresencePublisher showId="s1" documentId="d1" versionId="v1" pageIndex={2} />)
  return mocks.published.at(-1) as PresenceState
}

beforeEach(() => {
  mocks.published = []
  mocks.selection = null
  mocks.view.ordered = [{ id: 'cue-1' }]
  mocks.view.annotationsByPage = new Map([
    [
      0,
      [
        { id: 'dept-note', layer_kind: 'department' },
        { id: 'personal-note', layer_kind: 'personal' },
        { id: 'odd-note', layer_kind: 'something-else' },
        { id: 'null-note', layer_kind: null },
      ],
    ],
  ])
})

describe('PresencePublisher privacy gate', () => {
  test('publishes where the tab is', () => {
    expect(published()).toEqual({
      documentId: 'd1',
      versionId: 'v1',
      pageIndex: 2,
      selection: null,
    })
  })

  test('a department annotation is published', () => {
    mocks.selection = { table: 'annotations', id: 'dept-note' }
    expect(published().selection).toEqual({ table: 'annotations', id: 'dept-note' })
  })

  test('a shown cue is published', () => {
    mocks.selection = { table: 'cues', id: 'cue-1' }
    expect(published().selection).toEqual({ table: 'cues', id: 'cue-1' })
  })

  test('a personal annotation publishes no selection', () => {
    mocks.selection = { table: 'annotations', id: 'personal-note' }
    expect(published().selection).toBeNull()
  })

  test.each(['odd-note', 'null-note'])(
    'an annotation of unknown layer kind (%s) publishes no selection',
    (id) => {
      mocks.selection = { table: 'annotations', id }
      expect(published().selection).toBeNull()
    },
  )

  test('an annotation not found in the view publishes no selection', () => {
    mocks.selection = { table: 'annotations', id: 'not-loaded-yet' }
    expect(published().selection).toBeNull()
  })

  test('a cue that is not shown publishes no selection', () => {
    mocks.selection = { table: 'cues', id: 'hidden-cue' }
    expect(published().selection).toBeNull()
  })

  test('the id of a personal note is in nothing the publisher hands on', () => {
    mocks.selection = { table: 'annotations', id: 'personal-note' }
    published()
    expect(JSON.stringify(mocks.published)).not.toContain('personal-note')
  })
})
