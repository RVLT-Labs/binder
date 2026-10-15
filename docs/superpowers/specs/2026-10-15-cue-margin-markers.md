# Cue margin markers

Status: approved by Jayden ("Fix it", 2026-10-15), with Cuelist reference renders. Amends spec 5.2 (overlay) and 5.3 (print) for how cue markers are drawn. Nothing about the data model changes.

## Problem

A cue marker is drawn as a box whose left edge is the anchor's x, with the label to its right. When a cue is anchored to a word (every `place_cue_at_text` cue, and any cue a person places over the text), the box and label are printed on top of the script's own words, and in print the label's 80% backing lets the script show through. The calling script becomes unreadable at exactly the line that matters.

## How a calling script is marked

A calling script needs three things, and Binder draws each in its own way (the Cuelist renders were a reference for what a script needs, not a look to copy):

1. A marker in the margin, level with the line, on the department's own side of the page: lighting on the left and sound on the right of the same page.
2. The trigger words marked in place.
3. A thin connector joining the two.

Cue labels are not printed on the page.

## Design

All geometry is displayed page space (PDF points, origin bottom-left, after /Rotate), computed once in `@binder/core` and used by both the web overlay and print stamping, so screen and paper match.

**Tag** (core `layoutCueTags`; the web overlay and print stamping both draw from it)
- A plain pill: `TAG_HEIGHT = 14`, a corner radius of half its height, an opaque white body and an outline in the department colour. No edge bar, grip dots or divider.
- Two words set at 9 pt Helvetica: the department code in the department colour, a 3 pt gap, then the cue number in dark ink, bold (Helvetica-Bold in print, `font-weight: 700` on screen). Padding 6 pt at each end. Widths come from `helveticaWidth` and `helveticaBoldWidth`, centred vertically on the cue's `anchor.y`.
- Lead text is the department code, prefixed `SB ` for standby and `W ` for warn (as `markerText` does). The number is the formatted cue number.
- Outline: go solid 1 pt; standby dashed 1 pt; warn solid 1.5 pt.
- Side: left tags start 4 pt inside the left page edge (`x = 4`); right tags end 4 pt inside the right edge (`x = width - 4 - w`). The text still reads code then number on both sides.

**The margin and crowding**
- A tag never enters the text block. The usable margin is measured from the page's word layer: its left limit is the leftmost word's x minus 4 pt, its right limit the rightmost word's right edge plus 4 pt. A page with no word layer uses a 56 pt margin on each side. A tag fits between the 4 pt edge inset and that limit.
- Tags on the same side whose vertical extents overlap are stacked vertically in the margin, never side by side over the text: each later tag sits `TAG_HEIGHT + 2` below the previous one, flush at the same x. Order: department sort order, then cue number, then id. Each stacked tag keeps its own connector, level with that tag.
- A tag wider than its margin shrinks in this order until it fits: drop the `SB ` / `W ` word (the dashed or heavier outline still says which), then drop the department code (the pill's outline still carries the department colour). As a last resort the number-only tag sits at the page edge over the text; the number is never truncated.

**Trigger marking**: when the cue's anchor text is bound (`wordStart >= 0` and the page has its word layer), each box from core `wordBoxes(layer, anchor.text)` (one per line) is underlined: a 1.5 pt line in the department colour along the box's bottom edge, 1 pt below it. Print never fills. On screen, while the cue is selected or hovered (its tag or its words), its boxes also get a 10% fill of the department colour. When unbound or the words are unavailable, an 8 pt vertical tick in the department colour at `(anchor.x, anchor.y)` stands in.

**Connector**: 0.75 pt in the department colour, always drawn at the trigger underline's y (for an unbound cue, the bottom of the tick), so it never crosses a glyph. On the left side it runs from the tag's inner (right) edge to the left end of the first underline (or to the tick); on the right side from the right end of the underline to the tag's inner (left) edge. No connector when they already touch or overlap.
- A tag level with its line (the underline within the tag's vertical extent): a straight run at the underline's y. It starts a radius inside the pill's inner edge, under the opaque body, so it meets the outline. Reads as the underline running out to the tag.
- A tag pushed off its line by stacking (the underline outside its vertical extent): three segments with square joins. It leaves the tag's inner edge at the tag's vertical centre, runs to a gutter just outside the text block (the text block's left edge minus 2 pt on the left; its right edge plus 2 pt on the right; 56 pt margins when the page has no word layer), turns along the gutter to the underline's y, and runs in to the underline end.

**Labels**: not drawn on the page, on screen or in print. A cue's label stays in the tag's accessible name and hover title, the cue editor, cue lists and cue sheets.

**Side per department**: show setting `settings.markerSides`, a map of department id to `'left' | 'right'`, default `'left'`. Read with `markerSide(settings, departmentId)` in `@binder/shared`. The owner sets it per department on the show settings page; non-owners see it read-only. It is saved through the existing show-update path, which already enforces owner only. The web overlay, browser print and server `exportMarkedScript` all read it, so every surface matches. No migration.

**Interaction (web)**
- The tag is the focusable, labelled control (as the marker is today): click, Enter or Space selects. Clicking the trigger words also selects (with the select tool). The selection outline and peer presence outlines are drawn around the tag.
- Dragging the tag moves the cue vertically: on drop, the cue snaps to the text line under the pointer. Its trigger starts at the word nearest the pointer when the pointer is within that line's horizontal extent, otherwise at the line's first word, with the usual quote of up to eight words (`snapToLine`). Status becomes `ok`.
- Placing a cue with the cue tool is unchanged: the click point picks the line and trigger word.
- AI placement (`place_cue_at_text`) is unchanged: it already anchors x and the trigger words to the matched text, which now draws as margin tag, connector and underline.

**Unchanged**: anchors and their stored x and y, snapping, re-anchoring, annotations (notes, shapes, stamps, highlights), the footer, the cue editor, cue lists and sheets.
