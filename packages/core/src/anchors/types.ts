import type { WordLayer } from '@binder/shared'

/** One document version's text: page sizes and the word layer of every page that has one. */
export interface VersionText {
  versionId: string
  documentId: string
  pageCount: number
  pages: Array<{ width: number | null; height: number | null }>
  /** Word layers by zero-based page index; pages without a layer are absent. */
  layers: ReadonlyMap<number, WordLayer>
}
