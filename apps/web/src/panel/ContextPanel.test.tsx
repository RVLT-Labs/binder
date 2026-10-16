import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { isEditableTarget } from '../markup/useMarkupShortcuts'
import { ContextPanel, type PanelTab } from './ContextPanel'

/** matchMedia for a window `width` px wide: answers the `(min-width: Npx)` queries the panel asks. */
function setWidth(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query)
    return {
      matches: min ? width >= Number(min[1]) : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }
  })
}

// jsdom has none of these; Radix reads them.
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => vi.unstubAllGlobals())

const tabs = (review = 4): PanelTab[] => [
  { id: 'cue', label: 'Cue', content: <p>cue content</p> },
  { id: 'layers', label: 'Layers', content: <p>layers content</p> },
  { id: 'history', label: 'History', content: <p>history content</p> },
  { id: 'review', label: 'Review', badge: review, content: <p>review content</p>, wide: true },
]

function Harness({
  open = true,
  returnFocusTo,
  onOpenChange,
  start = 'cue',
  count = 4,
}: {
  open?: boolean
  returnFocusTo?: HTMLElement | null
  onOpenChange?: (open: boolean) => void
  start?: string
  count?: number
}) {
  const [value, setValue] = useState(start)
  const [isOpen, setOpen] = useState(open)
  return (
    <ContextPanel
      tabs={tabs(count)}
      value={value}
      onValueChange={setValue}
      open={isOpen}
      onOpenChange={(next) => {
        setOpen(next)
        onOpenChange?.(next)
      }}
      returnFocusTo={returnFocusTo}
    />
  )
}

