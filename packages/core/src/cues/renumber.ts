import { DEFAULT_BLOCK_SIZE } from '@binder/shared'
import { compareReadingOrder } from '../anchors/order'

export interface RenumberCue {
  id: string
  major: number
  minor: number
  anchor: { pageIndex: number; y: number } | null
  /** The scene or song resolved from the anchor (spec 4.5), or null when none resolves. */
  groupKey: string | null
}

export interface RenumberResult {
  changes: Array<{ id: string; major: number; minor: number }>
  flagged: Array<{ id: string; reason: 'spilled' | 'overflow' }>
}

const MAX_MINOR = 99

/**
 * "Renumber from script order" (spec 4.5): cues in reading order are grouped by scene or song, each
 * group starts at the next multiple of the block size and takes consecutive integers; cues that do
 * not fit spill into points of the block's last integer and are flagged. Unplaced cues and the 0
 * range (line checks) are untouched, and cues whose number would not change are not in `changes`.
 */
export function renumberByBlocks(
  cues: RenumberCue[],
  opts: { blockSize?: number } = {},
): RenumberResult {
  const blockSize = opts.blockSize ?? DEFAULT_BLOCK_SIZE
  if (!Number.isInteger(blockSize) || blockSize < 2 || blockSize > 1000) {
    throw new RangeError('blockSize must be an integer from 2 to 1000')
  }

  const placed = cues
    .filter((c) => c.anchor !== null && c.major > 0)
    .sort(
      (a, b) =>
        compareReadingOrder(
          a.anchor as { pageIndex: number; y: number },
          b.anchor as { pageIndex: number; y: number },
        ) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )

  const runs: RenumberCue[][] = []
  for (const cue of placed) {
    const last = runs.at(-1)
    if (last && (last[0] as RenumberCue).groupKey === cue.groupKey) last.push(cue)
    else runs.push([cue])
  }

  const assigned = new Map<string, { major: number; minor: number }>()
  const flagged: RenumberResult['flagged'] = []
  let next = blockSize
  for (const run of runs) {
    const start = next
    const len = run.length
    let last: number
    if ((run[0] as RenumberCue).groupKey === null) {
      for (const [i, c] of run.entries()) assigned.set(c.id, { major: start + i, minor: 0 })
      last = start + len - 1
    } else {
      const fit = Math.min(len, blockSize)
      for (let i = 0; i < fit; i++)
        assigned.set((run[i] as RenumberCue).id, { major: start + i, minor: 0 })
      const spilled = len - blockSize
      for (let i = 1; i <= spilled; i++) {
        const cue = run[blockSize + i - 1] as RenumberCue
        if (i > MAX_MINOR) {
          flagged.push({ id: cue.id, reason: 'overflow' })
          continue
        }
        assigned.set(cue.id, {
          major: start + blockSize - 1,
          minor: Math.floor((i * 100) / (spilled + 1)),
        })
        flagged.push({ id: cue.id, reason: 'spilled' })
      }
      last = start + fit - 1
    }
    next = (Math.floor(last / blockSize) + 1) * blockSize
  }

  const changes: RenumberResult['changes'] = []
  for (const cue of placed) {
    const to = assigned.get(cue.id)
    if (to && (to.major !== cue.major || to.minor !== cue.minor))
      changes.push({ id: cue.id, ...to })
  }
  return { changes, flagged }
}
