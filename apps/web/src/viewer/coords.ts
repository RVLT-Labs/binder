/**
 * Displayed page space (spec 4.3) to CSS pixels and back. Displayed space is PDF points with the
 * origin at the bottom-left of the page as shown, after /Rotate. At zoom 1 one point is one CSS
 * pixel; the page box's top-left is the CSS origin, so y flips.
 */

export interface PageSize {
  /** Displayed width in PDF points. */
  width: number
  /** Displayed height in PDF points. */
  height: number
}

export function displayedToCss(
  x: number,
  y: number,
  pageHeight: number,
  zoom: number,
): { left: number; top: number } {
  return { left: x * zoom, top: (pageHeight - y) * zoom }
}

export function cssToDisplayed(
  left: number,
  top: number,
  pageHeight: number,
  zoom: number,
): { x: number; y: number } {
  return { x: left / zoom, y: pageHeight - top / zoom }
}

/**
 * The CSS box of a page at a zoom. An overlay drawn in displayed space fits it with one transform:
 * `matrix(scale, 0, 0, -scale, 0, cssHeight)`.
 */
export function pageGeometry(
  page: PageSize,
  zoom: number,
): { cssWidth: number; cssHeight: number; scale: number } {
  return { cssWidth: page.width * zoom, cssHeight: page.height * zoom, scale: zoom }
}
