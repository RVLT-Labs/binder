export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 4

/**
 * Each side of the page list on the stage, in CSS pixels. The floating tool strip lives in the
 * left one, 12 px in, and the page keeps the mockup's ~19 px clear of it (t-markup: strip 12 + 60
 * wide, page at 91): 12 + 50 + 19 at the desktop's 34 px buttons, 12 + 60 + 19 at the tablet's
 * 44 px ones. The right gutter mirrors it so the page stays centred.
 */
export const PAGE_GUTTER = 81
/** The tablet's gutter, for its wider (44 px button) strip. */
export const TABLET_PAGE_GUTTER = 91
/** At phone width there is no strip beside the page, so the gutters shrink to a thumb's margin. */
export const PHONE_PAGE_GUTTER = 12
/** Room for a classic scrollbar, so fit width never scrolls sideways. */
const SCROLLBAR_ROOM = 16
/** What fit width leaves out of the stage's width: both gutters plus the scrollbar. */
export const fitAllowance = (gutter: number) => 2 * gutter + SCROLLBAR_ROOM
export const FIT_ALLOWANCE = fitAllowance(PAGE_GUTTER)

const STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]
const EPSILON = 1e-6

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

/** The next preset above `zoom`, so zooming from a fit-width value lands on a round step. */
export function zoomIn(zoom: number): number {
  return STEPS.find((s) => s > zoom + EPSILON) ?? MAX_ZOOM
}

export function zoomOut(zoom: number): number {
  return STEPS.findLast((s) => s < zoom - EPSILON) ?? MIN_ZOOM
}

/** The zoom at which a page `pageWidth` points wide fills `availableWidth` CSS pixels. */
export function fitWidthZoom(availableWidth: number, pageWidth: number): number {
  return clampZoom(availableWidth / pageWidth)
}

export type ViewerKeyAction = 'nextPage' | 'prevPage' | 'zoomIn' | 'zoomOut' | 'fitWidth'

const KEYS: Record<string, ViewerKeyAction> = {
  PageDown: 'nextPage',
  ArrowDown: 'nextPage',
  ArrowRight: 'nextPage',
  PageUp: 'prevPage',
  ArrowUp: 'prevPage',
  ArrowLeft: 'prevPage',
  '+': 'zoomIn',
  '=': 'zoomIn',
  '-': 'zoomOut',
  '0': 'fitWidth',
}

/** The viewer action for a key press, or null. Modified keys stay with the browser (Ctrl + is its zoom). */
export function viewerKeyAction(e: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}): ViewerKeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  return KEYS[e.key] ?? null
}
