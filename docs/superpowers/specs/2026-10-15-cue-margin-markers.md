# Cue margin markers

Status: approved by Jayden ("Fix it", 2026-10-15), with Cuelist reference renders. Amends spec 5.2 (overlay) and 5.3 (print) for how cue markers are drawn. Nothing about the data model changes.

## Problem

A cue marker is drawn as a box whose left edge is the anchor's x, with the label to its right. When a cue is anchored to a word (every `place_cue_at_text` cue, and any cue a person places over the text), the box and label are printed on top of the script's own words, and in print the label's 80% backing lets the script show through. The calling script becomes unreadable at exactly the line that matters.

## How a calling script is marked (reference)

In the reference renders, every cue is three parts:

1. A tag flush against the page edge, in the margin, level with the trigger line: an outlined rounded rectangle in the department colour with a solid coloured bar on its outer edge (with grip dots), the department code, a thin divider, and the cue number. The tag's body is opaque white.
2. The trigger words highlighted: a light fill of the department colour with a thin outline in the same colour, around exactly the words the cue goes on.
3. A thin leader rule in the department colour joining the tag to the highlight, running along the bottom edge of the tag and the highlight.

Departments sit on their own side: in one script lighting is on the left and sound on the right of the same page. Cue labels are not printed on the page.

## Design

All geometry is displayed page space (PDF points, origin bottom-left, after /Rotate), computed once in `@binder/core` and used by both the web overlay and print stamping, so screen and paper match.

**Tag**
- Height `TAG_HEIGHT = 14`, text 9 pt Helvetica (`helveticaWidth`), vertically centred on the cue's `anchor.y`.
- Parts from the outer edge inward: coloured bar 4 wide (three small white grip dots), padding 4, the lead text, padding 4, a 0.75 divider, padding 4, the number, padding 4.
- Lead text is the department code, prefixed `SB ` for standby and `W ` for warn (as `markerText` does today). Number is the formatted cue number.
- Body fill opaque white. Outline 1 pt in the department colour; dashed for standby, solid otherwise.
- Side: left tags start 4 pt inside the left page edge (`x = 4`); right tags end 4 pt inside the right edge (`x = width - 4 - w`).

**Crowding**: tags on the same side whose vertical extents overlap are laid side by side, moving inward: each later tag starts 2 pt beyond the previous tag's inner edge. Order: department sort order, then cue number, then id. The leader of each starts from its own tag's inner edge.

**Trigger highlight**: when the cue's anchor text is bound (`wordStart >= 0` and the page has its word layer), the boxes from core `wordBoxes(layer, anchor.text)` (one per line), each padded 1.5 pt, filled with the department colour at 15% opacity and outlined 0.75 pt in the department colour. When unbound or the words are unavailable, an 8 pt vertical tick in the department colour at `(anchor.x, anchor.y)` instead.

**Leader**: 0.75 pt in the department colour, horizontal at the tag's bottom edge (`anchor.y - TAG_HEIGHT / 2`). Left side: from the tag's right edge to the left edge of the first highlight box (or the tick). Right side: from the right edge of the first highlight box (or the tick) to the tag's left edge. No leader when the two already touch or overlap.

**Labels**: not drawn on the page, on screen or in print. A cue's label stays in the tag's accessible name and hover title, the cue editor, cue lists and cue sheets.

**Side per department**: show setting `settings.markerSides`, a map of department id to `'left' | 'right'`, default `'left'`. Read with `markerSide(settings, departmentId)` in `@binder/shared`. The owner sets it per department on the show settings page; non-owners see it read-only. It is saved through the existing show-update path, which already enforces owner only. The web overlay, browser print and server `exportMarkedScript` all read it, so every surface matches. No migration.

**Interaction (web)**
- The tag is the focusable, labelled control (as the marker is today): click, Enter or Space selects. Clicking the trigger highlight also selects. The selection outline and peer presence outlines are drawn around the tag.
- Dragging the tag moves the cue vertically: on drop, the cue snaps to the text line under the pointer. Its trigger starts at the word nearest the pointer when the pointer is within that line's horizontal extent, otherwise at the line's first word, with the usual quote of up to eight words (`snapToLine`). Status becomes `ok`.
- Placing a cue with the cue tool is unchanged: the click point picks the line and trigger word.
- AI placement (`place_cue_at_text`) is unchanged: it already anchors x and the trigger words to the matched text, which now draws as highlight, leader and margin tag.

**Unchanged**: anchors and their stored x and y, snapping, re-anchoring, annotations (notes, shapes, stamps, highlights), the footer, the cue editor, cue lists and sheets.
