import type { PresencePeer } from '@binder/shared'
import { describe, expect, test } from 'vitest'
import {
  initials,
  latestPerUser,
  peerSelections,
  peersByPage,
  presenceSelection,
  readableTextOn,
  whoIsHere,
} from './peers'

function peer(over: Partial<PresencePeer> & { connId: string; userId: string }): PresencePeer {
  return {
    name: over.userId,
    colour: '#2f7de1',
    documentId: 'doc',
    versionId: 'v1',
    pageIndex: 0,
    selection: null,
    ...over,
  }
}

describe('peersByPage', () => {
  test('peersByPage keeps one entry per user on the given version', () => {
    const peers = [
      // Ana has two tabs; the later one in the list is the most recently updated.
      peer({ connId: 'a1', userId: 'ana', pageIndex: 2 }),
      peer({ connId: 'b1', userId: 'ben', pageIndex: 2 }),
      peer({ connId: 'a2', userId: 'ana', pageIndex: 4 }),
      peer({ connId: 'c1', userId: 'cy', pageIndex: 0, versionId: 'v2' }),
      peer({ connId: 'd1', userId: 'di', pageIndex: null, versionId: null, documentId: null }),
    ]
    const byPage = peersByPage(peers, 'v1')
    expect([...byPage.keys()].sort()).toEqual([2, 4])
    expect(byPage.get(2)?.map((p) => p.connId)).toEqual(['b1'])
    expect(byPage.get(4)?.map((p) => p.connId)).toEqual(['a2'])
    expect(byPage.has(0)).toBe(false)
  })

  test('a peer that is in the show but not on a page is on no page', () => {
    const idle = peer({
      connId: 'x',
      userId: 'x',
      documentId: null,
      versionId: null,
      pageIndex: null,
    })
    expect(peersByPage([idle], 'v1').size).toBe(0)
  })
})

describe('latestPerUser', () => {
  test('keeps the last connection of each user, in list order', () => {
    const peers = [
      peer({ connId: 'a1', userId: 'ana' }),
      peer({ connId: 'b1', userId: 'ben' }),
      peer({ connId: 'a2', userId: 'ana' }),
    ]
    expect(latestPerUser(peers).map((p) => p.connId)).toEqual(['b1', 'a2'])
  })
})

describe('latestPerUser by changedAt', () => {
  test('picks the connection whose state changed last, wherever it sits in the list', () => {
    const peers = [
      { ...peer({ connId: 'a1', userId: 'ana', pageIndex: 5 }), changedAt: 9 },
      { ...peer({ connId: 'a2', userId: 'ana', pageIndex: 1 }), changedAt: 3 },
      { ...peer({ connId: 'b1', userId: 'ben' }), changedAt: 1 },
    ]
    expect(latestPerUser(peers).map((p) => p.connId)).toEqual(['a1', 'b1'])
    expect([...peersByPage(peers, 'v1').keys()].sort()).toEqual([0, 5])
  })
})

describe('whoIsHere', () => {
  test('lists each user once, preferring a located connection over a bare one', () => {
    const peers = [
      peer({ connId: 'a1', userId: 'ana', pageIndex: 2 }),
      // Ana opened a second tab that has not said where it is yet.
      peer({
        connId: 'a2',
        userId: 'ana',
        documentId: null,
        versionId: null,
        pageIndex: null,
      }),
      peer({ connId: 'b1', userId: 'ben', documentId: null, versionId: null, pageIndex: null }),
    ]
    const list = whoIsHere(peers)
    expect(list.map((p) => [p.userId, p.connId])).toEqual([
      ['ana', 'a1'],
      ['ben', 'b1'],
    ])
  })
})

describe('peerSelections', () => {
  test('maps a selected row to one peer per user on that version', () => {
    const peers = [
      peer({ connId: 'a1', userId: 'ana', selection: { table: 'cues', id: 'c1' } }),
      peer({ connId: 'b1', userId: 'ben', selection: { table: 'cues', id: 'c1' } }),
      peer({
        connId: 'c1',
        userId: 'cy',
        versionId: 'v2',
        selection: { table: 'cues', id: 'c1' },
      }),
      peer({ connId: 'd1', userId: 'di', selection: { table: 'annotations', id: 'n1' } }),
      peer({ connId: 'e1', userId: 'ed', selection: null }),
    ]
    const sel = peerSelections(peers, 'v1')
    expect(sel.get('cues:c1')?.map((p) => p.userId)).toEqual(['ana', 'ben'])
    expect(sel.get('annotations:n1')?.map((p) => p.userId)).toEqual(['di'])
    expect(sel.size).toBe(2)
  })
})

describe('presenceSelection', () => {
  test('selecting a personal annotation broadcasts no selection', () => {
    expect(presenceSelection({ table: 'annotations', id: 'n1' }, 'personal')).toBeNull()
  })

  test('a department annotation or a cue is broadcast as it is', () => {
    expect(presenceSelection({ table: 'annotations', id: 'n1' }, 'department')).toEqual({
      table: 'annotations',
      id: 'n1',
    })
    expect(presenceSelection({ table: 'cues', id: 'c1' }, 'department')).toEqual({
      table: 'cues',
      id: 'c1',
    })
  })

  test('nothing selected, or a layer that is not known to be a department, broadcasts nothing', () => {
    expect(presenceSelection(null, 'department')).toBeNull()
    expect(presenceSelection({ table: 'annotations', id: 'n1' }, null)).toBeNull()
    expect(presenceSelection({ table: 'cues', id: 'c1' }, undefined)).toBeNull()
  })
})

describe('initials and contrast', () => {
  test('initials take the first letters of the first two words', () => {
    expect(initials('Ana Lopez')).toBe('AL')
    expect(initials('  ben  ')).toBe('B')
    expect(initials('Mary Jane Watson')).toBe('MJ')
    expect(initials('')).toBe('?')
  })

  test('text on a colour is whichever of black and white reads better', () => {
    expect(readableTextOn('#c9a000')).toBe('#000')
    expect(readableTextOn('#4363d8')).toBe('#fff')
    expect(readableTextOn('not a colour')).toBe('#fff')
  })
})
