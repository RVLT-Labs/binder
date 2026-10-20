import { useSyncExternalStore } from 'react'
import { restoreFocus } from '@/lib/modalDialog'

/**
 * Whether the command palette is open, and who opened it. A module store rather than React state
 * so the markup keys (which listen on the window, outside the React tree) can ask "is it open?"
 * the way they ask `modalIsOpen()`, and so a top bar button anywhere can open it.
 */
let open = false
let opener: HTMLElement | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const fn of [...listeners]) fn()
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Opens the palette; the focused control is remembered so closing can hand focus back to it. */
export function openPalette(): void {
  if (open || host?.calling) return
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  open = true
  emit()
}

export function closePalette(): void {
  if (!open) return
  open = false
  emit()
}

/** The control that had focus when the palette opened, if it is still on the page. */
export const paletteOpener = (): HTMLElement | null => (opener?.isConnected ? opener : null)

/** Closes the palette as Escape does: focus goes back to the control that opened it. */
export function dismissPalette(): void {
  const back = paletteOpener()
  closePalette()
  restoreFocus(back)
}

export const paletteCalling = (): boolean => host?.calling === true

export const isPaletteOpen = (): boolean => open

export const usePaletteOpen = (): boolean => useSyncExternalStore(subscribe, () => open)

/**
 * What the open document gives the palette: where it is, and the few things only the viewer can
 * do. The document page registers one while a ready version is shown; outside a document there is
 * none, so there are no page, script text or Print results.
 */
export interface PaletteDocumentHost {
  documentId: string
  versionId: string
  pageCount: number
  /** Scrolls to a page (zero-based). */
  goToPage(index: number): void
  /** Opens the Find card on `query` and goes to its first hit. */
  searchFor(query: string): void
  /** Opens the print dialog; focus goes back to `opener` when it closes. */
  openPrint(opener: HTMLElement | null): void
  /** Whether the document is in Calling mode (DESIGN §9). */
  calling: boolean
  /** Switches the document to Calling mode, or back to markup. */
  toggleCalling(): void
}

let host: PaletteDocumentHost | null = null
const hostListeners = new Set<() => void>()

/** Registers the open document; returns the function that takes it away again. */
export function registerDocumentHost(next: PaletteDocumentHost): () => void {
  host = next
  if (next.calling) closePalette()
  for (const fn of [...hostListeners]) fn()
  return () => {
    if (host !== next) return
    host = null
    for (const fn of [...hostListeners]) fn()
  }
}

const subscribeHost = (fn: () => void) => {
  hostListeners.add(fn)
  return () => {
    hostListeners.delete(fn)
  }
}

export const usePaletteHost = (): PaletteDocumentHost | null =>
  useSyncExternalStore(subscribeHost, () => host)

/** For tests: back to a closed palette with no document. */
export function resetPaletteState(): void {
  open = false
  opener = null
  host = null
  emit()
  for (const fn of [...hostListeners]) fn()
}
