import { type Box, cueMarkerBox } from '@binder/core'
import type { MarkupTable } from './mutations'

export type { Box }
/** The cue marker's geometry lives in core so print stamping draws the same box. */
export { cueMarkerBox }

export interface HitItem {
  table: MarkupTable
  id: string
  box: Box
}

/** The last-drawn item whose box, grown by `tolerance` points, contains `p`. */
export function hitTest(
  items: HitItem[],
  p: { x: number; y: number },
  tolerance = 4,
): { table: MarkupTable; id: string } | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i] as HitItem
    const { x, y, w, h } = item.box
    if (
      p.x >= x - tolerance &&
      p.x <= x + w + tolerance &&
      p.y >= y - tolerance &&
      p.y <= y + h + tolerance
    ) {
      return { table: item.table, id: item.id }
    }
  }
  return null
}
