import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { modLabel } from '@/lib/modKey'
import { installDialogPolyfill, pressEscapeIn } from '../test/dialog'
import { CommandPalette } from './CommandPalette'
import { matchCues, parseCueQuery } from './matchCues'
import { closePalette, openPalette, resetPaletteState } from './paletteState'
import {
  buildPaletteResults,
  type PaletteCue,
  type PaletteDepartment,
  type PaletteEnv,
  type PaletteInput,
  scriptQueryOf,
} from './usePaletteResults'

const LX: PaletteDepartment = {
  id: 'lx',
  code: 'LX',
  colour: '#C9811F',
  numberFormat: 'decimal',
  hidden: false,
}
const SND: PaletteDepartment = {
  id: 'snd',
  code: 'SND',
  colour: '#2F6BD6',
  numberFormat: 'point',
  hidden: false,
}
const DEPARTMENTS = [LX, SND]

let n = 0
const cue = (
  departmentId: string,
  major: number,
  minor: number,
  label: string,
  pageIndex: number | null,
  y = 500,
): PaletteCue => ({
  id: `c${++n}`,
  departmentId,
  major,
  minor,
  label,
  anchor: pageIndex === null ? null : { documentId: 'd1', pageIndex, y },
})

const CUES = [
  cue('lx', 120, 0, 'Finale wash', 40),
  cue('lx', 12, 50, 'Deck wash build', 1),
  cue('lx', 12, 0, 'Ship deck wash in', 0),
  cue('snd', 12, 0, 'Thunder', 2),
  cue('snd', 12, 5, 'Thunder tail', 2, 300),
  cue('lx', 7, 0, 'Blackout', 0, 200),
  cue('lx', 12, 0, 'Not placed yet', null),
]

describe('matchCues', () => {
  it('"lx 12" is the LX cues whose number starts with 12, in reading order', () => {
    const got = matchCues('lx 12', CUES, DEPARTMENTS)
    expect(got.map((c) => [c.major, c.minor])).toEqual([
      [12, 0],
      [12, 50],
      [120, 0],
    ])
  })

  it('"12" matches in every department', () => {
    const got = matchCues('12', CUES, DEPARTMENTS)
    expect(got.map((c) => c.departmentId)).toEqual(['lx', 'lx', 'snd', 'snd', 'lx'])
  })

  it('reads the number as it is written, so a point department says 12.05, not 12.5', () => {
    expect(matchCues('snd 12.05', CUES, DEPARTMENTS).map((c) => c.minor)).toEqual([5])
    expect(matchCues('snd 12.5', CUES, DEPARTMENTS)).toEqual([])
    expect(matchCues('lx 12.5', CUES, DEPARTMENTS).map((c) => c.minor)).toEqual([50])
  })

  it('takes the department code in any case, with or without the space', () => {
    expect(matchCues('LX12', CUES, DEPARTMENTS)).toHaveLength(3)
    expect(matchCues('Lx  12', CUES, DEPARTMENTS)).toHaveLength(3)
  })

  it('a department alone lists its placed cues; unplaced cues are never offered', () => {
    const got = matchCues('lx', CUES, DEPARTMENTS)
    expect(got).toHaveLength(4)
    expect(got.every((c) => c.anchor !== null)).toBe(true)
  })

  it('orders by page, then top to bottom', () => {
    const got = matchCues('lx', CUES, DEPARTMENTS)
    expect(got.map((c) => [c.anchor?.pageIndex, c.major])).toEqual([
      [0, 12],
      [0, 7],
      [1, 12],
      [40, 120],
    ])
  })

  it('finds nothing for words, an unknown code, or an empty query', () => {
    expect(matchCues('wind', CUES, DEPARTMENTS)).toEqual([])
    expect(matchCues('xx 12', CUES, DEPARTMENTS)).toEqual([])
    expect(matchCues('  ', CUES, DEPARTMENTS)).toEqual([])
  })

  it('parseCueQuery splits a department from the number', () => {
    expect(parseCueQuery('lx 12', DEPARTMENTS)).toEqual({ department: LX, prefix: '12' })
    expect(parseCueQuery('12', DEPARTMENTS)).toEqual({ department: null, prefix: '12' })
    expect(parseCueQuery('snd', DEPARTMENTS)).toEqual({ department: SND, prefix: '' })
    expect(parseCueQuery('wind', DEPARTMENTS)).toBeNull()
  })
})

