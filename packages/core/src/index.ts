export { compareReadingOrder } from './anchors/order'
export type { QuoteMatch, StreamWord } from './anchors/quote'
export { anchorAtMatch, buildWordStream, findQuote, normaliseForMatch } from './anchors/quote'
export { lineCentreY, snapToLine } from './anchors/snap'
export type { VersionText } from './anchors/types'
export {
  compareCueNumbers,
  findDuplicateNumbers,
  formatCueNumber,
  parseCueNumber,
  suggestCueNumber,
} from './cues/numbering'
export { columnEqual, jsonEqual } from './json/jsonEqual'
export { normaliseToken } from './search/normalise'
export type { DocHit, Hit } from './search/search'
export { searchDocument, searchWordLayer } from './search/search'
export { fromPopplerBbox } from './wordLayer/fromPopplerBbox'
