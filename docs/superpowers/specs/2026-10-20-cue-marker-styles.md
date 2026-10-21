# Cue marker styles, mid-word lines and movable bubbles

Status: design approved by Jayden in conversation, 2026-10-20 (draft for written review). Amends the cue margin markers spec (`2026-10-15-cue-margin-markers.md`) in three places: how the trigger is marked, how the connector is drawn, and what dragging the tag does. It deliberately overrides one line of that spec: "Print never fills" no longer holds for the highlight mark.

## Problem

A cue's trigger is always drawn the same way: its words underlined, a margin tag, and a connector between them. Three things Jayden wants that the model cannot say today:

1. **Highlight the trigger text** instead of underlining it.
2. **Put a cue between two characters**, including in the middle of a word. The anchor's smallest unit is a whole word, so a cue cannot point at the syllable a call falls on.
3. **Move the bubble.** The tag always sits in the margin, and dragging it re-places the cue. There is no way to put the bubble somewhere else, for instance where the margin is crowded.

And one styling want: how heavy the connector is, and whether it is solid, dashed or dotted, per department.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | The mark is chosen **per cue**: `underline` (today, and the default), `highlight`, `line`, `pointer` (a line with a small pointer on top) | Jayden: per cue, so one page can mix a highlight, an underline and a mid-word line. Both line looks wanted. |
| 2 | A line sits on a **character boundary** inside a word, not at a free x | A free x cannot be re-anchored to the same spot in a revision; a (word, character) pair can. |
| 3 | New data lives **inside the existing `anchor` JSON**, all optional | The anchor already flows whole through the sync policy, the local SQLite, history and revert. No migration, no PowerSync schema, stream or policy change. |
| 4 | Dragging the bubble **moves only the bubble**; the cue moves by dragging its mark | Works on a touch screen with no modifier key. Replaces the old "drag the tag to re-place the cue". |
| 5 | The bubble's override is a **relative offset** from the cue's anchor point | It travels with the cue through a revision and a re-placement. |
| 6 | Connector width and pattern are a **per-department show setting**, next to the margin side | The side is already `settings.markerSides`; this follows the same route, owner-only, no migration. |
| 7 | Highlight is a **translucent fill, in print too** | The department colour at about 28% keeps the ink readable, including on a black-and-white copy. Recorded in `DESIGN.md`. |

## Non-goals

- Highlighting or underlining part of a word. Ranges stay whole words; only the line is character-level.
- A per-cue connector style, or per-cue mark colour. Department colour stays the only colour on the page.
- Moving a bubble to another page, or changing the `highlight` **annotation** (a separate thing: notes, shapes, stamps, highlights on the annotation layers).
- Changing cue sheets, cue lists or the revision thumbnails. They show numbers and positions, not marks.

## Data model

All fields are optional. A cue without them draws exactly as it does today.

```ts
type CueMark = 'underline' | 'highlight' | 'line' | 'pointer'

interface Anchor {
  // ...existing fields...
  mark?: CueMark                     // cues only; absent means 'underline'
  tag?: { dx: number; dy: number }   // cues only; the bubble's offset from (x, y); absent means auto-margin
  text?: TextAnchor & { offset?: number }
}
```

- **`mark`** says how the trigger is drawn. `underline` and `highlight` draw over the anchor's word range (`wordStart` to `wordEnd`). `line` and `pointer` ignore the range for drawing and draw one bar at `offset`; the range stays as the quote that re-anchoring finds.
- **`text.offset`** is a character boundary inside the word at `wordStart`: 0 is before its first character, the word's length is after its last. Only meaningful with `line` and `pointer`. Drawing clamps it to the word's current length, so a stale offset never draws outside the word.
- **`tag`** is `{dx, dy}` in page points, finite, each within +/-14400. The bubble's centre is drawn at `(anchor.x + dx, anchor.y + dy)`. Absent means the margin layout decides.
- **`x` and `y`** keep meaning "where the mark is". For a line, the stored `x` is the bar's x and `y` is the line's centre, so a client or agent that only reads `x`/`y` still lands in the right place.
- **Unbound cues** (`wordStart` of -1, or a page with no word layer): `line` and `pointer` draw a free bar at `(x, y)` (14 pt tall, centred on `y`); `underline` and `highlight` fall back to today's tick, since there is nothing to underline or fill.
- **Highlight range and quote.** A highlight's quote is its whole range (cut at 400 characters on a word boundary), not the usual first eight words, so re-anchoring finds and keeps the whole phrase. A range longer than its cut quote loses the cut tail when re-anchored and is flagged `approximate`, which puts it in the review list rather than silently shrinking. The same holds for an underline dragged out with the cue tool, which also keeps its whole range.

