export type { LineDiff, LineDiffEntry, LineRef } from './anchors/lineDiff'
export { diffVersionLines, diffVersionLinesBounded } from './anchors/lineDiff'
export { compareReadingOrder } from './anchors/order'
export type { QuoteMatch, StreamWord } from './anchors/quote'
export { anchorAtMatch, buildWordStream, findQuote, normaliseForMatch } from './anchors/quote'
export { reanchor, reanchorAll } from './anchors/reanchor'
export {
  cutQuote,
  lineCentreY,
  nearestLine,
  rangeText,
  snapToLine,
  snapToWord,
} from './anchors/snap'
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
export { actorLabel, cardSentence, summariseBatch } from './history/summarise'
export { columnEqual, jsonEqual } from './json/jsonEqual'
export {
  ANNOTATION_PAD,
  DEFAULT_NOTE_FONT,
  DEFAULT_STAMP_FONT,
  DEFAULT_STROKE,
  mixIntoWhite,
  NOTE_BAR_WIDTH,
  NOTE_LINE_HEIGHT,
  NOTE_MAX_WIDTH,
  NOTE_TINT,
  STAMP_ANGLE,
  STAMP_FILL_OPACITY,
  STAMP_TRACKING,
  stampTextWidth,
  UNBOUND_CHARS,
  UNBOUND_FONT,
  unboundSnippet,
  wrapText,
} from './markup/annotationLayout'
export type { Caret } from './markup/caret'
export { caretAt, caretX, clampOffset, snapToCaret } from './markup/caret'
export type { MarkInputs } from './markup/cueMarks'
export { markInputs, withMark } from './markup/cueMarks'
export type { CueTagInput, CueTagLayout, TextExtent } from './markup/cueTags'
export {
  BAR_OVERHANG,
  BAR_WIDTH,
  FREE_BAR_HEIGHT,
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_OPACITY_ACTIVE,
  HIGHLIGHT_PAD_X,
  HIGHLIGHT_RADIUS,
  LEADER_WIDTH,
  layoutCueTags,
  NOTE_FONT_SIZE,
  NOTE_HEIGHT,
  NOTE_MIN_COLUMN,
  POINTER_HEIGHT,
  POINTER_WIDTH,
  SELECTED_FILL_OPACITY,
  TAG_FONT_SIZE,
  TAG_RADIUS,
  textExtent,
  UNDERLINE_WIDTH,
} from './markup/cueTags'
export { helveticaBoldWidth, helveticaWidth } from './markup/helvetica'
export type { Box } from './markup/markers'
export { asCueType, markerLead, markerText, markerTypeWord } from './markup/markers'
export { wordBoxes } from './markup/wordBoxes'
export type { FooterInfo } from './print/footer'
export { footerText, layerSelectionLabel } from './print/footer'
export type { StampInclude, StampInput, StampItem } from './print/stampItems'
export { buildStampItems, PAGE_INK } from './print/stampItems'
export type { PageFrame, StampOptions } from './print/stampScript'
export { displayedToUser, PAPER_POINTS, stampScript } from './print/stampScript'
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