function env(): PaletteEnv {
  return {
    goToCue: vi.fn(),
    goToPage: vi.fn(),
    searchScript: vi.fn(),
    print: vi.fn(),
    renumber: vi.fn(),
    setLayerHidden: vi.fn(),
  }
}

function input(over: Partial<PaletteInput> = {}): PaletteInput {
  return {
    query: '',
    cues: CUES,
    departments: DEPARTMENTS,
    hiddenLayers: new Set(),
    document: { pageCount: 43 },
    scriptLines: null,
    canRenumber: true,
    ...over,
  }
}

const labels = (rs: Array<{ label: string }>) => rs.map((r) => r.label)

describe('buildPaletteResults', () => {
  it('"lx 12" puts LX 12 first under Go to, then the page; LX 12.5 and LX 120 are under Cues', () => {
    const groups = buildPaletteResults(input({ query: 'lx 12' }), env())
    expect(labels(groups.goTo)).toEqual(['LX 12 · Ship deck wash in', 'Page 12'])
    expect(labels(groups.cues)).toEqual(['LX 12.5 · Deck wash build', 'LX 120 · Finale wash'])
    expect(groups.goTo[0].detail).toBe('p.1')
    expect(groups.cues[1].detail).toBe('p.41')
    expect(groups.goTo[1].detail).toBe('of 43')
  })

  it('"12" also offers Page 12, only when the document has at least 12 pages', () => {
    expect(labels(buildPaletteResults(input({ query: '12' }), env()).goTo)).toContain('Page 12')
    const short = buildPaletteResults(input({ query: '12', document: { pageCount: 11 } }), env())
    expect(labels(short.goTo)).not.toContain('Page 12')
    const outside = buildPaletteResults(input({ query: '12', document: null }), env())
    expect(labels(outside.goTo)).not.toContain('Page 12')
    expect(labels(buildPaletteResults(input({ query: 'p 43' }), env()).goTo)).toEqual(['Page 43'])
  })

  it('a cue number is exact in every department that has it', () => {
    const groups = buildPaletteResults(input({ query: '12' }), env())
    expect(labels(groups.goTo).slice(0, 2)).toEqual([
      'LX 12 · Ship deck wash in',
      'SND 12 · Thunder',
    ])
  })

  it('colours a cue number in its department chrome colour, from data', () => {
    const [lx] = buildPaletteResults(input({ query: 'lx 12' }), env()).goTo
    expect(lx.parts[0]).toMatchObject({ text: 'LX 12', mono: true, bold: true })
    expect(lx.parts[0].colour).toBeTruthy()
  })

  it('"wind" offers an In the script result with the line count', () => {
    const none = buildPaletteResults(input({ query: 'wind', scriptLines: null }), env())
    expect(none.script).toEqual([])
    const found = buildPaletteResults(input({ query: 'wind', scriptLines: 3 }), env())
    expect(labels(found.script)).toEqual(['3 lines contain “wind”'])
    expect(found.script[0].detail).toBe('search')
    const one = buildPaletteResults(input({ query: 'wind', scriptLines: 1 }), env())
    expect(labels(one.script)).toEqual(['1 line contains “wind”'])
    const outside = buildPaletteResults(
      input({ query: 'wind', scriptLines: 3, document: null }),
      env(),
    )
    expect(outside.script).toEqual([])
  })

  it('a cue-shaped query searches the script for its number, "lx 12" as "12"', () => {
    const e = env()
    const found = buildPaletteResults(input({ query: 'lx 12', scriptLines: 3 }), e)
    expect(labels(found.script)).toEqual(['3 lines contain “12”'])
    found.script[0].run()
    expect(e.searchScript).toHaveBeenCalledWith('12')
    const bare = buildPaletteResults(input({ query: '12', scriptLines: 3 }), env())
    expect(labels(bare.script)).toEqual(['3 lines contain “12”'])
  })

  it('"lx" alone has no number, so it searches nothing; one character is too little', () => {
    expect(scriptQueryOf('lx', DEPARTMENTS)).toBeNull()
    expect(scriptQueryOf('lx 1', DEPARTMENTS)).toBeNull()
    expect(scriptQueryOf('lx 12', DEPARTMENTS)).toBe('12')
    expect(scriptQueryOf(' wind ', DEPARTMENTS)).toBe('wind')
    expect(scriptQueryOf('', DEPARTMENTS)).toBeNull()
    expect(buildPaletteResults(input({ query: 'lx', scriptLines: 3 }), env()).script).toEqual([])
  })

  it("exact matches beyond Go to's three go to Cues, in reading order", () => {
    const codes = ['A', 'B', 'C', 'D', 'E']
    const departments: PaletteDepartment[] = codes.map((code) => ({
      ...LX,
      id: code.toLowerCase(),
      code,
    }))
    const cues = codes.map((code, i) => cue(code.toLowerCase(), 12, 0, `Cue ${code}`, 4 - i))
    const groups = buildPaletteResults(input({ query: '12', cues, departments }), env())
    const cueRows = (rs: Array<{ id: string; label: string }>) =>
      labels(rs.filter((r) => r.id.startsWith('cue:')))
    // reading order is page order: E (page 1), D, C, B, A (page 5)
    expect(cueRows(groups.goTo)).toEqual(['E 12 · Cue E', 'D 12 · Cue D', 'C 12 · Cue C'])
    expect(labels(groups.cues)).toEqual(['B 12 · Cue B', 'A 12 · Cue A'])
  })

  it('words also find cues by their label, under Cues', () => {
    const groups = buildPaletteResults(input({ query: 'deck wash' }), env())
    expect(groups.goTo).toEqual([])
    expect(labels(groups.cues)).toEqual(['LX 12 · Ship deck wash in', 'LX 12.5 · Deck wash build'])
  })

  it('actions are Print, Renumber and a Hide layer for each visible department', () => {
    const { actions } = buildPaletteResults(input(), env())
    expect(labels(actions)).toEqual([
      'Print…',
      'Renumber from script order',
      'Hide LX layer',
      'Hide SND layer',
    ])
    expect(actions[0].hint).toBe(modLabel('P'))
    expect(labels(actions)).not.toContain('Switch to calling mode')
  })

  it('a hidden layer offers Show instead, and a department hidden for everyone offers nothing', () => {
    const { actions } = buildPaletteResults(
      input({
        hiddenLayers: new Set(['snd']),
        departments: [LX, SND, { ...LX, id: 'tm', code: 'TM', hidden: true }],
      }),
      env(),
    )
    expect(labels(actions)).toContain('Show SND layer')
    expect(labels(actions)).toContain('Hide LX layer')
    expect(labels(actions).some((l) => l.includes('TM'))).toBe(false)
  })

  it('outside a document there is no Print; without rights or documents there is no Renumber', () => {
    const { actions } = buildPaletteResults(input({ document: null, canRenumber: false }), env())
    expect(labels(actions)).toEqual(['Hide LX layer', 'Hide SND layer'])
  })

  it('typing words narrows the actions; typing a cue number leaves them alone', () => {
    expect(labels(buildPaletteResults(input({ query: 'print' }), env()).actions)).toEqual([
      'Print…',
    ])
    expect(labels(buildPaletteResults(input({ query: 'hide snd' }), env()).actions)).toEqual([
      'Hide SND layer',
    ])
    expect(buildPaletteResults(input({ query: 'lx 12' }), env()).actions).toHaveLength(4)
  })

  it('a cue in a department hidden for everyone is not offered', () => {
    const groups = buildPaletteResults(
      input({ query: 'lx 12', departments: [{ ...LX, hidden: true }, SND] }),
      env(),
    )
    expect(groups.goTo.filter((r) => r.id.startsWith('cue:'))).toEqual([])
  })

  it('each result runs what it says', () => {
    const e = env()
    const groups = buildPaletteResults(input({ query: 'lx 12', scriptLines: 2 }), e)
    groups.goTo[0].run()
    expect(e.goToCue).toHaveBeenCalledWith(expect.objectContaining({ major: 12, minor: 0 }))
    groups.goTo[1].run()
    expect(e.goToPage).toHaveBeenCalledWith(11)
    const byLabel = (l: string) => groups.actions.find((a) => a.label === l)
    byLabel('Print…')?.run()
    byLabel('Renumber from script order')?.run()
    byLabel('Hide SND layer')?.run()
    expect(e.print).toHaveBeenCalled()
    expect(e.renumber).toHaveBeenCalled()
    expect(e.setLayerHidden).toHaveBeenCalledWith('snd', true)
    buildPaletteResults(input({ query: 'wind', scriptLines: 3 }), e).script[0].run()
    expect(e.searchScript).toHaveBeenCalledWith('wind')
  })
})

