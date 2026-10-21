import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveShortcut } from '../markup/shortcuts'
import { useMarkupShortcuts } from '../markup/useMarkupShortcuts'
import { installDialogPolyfill, pressEscapeIn } from '../test/dialog'
import { CallingStrip } from './CallingStrip'
import { CallingView } from './CallingView'
import { RECENT_JUMPS, recentJumps, recordJump, resetRecentJumps } from './callingHistory'
import { GoToKeypad, type KeypadCue, type KeypadDepartment } from './GoToKeypad'
import { closeKeypad, isKeypadOpen } from './keypadState'
import { ModeAnnouncer } from './ModeAnnouncer'
import { nextCue } from './nextCue'
import { usePageTurn } from './usePageTurn'

// ----- the data: a short LX and SND script -----

const LX: KeypadDepartment = { id: 'lx', code: 'LX', numberFormat: 'decimal', colour: '#C9811F' }
const SND: KeypadDepartment = { id: 'snd', code: 'SND', numberFormat: 'point', colour: '#2F6BD6' }

const cue = (
  id: string,
  departmentId: string,
  major: number,
  minor: number,
  label: string,
  pageIndex: number,
  y: number,
): KeypadCue => ({ id, departmentId, major, minor, label, anchor: { pageIndex, y } })

const CUES = [
  cue('lx7', 'lx', 7, 0, 'Blackout', 0, 200),
  cue('snd2', 'snd', 2, 0, 'Preshow out', 0, 700),
  cue('lx12', 'lx', 12, 0, 'Ship deck wash in', 0, 600),
  cue('snd220', 'snd', 2, 20, 'Verse 2 swell', 0, 300),
  cue('lx13', 'lx', 13, 0, 'Sunrise', 1, 650),
  cue('snd245', 'snd', 2, 45, 'LP in', 2, 500),
]

describe('nextCue', () => {
  it('is the first LX cue at or after the top of the page, skipping other departments', () => {
    const got = nextCue(CUES, { departmentId: 'lx', page: 0, y: 792 })
    expect(got?.id).toBe('lx12')
    // SND 2 sits above LX 12 on the page, and is skipped for being SND
    expect(nextCue(CUES, { departmentId: 'snd', page: 0, y: 792 })?.id).toBe('snd2')
  })

  it('starts below the top of the view, and runs on to later pages', () => {
    // the view's top is under LX 12 (y 600): LX 7 below it is next
    expect(nextCue(CUES, { departmentId: 'lx', page: 0, y: 500 })?.id).toBe('lx7')
    expect(nextCue(CUES, { departmentId: 'lx', page: 0, y: 100 })?.id).toBe('lx13')
    expect(nextCue(CUES, { departmentId: 'snd', page: 1, y: 792 })?.id).toBe('snd245')
  })

  it('a cue exactly at the top counts; none left, no department and unplaced cues give null', () => {
    expect(nextCue(CUES, { departmentId: 'lx', page: 0, y: 600 })?.id).toBe('lx12')
    expect(nextCue(CUES, { departmentId: 'lx', page: 2, y: 792 })).toBeNull()
    expect(nextCue(CUES, { departmentId: null, page: 0, y: 792 })).toBeNull()
    expect(
      nextCue([{ departmentId: 'lx', anchor: null }], { departmentId: 'lx', page: 0, y: 1 }),
    ).toBeNull()
  })
})

describe('recent jumps', () => {
  beforeEach(resetRecentJumps)
  it('keeps the last three distinct jumps, newest first', () => {
    recordJump('d1', { kind: 'cue', cueId: 'a', label: 'LX 12' })
    recordJump('d1', { kind: 'page', index: 13, label: 'p.14' })
    recordJump('d1', { kind: 'cue', cueId: 'b', label: 'SND 2.45' })
    recordJump('d1', { kind: 'cue', cueId: 'a', label: 'LX 12' })
    recordJump('d1', { kind: 'cue', cueId: 'c', label: 'LX 13' })
    expect(recentJumps('d1').map((j) => j.label)).toEqual(['LX 13', 'LX 12', 'SND 2.45'])
    expect(recentJumps('d1')).toHaveLength(RECENT_JUMPS)
  })

  it('keeps each document its own: another script never shows these', () => {
    recordJump('d1', { kind: 'cue', cueId: 'a', label: 'LX 12' })
    recordJump('d2', { kind: 'page', index: 3, label: 'p.4' })
    expect(recentJumps('d1').map((j) => j.label)).toEqual(['LX 12'])
    expect(recentJumps('d2').map((j) => j.label)).toEqual(['p.4'])
    expect(recentJumps('d3')).toEqual([])
  })
})

