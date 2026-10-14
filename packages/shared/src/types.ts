export type Role = 'owner' | 'editor' | 'viewer'
export type Via = 'web' | 'sync' | 'mcp'

export interface Actor {
  userId: string
  via: Via
  agent: string | null
  /** Show scope of the personal access token behind this actor; absent means unrestricted. */
  showScope?: '*' | string[]
}

export type ShowStatus = 'prep' | 'rehearsal' | 'running' | 'archived'
export type DocumentKind = 'libretto' | 'score' | 'blocking' | 'other'
export type OcrMode = 'auto' | 'never'
export type VersionStatus = 'queued' | 'processing' | 'ready' | 'failed'
export type PageStatus = 'queued' | 'ready' | 'failed'

export interface Word {
  t: string
  x: number
  y: number
  w: number
  h: number
}

export interface WordLayer {
  words: Word[]
  lines: number[][]
}