### Validation (`packages/shared`)

- `anchorSchema` gains `mark`, `tag` and `text.offset`. **This is required**: zod's `z.object` strips keys it does not know, so without it the fields vanish on the way through the sync policy.
- Annotation rules (`annotationFieldsSchema`) reject `mark`, `tag` and `text.offset`: they are cue-only, and a stray field is refused rather than stored.
- `text.offset` requires a bound word (`wordStart >= 0`) and a `mark` of `line` or `pointer`.
- `CueMark` and a `markOf(anchor)` helper (absent becomes `'underline'`) live in `packages/shared/src/markup.ts` beside `markerSide`.

### Re-anchoring (`packages/core/src/anchors/reanchor.ts`)

`mark` and `tag` already survive: `place()` and `positional()` spread the old anchor. What they rebuild is `text`, so they must carry `offset` across, clamped to the matched word's length. When the quote is not found, `positional()` leaves the text unbound as it does now; a `line` cue then draws its free bar at the clamped position and is `approximate` or `unresolved` as usual. For a line, the stored `x` is recomputed from the new word box and the offset, not from the old x relative to the old line.

## Where a line stands

New in `packages/core/src/markup` (`caret.ts`):

- `caretX(word, offset)`: `word.x + word.w * share`, where `share` is the width of the first `offset` characters over the width of the whole word, using `helveticaWidth` over the word's code points (it already measures a character outside WinAnsi as a typical letter), and the word's left edge for a zero-width word.
- `snapToCaret(layer, point)`: finds the line like `snapToLine`, then the character boundary whose `caretX` is nearest `point.x`, across the whole line (so the line can sit between two words, at the end of one word or the start of the next).

Every character boundary of every word on the line is a candidate, including each word's start (`offset` 0) and end (`offset` equal to its length). They are different points on the page, so a boundary is stored on the word it belongs to, and the stored quote starts at that word, as every quote starts at `wordStart`.

The same function draws and snaps, so what the preview shows is what is stored and printed. Helvetica widths are an approximation for a script set in another face; the preview is the check, and a boundary within a point or two of the glyph edge is the expected accuracy.

## Drawing (`packages/core`)

`layoutCueTags` stays the single source for the web overlay, browser print and server `exportMarkedScript`. `CueTagInput` gains `mark`, a `caret` (`{x, box}` for a line, from `caretX`), `tag` (the offset or null) and `connector` (width and pattern). `CueTagLayout` gains `mark`, `fills`, `bar`, `moved` and the connector's stroke.

| Mark | Drawn as | Connector ends at |
|---|---|---|
| `underline` | today: 1.5 pt line 1 pt under each line's box | the left (or right) end of the first underline |
| `highlight` | one rounded rectangle (2 pt radius, 1 pt side padding) per line of the range, the department colour at 28% (`HIGHLIGHT_OPACITY`); no underline | the bottom edge of the first box, at the underline's y |
| `line` | a 1.5 pt bar at `caretX`, the word box's height plus 3 pt above and below | the bar, at the underline's y |
| `pointer` | the same bar plus a filled triangle on top (6 pt wide, 5 pt tall) | as `line` |

- **Selection on screen.** An underline keeps today's 10% fill while selected or hovered. A highlight deepens from 28% to 40%. A line and a pointer get a 10% fill on their word, so the cue's context shows.
- **Print.** The highlight fill is drawn translucent over the page text. Use multiply blending where the drawing backend supports it (so black text stays black), plain opacity otherwise; the plan verifies pdf-lib's support. This is the one place the "print never fills" rule is relaxed. A dashed or dotted connector restarts its pattern at each corner of a jogged connector in print; accepted.
- **Order unchanged.** Fills and underlines and connectors first, then annotations, then the opaque tags.

### Moved bubbles