// ----- the strip -----

describe('CallingStrip', () => {
  afterEach(cleanup)
  const next = { department: 'LX', colour: '#C9811F', number: '12', label: 'Ship deck wash in' }
  const strip = (over: Partial<Parameters<typeof CallingStrip>[0]> = {}) => (
    <CallingStrip
      page={1}
      pages={43}
      next={next}
      onPrev={vi.fn()}
      onNext={vi.fn()}
      onGoTo={vi.fn()}
      onExit={vi.fn()}
      {...over}
    />
  )

  it('shows the page in mono and the next cue on the active department', () => {
    render(strip())
    const region = screen.getByRole('region', { name: 'Calling' })
    expect(region.textContent).toContain('p.1 / 43')
    expect(region.textContent).toMatch(/Next from page top LX\s+12\s+Ship deck wash in/)
    const page = within(region).getByText(/^p\.1/)
    expect(page.className).toContain('font-mono')
  })

  it('turns pages, opens Go to… and exits; the first page has no Previous', () => {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    const onGoTo = vi.fn()
    const onExit = vi.fn()
    render(strip({ onPrev, onNext, onGoTo, onExit }))
    expect(
      (screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    fireEvent.click(screen.getByRole('button', { name: 'Go to…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(onNext).toHaveBeenCalled()
    expect(onGoTo).toHaveBeenCalled()
    expect(onExit).toHaveBeenCalled()
    expect(onPrev).not.toHaveBeenCalled()
  })

  it('says so when nothing is left to call', () => {
    render(strip({ next: null, departmentCode: 'LX' }))
    expect(screen.getByRole('region', { name: 'Calling' }).textContent).toContain('No more LX cues')
  })
})

// ----- the keypad -----

beforeAll(installDialogPolyfill)

const goDisabled = () => (screen.getByRole('button', { name: 'Go' }) as HTMLButtonElement).disabled
const readout = () => screen.getByLabelText('Cue number').textContent
const press = (...keys: string[]) => {
  for (const k of keys)
    fireEvent.click(
      screen.getByRole('button', { name: k === '.' ? 'Point' : k === '⌫' ? 'Backspace' : k }),
    )
}

describe('GoToKeypad', () => {
  afterEach(cleanup)
  const keypad = (over: Partial<Parameters<typeof GoToKeypad>[0]> = {}) => (
    <GoToKeypad
      cues={CUES}
      departments={[LX, SND]}
      pageCount={43}
      onGo={vi.fn()}
      onCancel={vi.fn()}
      {...over}
    />
  )

  it('builds 2.2 from key presses and shows the cue it lands on', () => {
    render(keypad())
    press('2', '.', '2')
    expect(readout()).toBe('2.2')
    const dialog = screen.getByRole('dialog', { name: 'Go to' })
    expect(dialog.textContent).toContain('SND 2.20')
    expect(dialog.textContent).toContain('Verse 2 swell')
    expect(dialog.textContent).toContain('p.1')
    expect(dialog.textContent?.replace(/\s+/g, ' ')).toContain('SND 2.20 · Verse 2 swell · p.1')
  })

  it('Cue is the default half; Go is off until something matches, then goes to the cue', () => {
    const onGo = vi.fn()
    render(keypad({ onGo }))
    expect(screen.getByRole('radio', { name: 'Cue' }).getAttribute('aria-checked')).toBe('true')
    expect(goDisabled()).toBe(true)
    press('9', '9')
    expect(goDisabled()).toBe(true)
    press('⌫', '⌫')
    press('2', '.', '2')
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onGo).toHaveBeenCalledWith({
      kind: 'cue',
      cue: expect.objectContaining({ id: 'snd220' }),
    })
  })

  it('an exact number wins over a longer one that starts with it', () => {
    const onGo = vi.fn()
    render(keypad({ onGo }))
    press('2')
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    // SND 2 is the whole of "2"; SND 2.20 and 2.45 only start with it
    expect(onGo).toHaveBeenCalledWith({ kind: 'cue', cue: expect.objectContaining({ id: 'snd2' }) })
  })

  it('the Page half goes to a page and refuses one that is not there', () => {
    const onGo = vi.fn()
    render(keypad({ onGo }))
    fireEvent.click(screen.getByRole('radio', { name: 'Page' }))
    const page = () => screen.getByLabelText('Page number').textContent
    press('9', '9')
    expect(page()).toBe('99')
    expect(goDisabled()).toBe(true)
    press('⌫', '⌫', '1', '4')
    expect(screen.getByRole('dialog').textContent).toContain('Page 14')
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onGo).toHaveBeenCalledWith({ kind: 'page', index: 13 })
  })

  it('takes typed digits, Backspace and Enter from the keyboard', () => {
    const onGo = vi.fn()
    render(keypad({ onGo }))
    const dialog = screen.getByRole('dialog')
    for (const key of ['2', '.', '2', '5', 'Backspace']) fireEvent.keyDown(dialog, { key })
    expect(readout()).toBe('2.2')
    fireEvent.keyDown(screen.getByLabelText('Cue number'), { key: 'Enter' })
    expect(onGo).toHaveBeenCalledWith({
      kind: 'cue',
      cue: expect.objectContaining({ id: 'snd220' }),
    })
  })

  it('Cancel and Escape say it is cancelled', () => {
    const onCancel = vi.fn()
    const onGo = vi.fn()
    render(keypad({ onCancel, onGo }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    cleanup()
    onCancel.mockClear()
    render(keypad({ onCancel, onGo }))
    pressEscapeIn(screen.getByRole('dialog') as HTMLDialogElement)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onGo).not.toHaveBeenCalled()
  })

  it('Recent chips go straight to their jump', () => {
    const onGo = vi.fn()
    render(
      keypad({
        onGo,
        recent: [
          { key: 'a', label: 'LX 12', target: { kind: 'cue', cue: CUES[2] } },
          { key: 'b', label: 'p.14', target: { kind: 'page', index: 13 } },
        ],
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'p.14' }))
    expect(onGo).toHaveBeenCalledWith({ kind: 'page', index: 13 })
  })

  it('two chips that read alike are both drawn', () => {
    render(
      keypad({
        recent: [
          { key: 'cue:a', label: 'LX 12', target: { kind: 'cue', cue: CUES[2] } },
          { key: 'cue:b', label: 'LX 12', target: { kind: 'cue', cue: CUES[0] } },
        ],
      }),
    )
    expect(screen.getAllByRole('button', { name: 'LX 12' })).toHaveLength(2)
  })

  it('typing is announced once: the match line is live, the readout is not', () => {
    render(keypad())
    expect(screen.getByLabelText('Cue number').getAttribute('aria-live')).toBe('off')
    press('2')
    const live = document.querySelectorAll('[aria-live="polite"]')
    expect(live).toHaveLength(1)
    expect(live[0].textContent).toContain('SND 2')
  })

  it('has no Recent heading when there is no history', () => {
    render(keypad())
    expect(screen.queryByText('Recent')).toBeNull()
  })
})

// ----- the strip and keypad on a script, through the markup session -----

const session = vi.hoisted(() => ({
  value: null as unknown,
}))
vi.mock('../markup/MarkupSession', () => ({ useMarkupSession: () => session.value }))
vi.mock('../undo/useUndo', () => ({
  useUndo: () => ({ undo: async () => {}, redo: async () => {} }),
}))

const row = (c: KeypadCue) => ({
  id: c.id,
  department_id: c.departmentId,
  major: c.major,
  minor: c.minor,
  label: c.label,
  anchor: { pageIndex: c.anchor?.pageIndex ?? 0, y: c.anchor?.y ?? 0 },
})
const viewer = { turnPage: vi.fn(), goToPage: vi.fn(), focusPageInput: vi.fn() }
const showCue = vi.fn()
const placeCue = vi.fn(async () => {})

function setSession(active: { kind: 'department' | 'personal'; id: string }) {
  session.value = {
    showId: 's1',
    documentId: 'd1',
    versionReadOnly: 'Calling mode is read-only.',
    annotationTarget: { disabled: 'Calling mode is read-only.' },
    departments: [
      { id: 'lx', code: 'LX', colour: '#C9811F', number_format: 'decimal', hidden: 0 },
      { id: 'snd', code: 'SND', colour: '#2F6BD6', number_format: 'point', hidden: 0 },
    ],
    view: { ordered: CUES.map(row), annotationsByPage: new Map() },
    layers: { hidden: [] },
    active,
    pages: [{ height: 792 }, { height: 792 }, { height: 792 }],
    viewer: { current: viewer },
    showCue,
    placeCue,
    hover: { current: { pageIndex: 0, point: { x: 1, y: 1 } } },
    editable: [{ kind: 'department', id: 'lx' }],
    removeCue: vi.fn(),
    removeAnnotation: vi.fn(),
    canEditCue: () => false,
    canEditAnnotation: () => false,
    store: { setActive: vi.fn() },
  }
}

describe('CallingView', () => {
  beforeEach(() => {
    resetRecentJumps()
    closeKeypad()
    for (const fn of [viewer.turnPage, viewer.goToPage, showCue]) fn.mockClear()
    setSession({ kind: 'department', id: 'lx' })
  })
  afterEach(cleanup)

  it('announces the next cue on the active department; a personal layer uses the first department', () => {
    render(<CallingView page={0} pageCount={43} onExit={vi.fn()} />)
    const strip = screen.getByRole('region', { name: 'Calling' })
    expect(strip.textContent).toContain('p.1 / 43')
    expect(strip.textContent).toMatch(/Next from page top LX\s+12\s+Ship deck wash in/)
    cleanup()
    setSession({ kind: 'personal', id: 'me' })
    render(<CallingView page={1} pageCount={43} onExit={vi.fn()} />)
    expect(screen.getByRole('region', { name: 'Calling' }).textContent).toMatch(
      /Next from page top LX\s+13\s+Sunrise/,
    )
  })

  it('Go to… opens the keypad; Go selects the cue, remembers it and offers it as a chip', () => {
    const { rerender } = render(<CallingView page={0} pageCount={43} onExit={vi.fn()} />)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Go to…' }))
    })
    expect(screen.getByRole('dialog', { name: 'Go to' })).toBeTruthy()
    press('2', '.', '2')
    expect(screen.getByRole('dialog').textContent?.replace(/\s+/g, ' ')).toContain(
      'SND 2.20 · Verse 2 swell · p.1',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(showCue).toHaveBeenCalledWith(expect.objectContaining({ id: 'snd220' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(recentJumps('d1').map((j) => j.label)).toEqual(['SND 2.20'])
    // and it is there the next time
    rerender(<CallingView page={0} pageCount={43} onExit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Go to…' }))
    expect(screen.getByRole('button', { name: 'SND 2.20' })).toBeTruthy()
  })

  it('Cancel and Escape close the keypad and put focus back on Go to…', () => {
    render(<CallingView page={0} pageCount={43} onExit={vi.fn()} />)
    const goTo = screen.getByRole('button', { name: 'Go to…' })
    for (const how of ['cancel', 'escape'] as const) {
      goTo.focus()
      fireEvent.click(goTo)
      const dialog = screen.getByRole('dialog', { name: 'Go to' })
      if (how === 'cancel') fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      else pressEscapeIn(dialog as HTMLDialogElement)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(goTo)
      expect(isKeypadOpen()).toBe(false)
    }
  })

  it('Go to a page turns to it and remembers it as p.N', () => {
    render(<CallingView page={0} pageCount={43} onExit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Go to…' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Page' }))
    press('1', '4')
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(viewer.goToPage).toHaveBeenCalledWith(13)
    expect(recentJumps('d1').map((j) => j.label)).toEqual(['p.14'])
  })
})

// ----- the keys -----

function Keys({ calling }: { calling: { active: boolean; onToggle: () => void } }) {
  useMarkupShortcuts(calling)
  return null
}
const key = (k: string, init: KeyboardEventInit = {}) =>
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
    )
  })

describe('the keys in Calling mode', () => {
  beforeEach(() => {
    closeKeypad()
    for (const fn of [viewer.turnPage, viewer.focusPageInput, placeCue]) fn.mockClear()
    setSession({ kind: 'department', id: 'lx' })
  })
  afterEach(cleanup)

  it('c, Delete and the digits do nothing', () => {
    const onToggle = vi.fn()
    render(<Keys calling={{ active: true, onToggle }} />)
    const s = session.value as {
      removeCue: ReturnType<typeof vi.fn>
      store: { setActive: ReturnType<typeof vi.fn> }
    }
    for (const k of [
      'c',
      'C',
      'Delete',
      'Backspace',
      '1',
      '2',
      '9',
      'v',
      'h',
      's',
      ']',
      '[',
      '/',
    ]) {
      key(k, k === 'C' ? {} : {})
    }
    expect(placeCue).not.toHaveBeenCalled()
    expect(s.removeCue).not.toHaveBeenCalled()
    expect(s.store.setActive).not.toHaveBeenCalled()
    expect(viewer.turnPage).not.toHaveBeenCalled()
    expect(isKeypadOpen()).toBe(false)
  })

  it('←/→ turn pages, g opens the keypad and ⇧C leaves', () => {
    const onToggle = vi.fn()
    render(<Keys calling={{ active: true, onToggle }} />)
    key('ArrowRight')
    key('ArrowLeft')
    expect(viewer.turnPage.mock.calls).toEqual([[1], [-1]])
    key('g')
    expect(isKeypadOpen()).toBe(true)
    expect(viewer.focusPageInput).not.toHaveBeenCalled()
    key('C', { shiftKey: true })
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('a key typed while the keypad is open (a modal) reaches nothing behind it', () => {
    render(<Keys calling={{ active: true, onToggle: vi.fn() }} />)
    const dialog = document.createElement('dialog')
    document.body.append(dialog)
    dialog.setAttribute('open', '')
    key('ArrowRight')
    key('g')
    key('C', { shiftKey: true })
    expect(viewer.turnPage).not.toHaveBeenCalled()
    dialog.remove()
  })

  it('in markup ⇧C enters Calling, c still places a cue and ←/→ are left to the page', () => {
    const onToggle = vi.fn()
    render(<Keys calling={{ active: false, onToggle }} />)
    key('C', { shiftKey: true })
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(placeCue).not.toHaveBeenCalled()
    key('c')
    expect(placeCue).toHaveBeenCalled()
    key('ArrowRight')
    expect(viewer.turnPage).not.toHaveBeenCalled()
    key('g')
    expect(viewer.focusPageInput).toHaveBeenCalled()
  })
})

describe('resolveShortcut in Calling', () => {
  const ev = (k: string, o: Partial<Parameters<typeof resolveShortcut>[0]> = {}) => ({
    key: k,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    editableTarget: false,
    ...o,
  })
  it('only navigation acts', () => {
    const calling = { calling: true }
    expect(resolveShortcut(ev('ArrowRight'), calling)).toEqual({ kind: 'turnPage', direction: 1 })
    expect(resolveShortcut(ev('ArrowLeft'), calling)).toEqual({ kind: 'turnPage', direction: -1 })
    expect(resolveShortcut(ev('g'), calling)).toEqual({ kind: 'jumpToPage' })
    expect(resolveShortcut(ev('C', { shiftKey: true }), calling)).toEqual({ kind: 'toggleCalling' })
    for (const k of ['c', 'Delete', '1', ']', 'v', '/'])
      expect(resolveShortcut(ev(k), calling)).toBeNull()
    expect(resolveShortcut(ev('z', { metaKey: true }), calling)).toBeNull()
  })
  it('outside Calling ←/→ are not shortcuts, and ⇧C is the switch, not a cue', () => {
    expect(resolveShortcut(ev('ArrowRight'))).toBeNull()
    expect(resolveShortcut(ev('C', { shiftKey: true }))).toEqual({ kind: 'toggleCalling' })
    expect(resolveShortcut(ev('c'))).toEqual({ kind: 'placeCue' })
  })
})

// ----- turning pages by hand -----

describe('usePageTurn', () => {
  afterEach(cleanup)
  function Stage({ turn }: { turn: (d: 1 | -1) => void }) {
    const handlers = usePageTurn(turn)
    return (
      <div data-testid="stage" {...handlers}>
        <button type="button">control</button>
        <span data-cue-id="c1">tag</span>
        <span data-annotation-id="a1">note</span>
        <dialog open>
          <button type="button">key</button>
          <p>scrim</p>
        </dialog>
        <section aria-label="Calling">
          <p>strip</p>
        </section>
      </div>
    )
  }
  const rect = { left: 0, top: 0, width: 900, height: 600, right: 900, bottom: 600, x: 0, y: 0 }
  function gesture(el: Element, from: [number, number], to: [number, number], over = el) {
    fireEvent.pointerDown(over, {
      clientX: from[0],
      clientY: from[1],
      pointerType: 'touch',
      button: 0,
    })
    fireEvent.pointerUp(el, { clientX: to[0], clientY: to[1], pointerType: 'touch', button: 0 })
  }
  const stage = () => {
    const el = screen.getByTestId('stage')
    el.getBoundingClientRect = () => rect as DOMRect
    return el
  }

  it('a tap on the left third goes back, on the right third forward, in the middle nowhere', () => {
    const turn = vi.fn()
    render(<Stage turn={turn} />)
    const el = stage()
    gesture(el, [100, 300], [100, 300])
    gesture(el, [450, 300], [450, 300])
    gesture(el, [800, 300], [800, 300])
    expect(turn.mock.calls).toEqual([[-1], [1]])
  })

  it('a swipe to the left goes forward, to the right back; a vertical drag does nothing', () => {
    const turn = vi.fn()
    render(<Stage turn={turn} />)
    const el = stage()
    gesture(el, [600, 300], [300, 310])
    gesture(el, [300, 300], [600, 290])
    gesture(el, [450, 500], [455, 200])
    expect(turn.mock.calls).toEqual([[1], [-1]])
  })

  it('a tap on a control or a tag is theirs, not a page turn', () => {
    const turn = vi.fn()
    render(<Stage turn={turn} />)
    const el = stage()
    gesture(el, [100, 300], [100, 300], screen.getByRole('button', { name: 'control' }))
    gesture(el, [800, 300], [800, 300], screen.getByText('tag'))
    gesture(el, [800, 300], [800, 300], screen.getByText('note'))
    expect(turn).not.toHaveBeenCalled()
  })

  it('a drag that starts on the keypad or the strip turns nothing, however sideways', () => {
    const turn = vi.fn()
    render(<Stage turn={turn} />)
    const el = stage()
    gesture(el, [700, 300], [200, 300], screen.getByRole('button', { name: 'key' }))
    gesture(el, [700, 300], [200, 300], screen.getByText('scrim'))
    gesture(el, [200, 300], [700, 300], screen.getByText('strip'))
    expect(turn).not.toHaveBeenCalled()
    // a swipe that starts on the page itself still does
    gesture(el, [700, 300], [200, 300])
    expect(turn).toHaveBeenCalledWith(1)
  })
})

describe('ModeAnnouncer', () => {
  afterEach(cleanup)
  const said = () => screen.getByRole('status').textContent

  it('says when Calling starts and ends, and each page turn while calling', () => {
    const { rerender } = render(<ModeAnnouncer calling={false} page={0} pageCount={3} />)
    expect(said()).toBe('')
    // markup page changes are not announced here
    rerender(<ModeAnnouncer calling={false} page={1} pageCount={3} />)
    expect(said()).toBe('')
    rerender(<ModeAnnouncer calling page={1} pageCount={3} />)
    expect(said()).toBe('Calling mode. Page 2 of 3')
    rerender(<ModeAnnouncer calling page={2} pageCount={3} />)
    expect(said()).toBe('Page 3 of 3')
    rerender(<ModeAnnouncer calling={false} page={2} pageCount={3} />)
    expect(said()).toBe('Markup mode. Page 3 of 3')
  })

  it('is one polite region', () => {
    render(<ModeAnnouncer calling page={0} pageCount={3} />)
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
  })
})

it('B15 labels Next as relative to the page top without inventing a called-cue cursor', () => {
  render(
    <CallingStrip
      page={1}
      pages={3}
      next={{ department: 'LX', number: '12', colour: '#C9811F', label: 'Synthetic' }}
      onPrev={vi.fn()}
      onNext={vi.fn()}
      onGoTo={vi.fn()}
      onExit={vi.fn()}
    />,
  )
  expect(screen.getByRole('region', { name: 'Calling' }).textContent).toContain(
    'Next from page top LX',
  )
})

it('B15 ambiguous cue numbers do not silently jump to another department or duplicate', () => {
  const onGo = vi.fn()
  render(
    <GoToKeypad
      cues={[CUES[2], { ...CUES[2], id: 'duplicate', departmentId: 'snd' }]}
      departments={[LX, SND]}
      pageCount={43}
      onGo={onGo}
      onCancel={vi.fn()}
    />,
  )
  press('1', '2')
  expect(goDisabled()).toBe(true)
  expect(screen.getByRole('dialog').textContent).toMatch(/multiple cues.*page/i)
  fireEvent.keyDown(screen.getByLabelText('Cue number'), { key: 'Enter' })
  expect(onGo).not.toHaveBeenCalled()
})

it('B17 department words use theme-aware ink and hue remains on the swatch', () => {
  render(
    <CallingStrip
      page={1}
      pages={3}
      next={{ department: 'LX', number: '12', colour: '#C9811F', label: 'Synthetic' }}
      onPrev={vi.fn()}
      onNext={vi.fn()}
      onGoTo={vi.fn()}
      onExit={vi.fn()}
    />,
  )
  const words = screen.getByText('Next from page top LX')
  expect(words.style.color).toBe('')
  expect(words.className).toContain('text-ink')
  expect((words.querySelector('[aria-hidden]') as HTMLElement).style.background).toBe(
    'rgb(201, 129, 31)',
  )
})

it('B17 keypad match words use ink with a separate department swatch', () => {
  render(
    <GoToKeypad
      cues={CUES}
      departments={[LX, SND]}
      pageCount={43}
      onGo={vi.fn()}
      onCancel={vi.fn()}
    />,
  )
  press('1', '2')
  const words = screen.getByText('LX 12')
  expect(words.style.color).toBe('')
  expect(words.className).toContain('text-ink')
  expect(document.querySelector('[data-department-swatch]')).toBeTruthy()
})

it('B09 keypad keeps its 56px action faces and reserves 44px recent navigation targets', () => {
  render(
    <GoToKeypad
      cues={CUES}
      departments={[LX, SND]}
      pageCount={43}
      recent={[{ key: 'page-1', label: 'p.1', target: { kind: 'page', index: 0 } }]}
      onGo={vi.fn()}
      onCancel={vi.fn()}
    />,
  )
  expect(screen.getByRole('button', { name: 'Go' }).className).toContain('before:h-14')
  expect(screen.getByRole('button', { name: 'p.1' }).className).toContain('min-h-11')
})