// ----- the palette itself -----

const { state } = vi.hoisted(() => ({ state: { query: '', e: null as unknown } }))
vi.mock('./usePaletteResults', async (importOriginal) => {
  const real = await importOriginal<typeof import('./usePaletteResults')>()
  return {
    ...real,
    // The palette draws what the builder gives it for the typed query; the database is not run here.
    usePaletteResults: (query: string) =>
      real.buildPaletteResults(input({ query }), state.e as PaletteEnv),
  }
})

// The markup keys, so a test can see whether one of them fired.
const placeCue = vi.fn(async () => {})
vi.mock('../markup/MarkupSession', () => ({
  useMarkupSession: () => ({
    showId: 's1',
    versionReadOnly: null,
    annotationTarget: { layer: { kind: 'department', id: 'lx' } },
    view: { ordered: [], annotationsByPage: new Map() },
    viewer: { current: { focusPageInput: vi.fn() } },
    editable: [],
    hover: { current: { pageIndex: 0, point: { x: 1, y: 1 } } },
    cueType: 'go',
    placeCue,
  }),
}))
vi.mock('../undo/useUndo', () => ({
  useUndo: () => ({ undo: async () => {}, redo: async () => {} }),
}))

function Page() {
  return (
    <div>
      <button type="button">before</button>
      <CommandPalette showId="s1" />
    </div>
  )
}

