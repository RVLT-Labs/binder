import { describe, expect, it } from 'vitest'
import { duplicateStats } from './duplicates'

const cue = (id: string, departmentId: string, major: number, minor = 0) => ({
  id,
  departmentId,
  major,
  minor,
})

describe('duplicateStats', () => {
  it('is empty when no number repeats', () => {
    const stats = duplicateStats([cue('a', 'lx', 1), cue('b', 'lx', 2), cue('c', 'lx', 2, 50)])
    expect(stats.get('lx')).toBeUndefined()
  })

  it('counts a repeated number once, and the cues that share it', () => {
    const stats = duplicateStats([
      cue('a', 'lx', 12),
      cue('b', 'lx', 12),
      cue('c', 'lx', 12),
      cue('d', 'lx', 40, 50),
      cue('e', 'lx', 40, 50),
      cue('f', 'lx', 41),
    ])
    expect(stats.get('lx')).toEqual({ numbers: 2, cues: 5 })
  })

  it('keeps departments apart: LX 12 and SND 12 are not duplicates', () => {
    const stats = duplicateStats([cue('a', 'lx', 12), cue('b', 'snd', 12), cue('c', 'snd', 12)])
    expect(stats.get('lx')).toBeUndefined()
    expect(stats.get('snd')).toEqual({ numbers: 1, cues: 2 })
  })

  it('treats 12 and 12.5 as different numbers', () => {
    expect(duplicateStats([cue('a', 'lx', 12), cue('b', 'lx', 12, 50)]).size).toBe(0)
  })
})
