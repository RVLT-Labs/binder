/**
 * The most device pixels one page canvas may hold. iOS Safari refuses canvases beyond 16,777,216
 * pixels (and then draws nothing), so this stays safely under it.
 */
export const MAX_CANVAS_PIXELS = 16_000_000

/** Beyond 2 device pixels per CSS pixel the extra sharpness is invisible and the memory is not. */
const MAX_PIXEL_RATIO = 2

/**
 * The PDF.js render scale for a page shown at `zoom` on a screen with `devicePixelRatio`: the
 * sharp choice (zoom x ratio, ratio capped at 2), lowered when needed so the canvas stays within
 * MAX_CANVAS_PIXELS. The canvas is CSS-sized to the page box, so a lower scale only softens it.
 */
export function renderScale(
  page: { width: number; height: number },
  zoom: number,
  devicePixelRatio: number,
): number {
  const wanted = zoom * Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO)
  const area = page.width * page.height
  if (area <= 0) return wanted
  // Canvas sizes are floored, so the real area is never above width x height x scale squared.
  return Math.min(wanted, Math.sqrt(MAX_CANVAS_PIXELS / area))
}