const palette = () => screen.getByRole('dialog', { name: 'Command palette' })
const input$ = () => within(palette()).getByRole('combobox') as HTMLInputElement
const type = (text: string) => fireEvent.change(input$(), { target: { value: text } })
const key = (target: Element, k: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(target, { key: k, ...init })

beforeAll(() => {
  installDialogPolyfill()
  // cmdk scrolls the current row into view; jsdom has no layout to do it with.
  Element.prototype.scrollIntoView = () => {}
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

beforeEach(() => {
  state.e = env()
  resetPaletteState()
})
afterEach(() => {
  cleanup()
  resetPaletteState()
})

describe('CommandPalette', () => {
  it('opens on ⌘K and on Ctrl+K, and closes on the same key', () => {
    render(<Page />)
    expect(screen.queryByRole('dialog')).toBeNull()
    key(document.body, 'k', { metaKey: true })
    expect(palette()).toBeTruthy()
    key(document.body, 'k', { metaKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
    key(document.body, 'k', { ctrlKey: true })
    expect(palette()).toBeTruthy()
  })

  it('draws the four groups in their fixed order, only the ones that have results', () => {
    render(<Page />)
    act(() => openPalette())
    type('lx 12')
    const headings = Array.from(palette().querySelectorAll('[cmdk-group-heading]')).map(
      (h) => h.textContent,
    )
    expect(headings).toEqual(['Go to', 'Cues', 'Actions'])
    const rows = within(palette()).getAllByRole('option')
    expect(rows[0].textContent).toContain('LX 12')
    expect(rows[0].getAttribute('data-selected')).toBe('true')
    expect(rows.filter((r) => r.getAttribute('data-selected') === 'true')).toHaveLength(1)
  })

  it('Enter runs the current result, and the palette closes', () => {
    render(<Page />)
    act(() => openPalette())
    type('lx 12')
    key(input$(), 'Enter')
    const e = state.e as PaletteEnv
    expect(e.goToCue).toHaveBeenCalledWith(expect.objectContaining({ major: 12, minor: 0 }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the arrow keys move the current result, and Enter runs that one', () => {
    render(<Page />)
    act(() => openPalette())
    type('lx 12')
    key(input$(), 'ArrowDown')
    expect(
      within(palette())
        .getAllByRole('option')
        .find((r) => r.getAttribute('data-selected') === 'true')?.textContent,
    ).toContain('Page')
    key(input$(), 'Enter')
    expect((state.e as PaletteEnv).goToPage).toHaveBeenCalledWith(11)
  })

  it('clicking a result runs it', () => {
    render(<Page />)
    act(() => openPalette())
    type('lx 12')
    fireEvent.click(within(palette()).getByRole('option', { name: /LX 120/ }))
    expect((state.e as PaletteEnv).goToCue).toHaveBeenCalledWith(
      expect.objectContaining({ major: 120 }),
    )
  })

  it('⌘K while it is open closes it and focus goes back, as Escape does; a held key does nothing', () => {
    render(<Page />)
    const opener = screen.getByRole('button', { name: 'before' })
    opener.focus()
    key(document.body, 'k', { metaKey: true, repeat: true })
    expect(screen.queryByRole('dialog')).toBeNull()
    key(document.body, 'k', { metaKey: true })
    expect(document.activeElement).toBe(input$())
    key(input$(), 'k', { metaKey: true, repeat: true })
    expect(palette()).toBeTruthy()
    key(input$(), 'k', { metaKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('Escape closes it and focus goes back to the control that opened it', () => {
    render(<Page />)
    const opener = screen.getByRole('button', { name: 'before' })
    opener.focus()
    key(document.body, 'k', { metaKey: true })
    expect(document.activeElement).toBe(input$())
    pressEscapeIn(palette() as HTMLDialogElement)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('shows its footer of keys and the esc key cap', () => {
    render(<Page />)
    act(() => openPalette())
    expect(palette().textContent).toContain('↑↓ move · ↵ open · esc close')
    expect(within(palette()).getAllByText('esc').length).toBeGreaterThan(0)
  })

  it('has no Switch to calling mode (the Calling task adds it)', () => {
    render(<Page />)
    act(() => openPalette())
    expect(within(palette()).queryByText(/calling mode/i)).toBeNull()
  })
})

describe('the markup keys while the palette is open', () => {
  it('typing c or ] in the palette does not place a cue or step to the next one', async () => {
    const { useMarkupShortcuts } = await import('../markup/useMarkupShortcuts')
    function Keys() {
      useMarkupShortcuts()
      return null
    }
    render(
      <>
        <Keys />
        <Page />
      </>,
    )
    // sanity: with the palette closed, `c` places a cue
    key(document.body, 'c')
    expect(placeCue).toHaveBeenCalledTimes(1)
    placeCue.mockClear()

    act(() => openPalette())
    const row = within(palette()).getAllByRole('option')[0]
    for (const target of [input$(), row, palette(), document.body]) {
      key(target, 'c')
      key(target, ']')
      key(target, 'g')
    }
    expect(placeCue).not.toHaveBeenCalled()

    act(() => closePalette())
    key(document.body, 'c')
    expect(placeCue).toHaveBeenCalledTimes(1)
  })
})
