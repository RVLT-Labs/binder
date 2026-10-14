import { cssToDisplayed } from '../viewer/coords'

/**
 * A viewport position as displayed points on a page drawn in `rect` (its box on screen). The zoom
 * is the drawn width over the page's displayed width. The result is clamped to the page.
 */
export function toPagePoint(
  client: { x: number; y: number },
  rect: { left: number; top: number; width: number },
  page: { width: number; height: number },
): { x: number; y: number } {
  const p = cssToDisplayed(
    client.x - rect.left,
    client.y - rect.top,
    page.height,
    rect.width / page.width,
  )
  // A pointer on the page's very edge can round a hair outside it.
  return { x: clamp(p.x, page.width), y: clamp(p.y, page.height) }
}

const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v))

/** The page box (`[data-page-index]`) under a viewport position, if any. */
export function pageAt(x: number, y: number): { pageIndex: number; rect: DOMRect } | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const sheet = el.closest('[data-page-index]')
    if (sheet) {
      return {
        pageIndex: Number(sheet.getAttribute('data-page-index')),
        rect: sheet.getBoundingClientRect(),
      }
    }
  }
  return null
}
