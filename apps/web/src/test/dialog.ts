/**
 * jsdom has no modal <dialog>. This gives it the two behaviours the tests lean on, and no more:
 * `showModal()` opens it and moves focus inside (as a browser does), and `close()` closes it and
 * fires `close`. Like a dialog that was removed from the page, it does not hand focus back, so a
 * test that sees focus return is seeing the component do it.
 */
export function installDialogPolyfill(): void {
  const proto = HTMLDialogElement.prototype
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
    this.querySelector<HTMLElement>('input, button, [href], [tabindex]')?.focus()
  }
  proto.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}

/** What pressing Escape does to an open modal dialog: a cancelable `cancel`, then a close. */
export function pressEscapeIn(dialog: HTMLDialogElement): void {
  const cancel = new Event('cancel', { cancelable: true })
  dialog.dispatchEvent(cancel)
  if (!cancel.defaultPrevented) dialog.close()
}
