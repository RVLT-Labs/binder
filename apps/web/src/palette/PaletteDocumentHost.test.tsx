import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PaletteDocumentHostRegistration } from './PaletteDocumentHost'
import { openPalette, resetPaletteState, usePaletteHost } from './paletteState'

const viewer = { goToPage: vi.fn(), searchFor: vi.fn() }
vi.mock('../markup/MarkupSession', () => ({
  useMarkupSession: () => ({ viewer: { current: viewer } }),
}))

let seen: ReturnType<typeof usePaletteHost> = null
function Probe() {
  seen = usePaletteHost()
  return null
}

const onPrint = vi.fn()
function mount() {
  render(<Probe />)
  return render(
    <PaletteDocumentHostRegistration
      documentId="d1"
      versionId="v1"
      pageCount={43}
      onPrint={onPrint}
    />,
  )
}
const press = (init: KeyboardEventInit) => fireEvent.keyDown(document.body, { key: 'p', ...init })

beforeEach(() => {
  onPrint.mockClear()
  resetPaletteState()
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  resetPaletteState()
})

it('registers the open document with the palette and takes it away on unmount', () => {
  const { unmount } = mount()
  expect(seen).toMatchObject({ documentId: 'd1', versionId: 'v1', pageCount: 43 })
  seen?.goToPage(11)
  seen?.searchFor('12')
  seen?.openPrint(null)
  expect(viewer.goToPage).toHaveBeenCalledWith(11)
  expect(viewer.searchFor).toHaveBeenCalledWith('12')
  expect(onPrint).toHaveBeenCalledWith(null)
  unmount()
  expect(seen).toBeNull()
})

it('⌘P and Ctrl+P open Binder’s print dialog, and the browser’s own print stays unopened', () => {
  mount()
  const event = new KeyboardEvent('keydown', {
    key: 'p',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  })
  document.body.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  expect(onPrint).toHaveBeenCalledTimes(1)
  press({ ctrlKey: true })
  expect(onPrint).toHaveBeenCalledTimes(2)
})

it('a plain p, a held key, and other chords do nothing', () => {
  mount()
  press({})
  press({ metaKey: true, repeat: true })
  press({ metaKey: true, shiftKey: true })
  press({ metaKey: true, altKey: true })
  expect(onPrint).not.toHaveBeenCalled()
})

it('does nothing while the palette is open', () => {
  mount()
  act(() => openPalette())
  press({ metaKey: true })
  expect(onPrint).not.toHaveBeenCalled()
})

it('does nothing while another modal dialog is open', () => {
  mount()
  const dialog = document.createElement('dialog')
  dialog.setAttribute('open', '')
  document.body.append(dialog)
  press({ metaKey: true })
  expect(onPrint).not.toHaveBeenCalled()
  dialog.remove()
  press({ metaKey: true })
  expect(onPrint).toHaveBeenCalledTimes(1)
})

it('B08 Calling suppresses print shortcuts as the keypad is the sole overlay', () => {
  render(
    <PaletteDocumentHostRegistration
      documentId="d1"
      versionId="v1"
      pageCount={43}
      onPrint={onPrint}
      calling
    />,
  )
  press({ metaKey: true })
  expect(onPrint).not.toHaveBeenCalled()
})
