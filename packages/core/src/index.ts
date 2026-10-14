export { compareReadingOrder } from './anchors/order'
export type { QuoteMatch, StreamWord } from './anchors/quote'
export { anchorAtMatch, buildWordStream, findQuote, normaliseForMatch } from './anchors/quote'
export { lineCentreY, snapToLine } from './anchors/snap'
export type { VersionText } from './anchors/types'
export type { CueListFlag, CueListRow } from './cues/cueList'
export { cueListRows } from './cues/cueList'
export {
  compareCueNumbers,
  findDuplicateNumbers,
  formatCueNumber,
  parseCueNumber,
  suggestCueNumber,
} from './cues/numbering'
export type { RenumberCue, RenumberResult } from './cues/renumber'
export { renumberByBlocks } from './cues/renumber'
export type { SummaryRow } from './history/summarise'
export { actorLabel, summariseBatch } from './history/summarise'
export { columnEqual, jsonEqual } from './json/jsonEqual'
export type { Box, MarkerStyle } from './markup/markers'
export {
  cueMarkerBox,
  MARKER_HEIGHT,
  MARKER_PADDING,
  markerStyle,
  markerText,
} from './markup/markers'
export { normaliseToken } from './search/normalise'
export type { DocHit, Hit } from './search/search'
export { searchDocument, searchWordLayer } from './search/search'
export { fromPopplerBbox } from './wordLayer/fromPopplerBbox'
