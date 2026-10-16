import type { PresencePeer } from '@binder/shared'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AvatarGroup } from './Avatars'
import { PeerOutline } from './PeerOutline'
import { PresenceProvider, presenceUrl, usePresencePeers } from './PresenceProvider'
import { usePresence } from './usePresence'

vi.mock('../auth/session', () => ({ useSessionUser: () => ({ data: { id: 'u-me' } }) }))

class FakeSocket {
  static all: FakeSocket[] = []
  readyState = 0
  sent: string[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) {
    FakeSocket.all.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
}

const peer = (userId: string, name: string, over: Partial<PresencePeer> = {}): PresencePeer => ({
  connId: `c-${userId}`,
  userId,
  name,
  colour: '#e6194b',
  documentId: 'd1',
  versionId: 'v1',
  pageIndex: 2,
  selection: null,
  ...over,
})

describe('AvatarGroup', () => {
  test('is a labelled group of avatars, each named with the page', () => {
    render(
      <AvatarGroup
        className="g"
        pageIndex={2}
        peers={[peer('u1', 'Ana Lopez'), peer('u2', 'Ben')]}
      />,
    )
    const group = screen.getByRole('group', { name: 'People on page 3' })
    expect(group.querySelectorAll('[role="img"]')).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'Ana Lopez on page 3' }).textContent).toBe('AL')
    expect(screen.getByRole('img', { name: 'Ben on page 3' }).textContent).toBe('B')
  })

  test('collapses people beyond three into a counted "+n"', () => {
    const peers = ['a', 'b', 'c', 'd', 'e'].map((u) => peer(u, `Person ${u}`))
    render(<AvatarGroup className="g" pageIndex={0} peers={peers} />)
    expect(screen.getAllByRole('img')).toHaveLength(4)
    expect(screen.getByRole('img', { name: '2 more on page 1' }).textContent).toBe('+2')
  })

  test('draws nothing for a page nobody is on', () => {
    const { container } = render(<AvatarGroup className="g" pageIndex={0} peers={[]} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('PeerOutline', () => {
  test("is a decorative 2 pt outline in the peer's colour, outside the box, that takes no pointer", () => {
    const { container } = render(
      <svg aria-hidden="true">
        <PeerOutline box={{ x: 10, y: 20, w: 30, h: 8 }} peers={[peer('u1', 'Ana')]} />
      </svg>,
    )
    const group = container.querySelector('.peer-outline') as SVGGElement
    expect(group.getAttribute('aria-hidden')).toBe('true')
    expect(group.getAttribute('pointer-events')).toBe('none')
    expect(group.querySelector('[tabindex]')).toBeNull()
    const rect = group.querySelector('rect') as SVGRectElement
    expect(rect.getAttribute('stroke')).toBe('#e6194b')
    expect(rect.getAttribute('stroke-width')).toBe('2')
    expect(rect.getAttribute('fill')).toBe('none')
    expect(rect.getAttribute('rx')).toBe('6')
    expect(rect.getAttribute('pointer-events')).toBe('none')
    // Beyond the marker's own 2 pt selection box on every side.
    expect(Number(rect.getAttribute('x'))).toBeLessThan(10 - 2)
    expect(Number(rect.getAttribute('y'))).toBeLessThan(20 - 2)
    expect(Number(rect.getAttribute('width'))).toBeGreaterThan(30 + 4)
  })

  test('several people on one row get nested outlines, each in their own colour', () => {
    const { container } = render(
      <svg aria-hidden="true">
        <PeerOutline
          box={{ x: 10, y: 20, w: 30, h: 8 }}
          peers={[peer('u1', 'Ana'), peer('u2', 'Ben', { colour: '#2f7de1' })]}
        />
      </svg>,
    )
    const rects = [...container.querySelectorAll('rect')]
    expect(rects.map((r) => r.getAttribute('stroke'))).toEqual(['#e6194b', '#2f7de1'])
    expect(Number(rects[1].getAttribute('x'))).toBeLessThan(Number(rects[0].getAttribute('x')))
  })
})

describe('PresenceProvider', () => {
  beforeEach(() => {
    FakeSocket.all = []
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  })

  function Consumers() {
    // Two components, one connection: a publisher and a reader.
    usePresence('s1', { documentId: 'd1', versionId: 'v1', pageIndex: 4, selection: null })
    const { peers } = usePresencePeers()
    return <p>{`peers: ${peers.map((p) => p.name).join(',')}`}</p>
  }
  function Reader() {
    const { peers, connected } = usePresencePeers()
    return <p>{`reader sees ${peers.length}, connected ${connected}`}</p>
  }

  test('presenceUrl follows the page protocol', () => {
    expect(presenceUrl('s 1', { protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/api/shows/s%201/presence',
    )
    expect(presenceUrl('s1', { protocol: 'https:', host: 'binder.example' })).toBe(
      'wss://binder.example/api/shows/s1/presence',
    )
  })

  test('one socket serves every component, sends the tab state, and hides the user themself', () => {
    render(
      <PresenceProvider showId="s1">
        <Consumers />
        <Reader />
        <Reader />
      </PresenceProvider>,
    )
    expect(FakeSocket.all).toHaveLength(1)
    const socket = FakeSocket.all[0]
    expect(socket.url).toMatch(/\/api\/shows\/s1\/presence$/)
    act(() => socket.open())
    expect(JSON.parse(socket.sent[0]).state).toMatchObject({ documentId: 'd1', pageIndex: 4 })

    act(() =>
      socket.receive({
        type: 'welcome',
        connId: 'mine',
        // The user's own other tab is not "someone else".
        peers: [peer('u-ana', 'Ana'), peer('u-me', 'Me')],
      }),
    )
    expect(screen.getByText('peers: Ana')).toBeTruthy()
    expect(screen.getAllByText('reader sees 1, connected true')).toHaveLength(2)
  })

  test('offline there is no socket and no peers, and going offline closes the socket quietly', () => {
    const online = vi.spyOn(navigator, 'onLine', 'get')
    online.mockReturnValue(false)
    render(
      <PresenceProvider showId="s1">
        <Consumers />
        <Reader />
      </PresenceProvider>,
    )
    expect(FakeSocket.all).toHaveLength(0)
    expect(screen.getByText('reader sees 0, connected false')).toBeTruthy()

    // Coming online connects; the state set while offline is sent.
    online.mockReturnValue(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(FakeSocket.all).toHaveLength(1)
    const socket = FakeSocket.all[0]
    act(() => socket.open())
    act(() => socket.receive({ type: 'welcome', connId: 'mine', peers: [peer('u-ana', 'Ana')] }))
    expect(screen.getByText('reader sees 1, connected true')).toBeTruthy()
    expect(JSON.parse(socket.sent[0]).state.pageIndex).toBe(4)

    online.mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(socket.closed).toBe(true)
    expect(screen.getByText('reader sees 0, connected false')).toBeTruthy()
    expect(FakeSocket.all).toHaveLength(1)
  })

  test('a reader outside any provider sees nobody', () => {
    render(<Reader />)
    expect(screen.getByText('reader sees 0, connected false')).toBeTruthy()
  })
})
