export type { LineDiff, LineDiffEntry, LineRef } from './anchors/lineDiff'
export { diffVersionLines, diffVersionLinesBounded } from './anchors/lineDiff'
export { compareReadingOrder } from './anchors/order'
export type { QuoteMatch, StreamWord } from './anchors/quote'
export { anchorAtMatch, buildWordStream, findQuote, normaliseForMatch } from './anchors/quote'
export { reanchor, reanchorAll } from './anchors/reanchor'
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
export {
  ANNOTATION_PAD,
  DEFAULT_NOTE_FONT,
  DEFAULT_STAMP_FONT,
  DEFAULT_STROKE,
  NOTE_LINE_HEIGHT,
  NOTE_MAX_WIDTH,
  UNBOUND_CHARS,
  UNBOUND_FONT,
  unboundSnippet,
  wrapText,
} from './markup/annotationLayout'
export type { CueTagInput, CueTagLayout, TextExtent } from './markup/cueTags'
export {
  DEFAULT_MARGIN,
  LEADER_GUTTER,
  LEADER_WIDTH,
  layoutCueTags,
  SELECTED_FILL_OPACITY,
  TAG_EDGE,
  TAG_FONT_SIZE,
  TAG_GAP,
  TAG_HEIGHT,
  TAG_OUTLINE,
  TAG_OUTLINE_WARN,
  TAG_PAD,
  TAG_RADIUS,
  TAG_TEXT_GAP,
  TEXT_CLEARANCE,
  TICK_HEIGHT,
  tagWidth,
  textExtent,
  UNDERLINE_DROP,
  UNDERLINE_WIDTH,
} from './markup/cueTags'
export { helveticaBoldWidth, helveticaWidth } from './markup/helvetica'
export type { Box } from './markup/markers'
export { markerLead, markerText } from './markup/markers'
export { wordBoxes } from './markup/wordBoxes'
export type { FooterInfo } from './print/footer'
export { footerText, layerSelectionLabel } from './print/footer'
export type { StampInput, StampItem } from './print/stampItems'
export { buildStampItems } from './print/stampItems'
export type { PageFrame } from './print/stampScript'
export { displayedToUser, stampScript } from './print/stampScript'
export { toWinAnsi } from './print/winAnsi'
export { normaliseToken } from './search/normalise'
export type { DocHit, Hit } from './search/search'
export { searchDocument, searchWordLayer } from './search/search'
export type { CueSheetRow } from './sheets/cueSheet'
export { CUE_SHEET_COLUMNS, cueSheetCsv, cueSheetPdf, toCueSheetRows } from './sheets/cueSheet'
export type { CueSheetFile } from './sheets/cueSheetFile'
export { cueSheetFile } from './sheets/cueSheetFile'
export { cueSheetXlsx } from './sheets/xlsx'
export { fromPopplerBbox } from './wordLayer/fromPopplerBbox'