- The tag's centre is `(anchor.x + dx, anchor.y + dy)`, clamped to the page's width and to the same vertical `bounds` as auto tags (so it cannot land in the footer).
- A moved bubble takes no part in margin stacking: other tags do not step around it, and it never steps around them.
- It always shows the full lead (department and type word); the margin shrink ladder is for margin tags.
- It draws no cue note: a note printed under a bubble on top of script text would hide the script. The note remains in the cue editor and the hover title.
- Its connector is one straight segment from the tag's centre (hidden under the opaque body, so it meets the outline) to the mark's target. It may cross text; the bubble was put there on purpose. No connector when the bubble overlaps the mark.
- The parallel-leader stagger does not apply to moved bubbles.

### Connector style

`settings.connectorStyles` maps a department id to `{ width: 'thin' | 'medium' | 'bold', pattern: 'solid' | 'dashed' | 'dotted' }`. Read with `connectorStyle(settings, departmentId)` in `@binder/shared`; anything missing or malformed is `thin` and `solid`, which is today's 0.75 pt line.

| Width | Weight `w` |
|---|---|
| thin | 0.75 pt (today's line) |
| medium | 1.5 pt |
| bold | 2.5 pt |

Solid is a plain stroke. Dashed repeats a dash of `4w` and a gap of `2.5w`. Dotted uses round caps with a zero-length dash and a gap of `2.5w`, so the dots scale with the weight. The stagger between parallel connectors on one line and side becomes `max(LEADER_STEP, w + 0.75)`, so heavy connectors do not merge. Two connectors on one line can belong to departments with different widths, so the offsets accumulate pairwise in placement order: `offset_i = offset_prev + max(LEADER_STEP, (w_prev + w_i) / 2 + 0.75)`, the first connector having offset 0. For equal widths this is exactly `max(LEADER_STEP, w + 0.75)`, and for thin it is exactly today's 1.5 pt, so existing shows are unchanged. A thin connector never crosses a glyph; a heavier one staggered under a crowded line can touch the line below (the formula puts the second bold connector about 3.25 pt under the underline). The tag's own outline (standby dashed, warn heavier) is separate and unchanged. It reaches core through `buildStampItems`, which already receives the show's `settings`, and through the web overlay's session.

## Interaction (web)

### Placing

The cue flyout (the one that holds the cue type) gains a **Mark** choice: Underline, Highlight, Line, Line + pointer. It is remembered the way the cue type is.

- **Underline.** A click is today's behaviour. A drag selects a range (`wordRangeFromDrag`).
- **Highlight.** A click takes the one word under the pointer; a drag selects a range. The quote is the whole range.
- **Line / pointer.** Hovering shows a ghost bar at the snapped character boundary; a click places it. Within `SNAP_DISTANCE_PT` of a text line it snaps with `snapToCaret`; farther away, or with Snap off, it places a free bar at the pointer.
- **Snap off.** Underline and highlight behave as today (an unbound tick); a line still places, as a free bar.

### Editing

- The cue editor gets a **Mark** control (Segmented, the same four) under Type. Switching between underline and highlight keeps the range. Switching to a line puts it at the start of the first word; switching away from a line underlines the quote's words.
- It gets a **Bubble** row: "In the margin" or "Moved", and a **Reset to margin** button when moved (clears `tag`).

### Dragging

- **The bubble** (selected cues only, as today): drag moves only the bubble and writes `tag` on drop, with a live preview of the pill while dragging. A drop off the page changes nothing. With the bubble focused, Alt+arrow keys nudge it 1 pt (10 pt with Shift), so it is keyboard-operable; plain arrows are not intercepted and still turn the page.
- **The mark** (selected cues only): dragging the highlight, the underlined words or the bar re-places the cue with today's snapping (the old tag-drag behaviour, including the first-word rule), and keeps its `mark` and `tag`. On a touch screen the mark gets a 44 px hit area (`pointer-coarse`).
- Moving a cue with "Move to..." (`relocate`) is unchanged.

### Settings page

The departments table gains **Connector width** and **Connector pattern** Segmented controls beside Marker side, for the owner; everyone else sees them read-only. They write `settings.connectorStyles` through the same local write `useMarkerSides` uses, reading the latest settings just before writing so a change made elsewhere is not overwritten.

Everything is a local write that syncs up. Nothing here needs the network.

## API, sync and MCP

- **Sync policy / client schema / stream config:** unchanged. The policy parses cue anchors with `anchorSchema`, which now accepts the new fields.
- **Services:** `createCue` / `updateCue` take the richer anchor; `placeCueAtText` accepts `mark` and `charOffset`.
- **History:** `packages/core/src/history/summarise.ts` calls any cue `anchor` change "moved". An update whose anchors differ only in `mark` reads "restyled"; only in `tag`, "bubble moved". The history panel's verb text is updated to match.
- **MCP** (the capability must be in MCP; no new tool name is added, so `mcpParity` is unaffected):
  - `place_cue_at_text`: optional `mark` (default `underline`) and `charOffset` (a whole number, only with `line` / `pointer`; a boundary inside the quote's first word, default 0). A `highlight` covers the whole matched quote.
  - `create_cue` and `update_cue`: the `anchor` placement (coordinates only, so it binds no word) accepts `mark` and `bubble`; a `line` or `pointer` placed this way is a free bar at `(x, y)`. `update_cue` also takes top-level `mark`, `charOffset` and `bubble` (`{dx, dy}`, or `null` to reset to the margin) that apply to the cue's current anchor; `charOffset` is an error on a cue with no bound word, and any of the three is an error if the cue is unplaced.
  - `update_show` settings: `connectorStyles` joins `paperSize`, `stampSet` and `markerSides` as a key the app reads.
- **Docs, same change** (`skillDocs.test.ts` fails otherwise): `skills/binder/references/tools.md`, `placing-cues.md` ("How a cue looks"), `data-model.md` (anchor fields and settings keys), `exports-and-print.md`, `workflows.md`.

## Compatibility and risk

- **Old data:** nothing to migrate. Every existing cue is an underline with an auto-margin bubble.
- **Old web clients.** A cached PWA that has not been reloaded builds a fresh anchor when it moves a cue, so the move would silently drop `mark`, `tag` and `offset`. The service worker only updates when the user taps Reload. The new client carries those fields on every move; the old-client case is accepted (single-user in practice) and noted in the changelog.
- **Character positions** use Helvetica proportions; a script in another face can be a point or two off. The preview shows the true result.
- **Long highlights** lose a cut tail on re-anchor (flagged `approximate`, as above).
- **Calling mode** and the revision review thumbnails read cue anchors; the plan checks each still renders sensibly with the new marks.

## Delivery

One spec, three phases, each shippable on its own:

1. **Marks.** Shared types and schema, `caretX` / `snapToCaret`, core layout and stamping, the web drawing, the cue tool's Mark choice, the cue editor's Mark control, re-anchoring, history verbs, MCP and docs.
2. **Movable bubble.** `tag` in layout and stamping, bubble drag and nudge, Reset to margin, the mark drag, the editor row, MCP `bubble`.
3. **Connector styles.** `connectorStyles` setting, the reader, the settings controls, layout and stamping strokes, MCP docs.

Each phase ends with `pnpm lint`, `pnpm typecheck` and the tests for what it touched, an e2e pass, and phone, tablet and desktop screenshots for Jayden. The decision goes in the `DESIGN.md` log and `CHANGELOG.md` (Unreleased); the margin-markers spec gets a line pointing here.

## Testing

- **core:** `caretX` and `snapToCaret` (word edges, between words, zero-width words, non-Latin fallback); `layoutCueTags` for each mark, a moved bubble (clamping, no stacking, connector), connector widths and patterns, selected-state opacity; `reanchor` carrying `offset`, `mark`, `tag` (match, several matches, positional fallback, a shorter word); history verbs.
- **shared:** schema accepts and rejects the new fields (including on annotations); `connectorStyle` and `markOf` fall back on malformed settings.
- **api:** sync policy round-trips the new anchor; `placeCueAtText` with each mark; `update_cue` with `mark`, `charOffset`, `bubble`; `update_show` with `connectorStyles`; print export draws a highlight and a line; `skillDocs` and `mcpParity`.
- **web:** placement for each mark and snap on/off; the editor's Mark and Bubble controls; bubble drag, nudge, reset and the mark drag (the old tag-drag tests move to the mark); the settings controls; `responsive.spec.ts` (no sideways scroll at 390 px, 44 px targets).
- **e2e:** place one of each mark, drag a bubble and reset it, restyle a cue, set a department's connector style and see it on the page and in the print preview.
