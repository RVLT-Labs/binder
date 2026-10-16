/**
 * Opening and closing a native modal <dialog> so that focus always comes back. A modal takes focus
 * when it opens; when it closes (or is removed) the browser does not reliably give it back, and
 * Safari does not focus a button on click at all, so the caller says what to return to.
 */

/**
 * True while a modal dialog is open. Everything behind a modal is inert, so keys that belong to the
 * page behind it (the markup keys, the command palette's ⌘K) stay out.
 */
export function modalIsOpen(): boolean {
  return document.querySelector('dialog[open]') !== null
}

/** Opens `el` as a modal. jsdom has no showModal; the dialog is then just open. */
export function openModal(el: HTMLDialogElement): void {
  if (el.open) return
  if (typeof el.showModal === 'function') el.showModal()
  else el.setAttribute('open', '')
}

/** Closes `el` (firing `close` where the browser does) and puts focus back on `returnTo`. */
export function closeModal(el: HTMLDialogElement | null, returnTo: HTMLElement | null): void {
  if (el?.open) {
    if (typeof el.close === 'function') el.close()
    else el.removeAttribute('open')
  }
  restoreFocus(returnTo)
}

/** Focuses `el` if it is still on the page and does not already have focus. */
export function restoreFocus(el: HTMLElement | null): void {
  if (el?.isConnected && document.activeElement !== el) el.focus()
}