test('desktop docks a complementary landmark with the four tabs, the Review count beside Review', () => {
  setWidth(1280)
  render(<Harness open={false} />)
  const panel = screen.getByRole('complementary', { name: 'Context panel' })
  const names = within(panel)
    .getAllByRole('tab')
    .map((t) => t.textContent)
  expect(names).toEqual(['Cue', 'Layers', 'History', 'Review 4'])
  expect(within(panel).getByRole('tab', { name: 'Review 4' })).toBeTruthy()
  expect(within(panel).getByRole('tab', { name: 'Cue' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByText('cue content')).toBeTruthy()
  // 300 px wide, the paper-2 ground with a left rule
  expect(panel.className).toContain('w-[300px]')
  expect(panel.className).toContain('bg-paper-2')
  expect(panel.className).toContain('border-l')
})

test('the cue list docks it at 340 px (the cues mockup); the script keeps 300', () => {
  setWidth(1280)
  render(
    <ContextPanel
      tabs={tabs()}
      value="cue"
      onValueChange={() => {}}
      open={false}
      onOpenChange={() => {}}
      dockedWidth={340}
    />,
  )
  const panel = screen.getByRole('complementary', { name: 'Context panel' })
  expect(panel.className).toContain('w-[340px]')
  expect(panel.className).not.toContain('w-[300px]')
})

test('the compare screen docks it at 360 px', () => {
  setWidth(1280)
  render(
    <ContextPanel
      tabs={tabs()}
      value="cue"
      onValueChange={() => {}}
      open={false}
      onOpenChange={() => {}}
      dockedWidth={360}
    />,
  )
  const panel = screen.getByRole('complementary', { name: 'Context panel' })
  expect(panel.className).toContain('w-[360px]')
})

test('a panel with one tab draws no tab row, and a footer under the scroll', () => {
  setWidth(1280)
  render(
    <ContextPanel
      tabs={[{ id: 'changes', label: 'Changes', content: <p>the list</p> }]}
      value="changes"
      onValueChange={() => {}}
      open={false}
      onOpenChange={() => {}}
      label="Version changes"
      footer={<button type="button">Next change</button>}
    />,
  )
  const panel = screen.getByRole('complementary', { name: 'Version changes' })
  expect(within(panel).queryByRole('tablist')).toBeNull()
  expect(within(panel).getByText('the list')).toBeTruthy()
  expect(within(panel).getByRole('button', { name: 'Next change' })).toBeTruthy()
})

test('on a phone a one-tab drawer still has its Done', () => {
  setWidth(390)
  const onOpenChange = vi.fn()
  render(
    <ContextPanel
      tabs={[{ id: 'changes', label: 'Changes', content: <p>the list</p> }]}
      value="changes"
      onValueChange={() => {}}
      open
      onOpenChange={onOpenChange}
      showDone
    />,
  )
  const drawer = screen.getByRole('dialog', { name: 'Context panel' })
  expect(within(drawer).queryByRole('tablist')).toBeNull()
  fireEvent.click(within(drawer).getByRole('button', { name: 'Done' }))
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

test('the Review pill is a 16 px blue pill and is left out at zero', () => {
  setWidth(1280)
  const { unmount } = render(<Harness count={4} />)
  const pill = screen.getByText('4')
  expect(screen.getByRole('tab', { name: 'Review 4' })).toBeTruthy()
  expect(pill.className).toContain('h-4')
  expect(pill.className).toContain('bg-blue-soft')
  expect(pill.className).toContain('text-blue')
  unmount()
  render(<Harness count={0} />)
  expect(screen.getByRole('tab', { name: 'Review' })).toBeTruthy()
})

test('tabs are 12.5 px / 600 with the chosen one on the card fill and a 2 px red underline', () => {
  setWidth(1280)
  render(<Harness />)
  const cue = screen.getByRole('tab', { name: 'Cue' })
  expect(cue.className).toContain('text-[12.5px]')
  expect(cue.className).toContain('font-semibold')
  expect(cue.className).toContain('data-[state=active]:bg-card')
  expect(cue.className).toContain('inset_0_-2px_0_var(--red)')
})

test('choosing a tab shows its content and Review widens the docked panel to 420', () => {
  setWidth(1280)
  render(<Harness />)
  const panel = screen.getByRole('complementary', { name: 'Context panel' })
  fireEvent.click(screen.getByRole('tab', { name: 'Layers' }), { button: 0 })
  // Radix opens a tab on mouse down
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Layers' }), { button: 0 })
  expect(screen.getByText('layers content')).toBeTruthy()
  expect(screen.queryByText('cue content')).toBeNull()
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Review 4' }), { button: 0 })
  expect(panel.className).toContain('w-[420px]')
})

test('arrow keys move over the tabs without opening them', async () => {
  setWidth(1280)
  render(<Harness />)
  const cue = screen.getByRole('tab', { name: 'Cue' })
  cue.focus()
  fireEvent.keyDown(cue, { key: 'ArrowRight' })
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Layers' })),
  )
  expect(screen.getByText('cue content')).toBeTruthy()
})

test('phone draws nothing until opened, then a dialog with the same tabs', () => {
  setWidth(390)
  const { rerender } = render(
    <ContextPanel
      tabs={tabs()}
      value="cue"
      onValueChange={() => {}}
      open={false}
      onOpenChange={() => {}}
    />,
  )
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByRole('complementary')).toBeNull()
  rerender(
    <ContextPanel
      tabs={tabs()}
      value="cue"
      onValueChange={() => {}}
      open
      onOpenChange={() => {}}
    />,
  )
  const dialog = screen.getByRole('dialog', { name: 'Context panel' })
  expect(
    within(dialog)
      .getAllByRole('tab')
      .map((t) => t.textContent),
  ).toEqual(['Cue', 'Layers', 'History', 'Review 4'])
  // no scrim: nothing but the drawer is added to the page
  expect(
    document.querySelector('[data-state][class*="scrim"], [data-radix-dialog-overlay]'),
  ).toBeNull()
  // the mockup's sheet: radius 20 20 0 0, a 2 px top outline, over the tab bar
  expect(dialog.className).toContain('rounded-t-[20px]')
  expect(dialog.className).toContain('border-t-2')
  expect(dialog.className).toContain('z-[60]')
})

test('the phone drawer is non-modal: the page behind stays in the accessibility tree and can take focus', () => {
  setWidth(390)
  render(
    <>
      <button type="button">LX 12</button>
      <main aria-label="Cue list">page</main>
      <ContextPanel
        tabs={tabs()}
        value="cue"
        onValueChange={() => {}}
        open
        onOpenChange={() => {}}
      />
    </>,
  )
  expect(screen.getByRole('dialog', { name: 'Context panel' })).toBeTruthy()
  // Nothing outside the drawer is aria-hidden (a modal dialog hides its siblings)
  const tag = screen.getByRole('button', { name: 'LX 12' })
  expect(screen.getByRole('main', { name: 'Cue list' })).toBeTruthy()
  expect(tag.closest('[aria-hidden="true"]')).toBeNull()
  expect(document.body.getAttribute('aria-hidden')).toBeNull()
  // ...and focus is not trapped inside it
  tag.focus()
  expect(document.activeElement).toBe(tag)
  fireEvent.focusIn(tag)
  expect(document.activeElement).toBe(tag)
})

test('a press on the page behind the phone drawer does not close it', () => {
  setWidth(390)
  const onOpenChange = vi.fn()
  render(
    <>
      <button type="button">page</button>
      <ContextPanel
        tabs={tabs()}
        value="cue"
        onValueChange={() => {}}
        open
        onOpenChange={onOpenChange}
      />
    </>,
  )
  fireEvent.pointerDown(screen.getByRole('button', { name: 'page' }))
  fireEvent.focusIn(screen.getByRole('button', { name: 'page' }))
  expect(onOpenChange).not.toHaveBeenCalled()
})

test('dragging the phone drawer handle down past a quarter of its height closes it; a short drag does not', () => {
  setWidth(390)
  const onOpenChange = vi.fn()
  render(
    <ContextPanel
      tabs={tabs()}
      value="cue"
      onValueChange={() => {}}
      open
      onOpenChange={onOpenChange}
    />,
  )
  const drawer = screen.getByRole('dialog', { name: 'Context panel' })
  vi.spyOn(drawer, 'getBoundingClientRect').mockReturnValue({ height: 400 } as DOMRect)
  const handle = drawer.querySelector('[data-panel-handle]') as HTMLElement
  expect(handle).toBeTruthy()
  handle.setPointerCapture = () => {}
  handle.releasePointerCapture = () => {}
  const drag = (to: number) => {
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 300, button: 0 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: to })
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: to })
  }
  drag(340)
  expect(onOpenChange).not.toHaveBeenCalled()
  drag(430)
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

test('opening the phone drawer does not move focus off the tag that opened it', () => {
  setWidth(390)
  const tag = document.createElement('button')
  document.body.append(tag)
  tag.focus()
  render(
    <ContextPanel
      tabs={tabs()}
      value="cue"
      onValueChange={() => {}}
      open
      onOpenChange={() => {}}
    />,
  )
  expect(document.activeElement).toBe(tag)
  tag.remove()
})

test('closing the phone drawer returns focus to returnFocusTo', async () => {
  setWidth(390)
  const tag = document.createElement('button')
  tag.textContent = 'LX 12'
  document.body.append(tag)
  const onOpenChange = vi.fn()
  const { rerender } = render(
    <ContextPanel
      tabs={tabs()}
      value="cue"
      onValueChange={() => {}}
      open
      onOpenChange={onOpenChange}
      returnFocusTo={tag}
    />,
  )
  rerender(
    <ContextPanel
      tabs={tabs()}
      value="cue"
      onValueChange={() => {}}
      open={false}
      onOpenChange={onOpenChange}
      returnFocusTo={tag}
    />,
  )
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400))
  })
  expect(document.activeElement).toBe(tag)
  tag.remove()
})

test('tablet draws a 360 px sheet with no scrim, and closing it returns focus too', async () => {
  setWidth(834)
  const tag = document.createElement('button')
  document.body.append(tag)
  const { rerender } = render(
    <ContextPanel
      tabs={tabs()}
      value="cue"
      onValueChange={() => {}}
      open
      onOpenChange={() => {}}
      returnFocusTo={() => tag}
    />,
  )
  const sheet = screen.getByRole('dialog', { name: 'Context panel' })
  expect(sheet.className).toContain('w-[360px]')
  expect(sheet.className).toContain('rounded-l-[20px]')
  expect(sheet.className).toContain('border-l-2')
  expect(
    document.querySelector('[data-radix-dialog-overlay], [data-state][class*="scrim"]'),
  ).toBeNull()
  rerender(
    <ContextPanel
      tabs={tabs()}
      value="cue"
      onValueChange={() => {}}
      open={false}
      onOpenChange={() => {}}
      returnFocusTo={() => tag}
    />,
  )
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50))
  })
  expect(document.activeElement).toBe(tag)
  tag.remove()
})

test('a press on the page behind the tablet sheet does not close it', () => {
  setWidth(834)
  const onOpenChange = vi.fn()
  render(
    <>
      <button type="button">page</button>
      <ContextPanel
        tabs={tabs()}
        value="cue"
        onValueChange={() => {}}
        open
        onOpenChange={onOpenChange}
      />
    </>,
  )
  fireEvent.pointerDown(screen.getByRole('button', { name: 'page' }))
  fireEvent.focusIn(screen.getByRole('button', { name: 'page' }))
  expect(onOpenChange).not.toHaveBeenCalled()
})

test('Escape in a panel text field leaves the field and keeps the sheet open', () => {
  setWidth(834)
  const onOpenChange = vi.fn()
  render(
    <ContextPanel
      tabs={[
        { id: 'cue', label: 'Cue', content: <input aria-label="Label" /> },
        { id: 'layers', label: 'Layers', content: null },
      ]}
      value="cue"
      onValueChange={() => {}}
      open
      onOpenChange={onOpenChange}
    />,
  )
  const field = screen.getByLabelText('Label')
  field.focus()
  fireEvent.keyDown(field, { key: 'Escape' })
  expect(onOpenChange).not.toHaveBeenCalled()
})

test('c typed in a panel text field is not a place-cue shortcut: the gate is isEditableTarget', () => {
  setWidth(1280)
  const placeCue = vi.fn()
  // the listener the markup keys install: it asks isEditableTarget before it acts on a key
  const onKey = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return
    if (e.key === 'c') placeCue()
  }
  window.addEventListener('keydown', onKey)
  render(
    <ContextPanel
      tabs={[
        {
          id: 'cue',
          label: 'Cue',
          content: (
            <>
              <input aria-label="Label" />
              <textarea aria-label="Notes" />
              <button type="button">Delete</button>
            </>
          ),
        },
      ]}
      value="cue"
      onValueChange={() => {}}
      open
      onOpenChange={() => {}}
    />,
  )
  fireEvent.keyDown(screen.getByLabelText('Label'), { key: 'c' })
  fireEvent.keyDown(screen.getByLabelText('Notes'), { key: 'c' })
  expect(placeCue).not.toHaveBeenCalled()
  // and the same key on a button is a shortcut, so the gate is what stopped the fields
  fireEvent.keyDown(screen.getByRole('button', { name: 'Delete' }), { key: 'c' })
  expect(placeCue).toHaveBeenCalledTimes(1)
  window.removeEventListener('keydown', onKey)
})

test('Escape in a select blurs it and keeps the sheet; a second Escape closes it', () => {
  setWidth(834)
  const onOpenChange = vi.fn()
  render(
    <ContextPanel
      tabs={[
        {
          id: 'cue',
          label: 'Cue',
          content: (
            <select aria-label="Layer">
              <option>LX</option>
            </select>
          ),
        },
      ]}
      value="cue"
      onValueChange={() => {}}
      open
      onOpenChange={onOpenChange}
    />,
  )
  const select = screen.getByLabelText('Layer')
  select.focus()
  fireEvent.keyDown(select, { key: 'Escape' })
  expect(onOpenChange).not.toHaveBeenCalled()
  expect(document.activeElement).not.toBe(select)
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

test('phone: showDone draws a 44 px Done in the tab row for every tab, and it closes the drawer', () => {
  setWidth(390)
  const onOpenChange = vi.fn()
  render(
    <ContextPanel
      tabs={tabs()}
      value="layers"
      onValueChange={() => {}}
      open
      onOpenChange={onOpenChange}
      showDone
    />,
  )
  const done = screen.getByRole('button', { name: 'Done' })
  expect(done.className).toContain('min-h-11')
  // not a child of the tablist: a tablist holds tabs
  expect(done.closest('[role="tablist"]')).toBeNull()
  fireEvent.click(done)
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

test('without showDone there is no Done of the panel', () => {
  setWidth(390)
  render(
    <ContextPanel
      tabs={tabs()}
      value="cue"
      onValueChange={() => {}}
      open
      onOpenChange={() => {}}
    />,
  )
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
})
