# Cue Marker Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each cue be marked by an underline, a highlight, or a vertical line (with or without a pointer) placed on any character boundary, let its bubble be moved off the margin, and let the owner set the connector's width and pattern per department.

**Architecture:** Everything rides inside the cue's existing `anchor` JSON (`mark`, `tag`, `text.offset`) and the show's `settings` (`connectorStyles`), so there is no migration, sync-policy or PowerSync change. `@binder/core` draws all of it once (`layoutCueTags`, `stampScript`), and the web overlay, browser print and server export read that one layout.

**Tech Stack:** TypeScript, zod, vitest, pdf-lib, React 19 + SVG overlay, Hono + MCP server, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-cue-marker-styles.md` (read it first; it holds the reasoning and every geometry value).

## Global Constraints

- Conventions: run everything from the repo root with `export PATH="$HOME/Library/pnpm:$PATH"`. Commit with `git -c commit.gpgsign=false commit`, a conventional message, and the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never pipe `pnpm lint` into `tail`; read the real exit code. Web unit tests: `cd apps/web && pnpm exec vitest run <file>`. e2e only through `pnpm e2e <spec>` at the root.
- `packages/core` stays pure and browser-runnable (no Node APIs). Business rules live in `apps/api/src/services`; a capability is not done until it is in MCP and `skills/binder/references/*` (`skillDocs.test.ts` enforces it). Anything new works offline (local writes).
- No literal hex in web components; the department colour is data and comes from the cue row. Touch targets are 44 px on `pointer-coarse`, text at least 11 px.
- Spec values, verbatim: `HIGHLIGHT_OPACITY` 0.28, `HIGHLIGHT_OPACITY_ACTIVE` 0.4, highlight radius 2 pt, side padding 1 pt; `BAR_WIDTH` 1.5 pt, `BAR_OVERHANG` 3 pt above and below the word box; pointer triangle 6 pt wide, 5 pt tall; free bar 14 pt tall centred on `y`; selected underline keeps `SELECTED_FILL_OPACITY` 0.1; quote cut at 400 characters on a word boundary; `tag` `dx`/`dy` finite and within +/-14400; bubble nudge 1 pt, 10 pt with Shift; connector widths thin 0.75 / medium 1.5 / bold 2.5 pt, dashed `4w` on `2.5w` off, dotted round caps `0` on `2.5w` off, parallel-connector step `max(LEADER_STEP, w + 0.75)`.
- Existing cues (no new fields) must render exactly as today: every existing core, web and api test keeps passing unchanged unless a task says it changes.

## Review Focus

- A word whose characters are not all single UTF-16 units, or a zero-width word: a line offset must never give `NaN` or draw outside the word (Task 2).
- A highlight longer than eight words must survive a revision at its full length, not shrink to eight (Task 6).
- Reverting a restyle or a bubble move in History must restore the old mark or offset (Tasks 11 and 13).
- A moved bubble dropped near an edge or the footer stays on the page and out of the footer; a drop off the page changes nothing (Tasks 13 and 14).
- A page whose word layer is missing (no text, or its blob not cached offline): every mark falls back to a tick or a free bar and nothing throws (Tasks 5 and 9).

---

## Phase 1: Mark styles

### Task 1: Shared types and schema

**Files:**
- Modify: `packages/shared/src/markup.ts`, `packages/shared/src/markupSchemas.ts`
- Test: `packages/shared/src/markupSchemas.test.ts`

**Interfaces:**
- Produces (`@binder/shared`): `type CueMark = 'underline' | 'highlight' | 'line' | 'pointer'`; `const CUE_MARKS: readonly CueMark[]`; `interface BubbleOffset { dx: number; dy: number }`; `TextAnchor` gains `offset?: number`; `Anchor` gains `mark?: CueMark` and `tag?: BubbleOffset`; `markOf(anchor: { mark?: CueMark } | null | undefined): CueMark` (absent is `'underline'`); `isCaretMark(m: CueMark): m is 'line' | 'pointer'`; `QUOTE_MAX_CHARS = 400`.

- [ ] **Step 1: Write the failing tests** in `markupSchemas.test.ts`:
  - `anchors accept mark, tag and a text offset on a line`: `{...anchor, mark:'line', tag:{dx:-30,dy:12}, text:{quote:'welcome',wordStart:4,wordEnd:4,offset:3}}` parses.
  - `a text offset needs a bound word and a line or pointer mark`: offset with `mark` absent or `'highlight'` fails; offset with `wordStart: -1` fails; offset with `'pointer'` passes.
  - `an unknown mark, a non-finite tag and a tag beyond 14400 are refused`.
  - `annotations refuse mark, tag and text offset`: `annotationFieldsSchema('create')` on a note and on a highlight with each field fails.
  - `markOf treats a missing mark as underline`; `isCaretMark` is true only for line and pointer.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/shared/src/markupSchemas.test.ts`. Expected: the new tests fail (`markOf` undefined, fields stripped).
- [ ] **Step 3: Implement.** In `markup.ts` add the types, `CUE_MARKS`, `markOf`, `isCaretMark`, `QUOTE_MAX_CHARS`. In `markupSchemas.ts` add `offset` (int, 0 to 1000) to `textAnchorSchema`, `mark` (enum of `CUE_MARKS`) and `tag` (two bounded finite numbers) to `anchorSchema`, and a `superRefine` on `anchorSchema` enforcing the offset rule. In `annotationFieldsSchema`'s `superRefine`, add an issue for any of the three on an annotation anchor. zod strips unknown keys, which is why the fields must be in the schema.
- [ ] **Step 4: Run** the same command plus `pnpm --filter @binder/shared typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): cue mark, bubble offset and character offset on the anchor`.

### Task 2: Core caret geometry

**Files:**
- Create: `packages/core/src/markup/caret.ts`, `packages/core/src/markup/caret.test.ts`
- Modify: `packages/core/src/index.ts` (export the new symbols)

**Interfaces:**
- Consumes: `helveticaWidth` (`./helvetica`), `lineCentreY` (`../anchors/snap`), `Box` (`./markers`), `SNAP_DISTANCE_PT`, `QUOTE_MAX_WORDS`, `TextAnchor`, `WordLayer` (`@binder/shared`).
- Produces: `interface Caret { x: number; box: Box }` (`box` is the word's box); `clampOffset(text: string, offset: number): number` (an integer within 0 to the code-point count); `caretX(word: { x: number; w: number; t: string }, offset: number): number`; `caretAt(layer: WordLayer, text: { wordStart: number; offset?: number }): Caret | null`; `snapToCaret(layer: WordLayer, point: { x: number; y: number }, maxDistance?: number): { x: number; y: number; text: TextAnchor & { offset: number } } | null`.

- [ ] **Step 1: Write the failing tests** in `caret.test.ts`:
  - `caretX: offset 0 is the word's left edge and the full length is its right edge`.
  - `caretX: a middle offset is proportional to Helvetica widths` (`welcome`, `w` 70, offset 3 gives `x + 70 * helveticaWidth('wel',10) / helveticaWidth('welcome',10)`, `toBeCloseTo`).
  - `caretX: a zero-width word, a surrogate-pair emoji and a combining accent give a finite x inside [x, x + w]` (Review Focus 1).
  - `clampOffset clamps negatives to 0 and large values to the length`.
  - `caretAt: unbound text gives null; an offset past the word's length clamps; the box is the word's box`.
  - `snapToCaret: a point on a boundary inside a word returns that offset; a point in the gap after a word returns the nearer of that word's end and the next word's start; left of the line starts at the first word at 0; right of it ends at the last word at its length; farther than maxDistance from every line gives null`.
  - `snapToCaret: the text starts at the chosen word and runs to the line end, up to eight words, with y the line centre and x the caret x`.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/core/src/markup/caret.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the four functions. Measure by `Array.from(word.t)` code points; `share = width(first offset code points) / width(whole word)`, and `word.x` when the whole width is 0. `snapToCaret` finds the line like `snapToLine` (nearest centre within `maxDistance`), then scans every boundary of every word on that line for the smallest `|caretX - point.x|`.
- [ ] **Step 4: Run** the test and `pnpm --filter @binder/core typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): character-boundary geometry for line marks`.

### Task 3: Core range and word snapping, quote cut

**Files:**
- Modify: `packages/core/src/anchors/snap.ts`, `packages/core/src/anchors/quote.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/anchors/snap.test.ts`, `packages/core/src/anchors/quote.test.ts`

**Interfaces:**
- Produces: `cutQuote(words: readonly string[]): string` (joined with spaces, cut on a word boundary so the result is at most `QUOTE_MAX_CHARS`; always keeps the first word); `rangeText(layer: WordLayer, from: number, to: number): TextAnchor` (word indices in either order; `wordStart` the smaller; quote is the whole range through `cutQuote`); `snapToWord(layer: WordLayer, point: { x: number; y: number }, maxDistance?: number): { x: number; y: number; text: TextAnchor } | null` (nearest line within distance, then the word nearest `point.x`; one-word range; `x` is the word's left edge); `anchorAtMatch(stream, m, to, maxWords = QUOTE_MAX_WORDS)` gains the fourth argument and builds its quote with `cutQuote`.

- [ ] **Step 1: Write the failing tests:**
  - `cutQuote: short text is unchanged; long text is cut on a word boundary at or under 400 characters; one huge word is kept whole`.
  - `rangeText: indices in either order give the same range; the quote is every word; a 60-word range cuts at 400 characters but wordEnd stays the last word`.
  - `snapToWord: picks the word under the pointer; left of the line picks the first word; no line in range gives null`.
  - `anchorAtMatch with Infinity covers the whole match; the default still stops at eight words`.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/core/src/anchors/snap.test.ts packages/core/src/anchors/quote.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** `anchorAtMatch`'s `wordEnd` is the last matched word on the start page within `maxWords`.
- [ ] **Step 4: Run** the same command. Expected: PASS, with every pre-existing test in both files unchanged.
- [ ] **Step 5: Commit** `feat(core): word and range snapping and a bounded quote`.

### Task 4: Core mark inputs and mark switching

**Files:**
- Create: `packages/core/src/markup/cueMarks.ts`, `packages/core/src/markup/cueMarks.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `markOf`, `isCaretMark`, `Anchor`, `CueMark` (Task 1); `caretAt`, `caretX`, `Caret` (Task 2); `wordBoxes` (`./wordBoxes`).
- Produces: `interface MarkInputs { mark: CueMark; triggerBoxes: Box[]; caret: Caret | null }`; `markInputs(words: WordLayer | null | undefined, anchor: Pick<Anchor, 'mark' | 'text'>): MarkInputs`; `withMark(anchor: Anchor, mark: CueMark, opts?: { layer?: WordLayer | null; offset?: number }): Anchor`.

- [ ] **Step 1: Write the failing tests:**
  - `markInputs: underline and highlight return the range's boxes and no caret`.
  - `markInputs: line and pointer return only the first word's box as the trigger box, plus the caret`.
  - `markInputs: no layer, or an unbound text, returns no boxes and no caret for every mark` (Review Focus 5).
  - `withMark: the same mark returns an equal anchor; underline removes the key so old shapes stay old`.
  - `withMark: to line on a bound anchor sets offset 0 (or opts.offset, or keeps the existing one) and, given the layer, sets x to the caret x`.
  - `withMark: from line to underline or highlight drops the offset and keeps the range`.
  - `withMark: to line on an unbound anchor adds no offset and leaves x and y`.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/core/src/markup/cueMarks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both functions; `withMark` never mutates its input.
- [ ] **Step 4: Run** the test and the core typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): derive a cue's mark geometry and switch marks`.

### Task 5: Core layout for the marks

**Files:**
- Modify: `packages/core/src/markup/cueTags.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/markup/cueTags.test.ts`

**Interfaces:**
- Consumes: `Caret` (Task 2), `CueMark` (Task 1).
- Produces: constants `HIGHLIGHT_OPACITY`, `HIGHLIGHT_OPACITY_ACTIVE`, `HIGHLIGHT_RADIUS`, `HIGHLIGHT_PAD_X`, `BAR_WIDTH`, `BAR_OVERHANG`, `POINTER_WIDTH`, `POINTER_HEIGHT`, `FREE_BAR_HEIGHT` (values in Global Constraints). `CueTagInput` gains `mark?: CueMark` (absent is underline) and `caret?: Caret | null`. `CueTagLayout` gains `mark: CueMark`, `fills: Box[]` (the trigger boxes padded by `HIGHLIGHT_PAD_X`; highlight only), `bar: { x: number; y1: number; y2: number; pointer: boolean } | null` (`y1` bottom, `y2` top, as `tick`).

- [ ] **Step 1: Write the failing tests** (the new `cue()` overrides take `mark` and `caret`):
  - `underline: layout is unchanged when mark is absent` (the existing tests are the proof; add one asserting `mark === 'underline'`, `fills` empty, `bar` null).
  - `highlight: one fill per trigger box, padded 1 pt each side, no underlines, no tick; the leader ends at the first box's outer edge at box.y - UNDERLINE_DROP`.
  - `highlight with no trigger boxes falls back to the tick`.
  - `line: bar.x is the caret x and spans the word box height plus BAR_OVERHANG above and below; no underlines; triggerBoxes kept for the selection fill; leader ends at the bar x at box.y - UNDERLINE_DROP`.
  - `pointer: same bar with pointer true`.
  - `line with no caret: a free bar of FREE_BAR_HEIGHT centred on y at anchorX, leader ends at its bottom` (Review Focus 5).
  - `a line to the right of the tag edge on a left tag draws a leader; a bar under the tag draws none`.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/core/src/markup/cueTags.test.ts`. Expected: new tests FAIL, old ones pass.
- [ ] **Step 3: Implement** in `layoutOne` and `markTarget`: choose the geometry by `mark`; keep the connector logic as it is, only the target changes. Export the constants and types from `index.ts`.
- [ ] **Step 4: Run** the same file and the core typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): lay out highlight, line and pointer marks`.

### Task 6: Core re-anchoring

**Files:**
- Modify: `packages/core/src/anchors/reanchor.ts`
- Test: `packages/core/src/anchors/reanchor.test.ts`

**Interfaces:**
- Consumes: `caretX` (Task 2), `anchorAtMatch(..., maxWords)` (Task 3), `markOf` (Task 1).

- [ ] **Step 1: Write the failing tests:**
  - `a line keeps its offset, clamped to the matched word's new length, and its x is the new caret x`.
  - `a line whose quote is not found goes positional: the text is unbound, the offset is dropped, mark and tag survive, and the status is approximate or unresolved as before`.
  - `mark and tag survive a match, several matches, and the safe fallbacks`.
  - `a highlight of twelve words keeps all twelve after a revision that moves it` (Review Focus 2).
  - `a highlight whose quote was cut at 400 characters comes back approximate`.
  - `an eight-word underline re-anchors exactly as before` (guards the uncapped match).
- [ ] **Step 2: Run** `pnpm exec vitest run packages/core/src/anchors/reanchor.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** in `place()`: call `anchorAtMatch` with `Number.POSITIVE_INFINITY` so the matched range is not capped (the stored quote is kept as now); carry `offset` clamped with `clampOffset` against the new word; for `line`/`pointer` set `x` from `caretX` of the new word instead of the old line-relative x; raise the status to at least `approximate` when the match is shorter than the old range. `positional()` and the catch path already rebuild `text` without `offset`.
- [ ] **Step 4: Run** the file and `pnpm exec vitest run packages/core`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): re-anchor carries a character offset and keeps long highlights`.

### Task 7: Core print stamping

**Files:**
- Modify: `packages/core/src/print/stampItems.ts`, `packages/core/src/print/stampScript.ts`
- Test: `packages/core/src/print/stampItems.test.ts`, `packages/core/src/print/stampScript.test.ts`

**Interfaces:**
- Consumes: `markInputs` (Task 4), the layout fields (Task 5).
- Produces: the `cue` `StampItem` gains `mark: CueMark` and `caret: Caret | null` (its `triggerBoxes` now come from `markInputs`). `DisplayedPage.rect` and `roundedRect` accept an optional `blendMode?: BlendMode` (pdf-lib 1.17.1 supports it on `drawRectangle` and `drawSvgPath`).

- [ ] **Step 1: Write the failing tests:**
  - `buildStampItems: a line cue carries mark and caret; a highlight carries mark and its range's boxes; a cue with no word layer carries empty boxes and no caret`.
  - `stampScript: a highlight draws a translucent fill in the department colour with a Multiply blend (the page's ExtGState has /BM /Multiply and the fill alpha is 0.28), and no underline stroke`.
  - `stampScript: a line draws a bar 1.5 pt wide at the caret x; a pointer also draws a filled triangle`.
  - `stampScript: the draw order is fills, underlines and bars, connectors, annotations, then tags`.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/core/src/print`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** `buildStampItems` calls `markInputs(words, c.anchor)`. In `stampScript.ts` pass `mark` and `caret` into the `CueTagInput`, and extend `drawTrigger` to draw `fills`, then `bar` (a `d.line` of `BAR_WIDTH`, plus `d.polygon` for the pointer). Fall back to plain opacity if a backend rejects the blend mode.
- [ ] **Step 4: Run** `pnpm exec vitest run packages/core` and `pnpm --filter @binder/core typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): print highlights and lines`.

### Task 8: API, MCP and skill docs for marks

**Files:**
- Modify: `apps/api/src/services/placement.ts`, `apps/api/src/mcp/tools/cues.ts`, `skills/binder/references/tools.md`, `skills/binder/references/placing-cues.md`, `skills/binder/references/data-model.md`, `skills/binder/references/exports-and-print.md`
- Test: `apps/api/test/mcpCues.test.ts`, `apps/api/test/syncMarkup.test.ts`, `apps/api/test/printExport.test.ts`, `apps/api/test/skillDocs.test.ts` (run unchanged), `apps/api/test/revert.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4.
- Produces: `PlaceCueAtTextInput` gains `mark?: CueMark` and `charOffset?: number`; the `placement` zod object gains `mark?: CueMark`; `update_cue` gains top-level `mark?: CueMark` and `charOffset?: number` applied to the cue's current anchor (via `withMark`, loading the anchor's page layer with `loadVersionText` so `x` follows the caret; error on an unplaced cue, and error for `charOffset` when no word is bound).

- [ ] **Step 1: Write the failing tests:**
  - `mcpCues`: `place_cue_at_text with mark highlight anchors the whole matched quote, not eight words`; `with mark line and charOffset 3 stores text.offset 3 and x at the caret`; `charOffset with underline is an error`; `update_cue mark highlight changes only the mark`; `update_cue charOffset on an unbound cue is an error`; `create_cue with a coordinates anchor and mark line makes a free bar (no text, no offset)`.
  - `syncMarkup`: `a cue upload carrying mark, tag and text.offset is accepted and the stored anchor keeps all three`; `an annotation upload carrying mark is refused`.
  - `printExport`: `exportMarkedScript of a highlight cue draws the department colour fill; of a line cue, the bar`.
  - `revert`: `reverting a restyle puts the old mark back` (Review Focus 3).
- [ ] **Step 2: Run** `pnpm exec vitest run apps/api/test/mcpCues.test.ts apps/api/test/syncMarkup.test.ts apps/api/test/printExport.test.ts apps/api/test/revert.test.ts`. Expected: new tests FAIL (printExport skips without poppler; run in CI).
- [ ] **Step 3: Implement** `placeCueAtText` (highlight uses `anchorAtMatch(..., Number.POSITIVE_INFINITY)`; a line takes `charOffset` on the quote's first word, rejecting an offset past that word's length) and the tool schemas with `.describe()` text. No new tool name is added, so `mcpParity` is unaffected.
- [ ] **Step 4: Document** the new arguments and the anchor fields in the four skill references (tool tables, "How a cue looks on the page", anchor fields, print description). Run `pnpm exec vitest run apps/api/test/skillDocs.test.ts apps/api/test/skillLinks.test.ts apps/api/test/mcpParity.test.ts` and the tests from Step 2. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): marks through MCP, placement and the skill docs`.

### Task 9: Web drawing

**Files:**
- Modify: `apps/web/src/markup/cueLayout.ts`, `apps/web/src/markup/CueMarker.tsx`, `apps/web/src/markup/markup.css` (or wherever `.cue-highlight` is styled)
- Test: `apps/web/src/markup/CueMarker.test.tsx`

**Interfaces:**
- Consumes: `markInputs` (Task 4), the layout fields (Task 5). `MarkerCue.anchor` gains `mark?: CueMark` and `text?: TextAnchor`.

- [ ] **Step 1: Write the failing tests** (render `CueTrigger` with a `CueTagLayout`):
  - `a highlight draws rect.cue-fill boxes in the department colour at 0.28, 0.4 when filled, with no line.cue-underline`.
  - `a line draws line.cue-bar at the bar x; a pointer also draws polygon.cue-pointer`.
  - `an underline, tick and leader render exactly as before` (the existing tests, unchanged).
  - `a coarse-pointer bar has a transparent 44 px hit rect that selects the cue`.
  - `a cue with no word layer renders a tick (underline, highlight) or a free bar (line)` (Review Focus 5).
- [ ] **Step 2: Run** `cd apps/web && pnpm exec vitest run src/markup/CueMarker.test.tsx`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** `layoutPageCues` calls `markInputs(words, c.anchor)` and passes `mark`, `triggerBoxes`, `caret`. `CueTrigger` draws `tag.fills` with `mix-blend-mode: multiply`, the bar and pointer, and keeps the existing `.cue-highlight` rects as the hit and hover fill for underline and line (for a highlight the fill rects are the hit targets).
- [ ] **Step 4: Run** the file and `cd apps/web && pnpm exec vitest run src/markup`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): draw highlight and line marks`.

### Task 10: Web placing

**Files:**
- Modify: `apps/web/src/markup/tools.ts`, `apps/web/src/markup/ToolStrip.tsx`, `apps/web/src/markup/placement.ts`, `apps/web/src/markup/MarkupSession.tsx` (the `MarkupSession` interface and `placeCue`), `apps/web/src/markup/MarkupOverlay.tsx`, `apps/web/src/markup/useAnnotationGestures.ts`, `apps/web/src/markup/wordRange.ts`, `apps/web/src/markup/useMarkupShortcuts.ts`
- Test: `apps/web/src/markup/placement.test.ts`, `apps/web/src/markup/MarkupSession.test.tsx`, `apps/web/src/markup/wordRange.test.ts`

**Interfaces:**
- Consumes: `snapToCaret` (Task 2), `snapToWord`, `rangeText` (Task 3).
- Produces: `ToolState.cueMark: CueMark` (default `'underline'`); `setCueMark(mark: CueMark): void`; `markAnchorAt(input: PlacementInput & { mark: CueMark }): Anchor`; `MarkupSession.placeCue(pageIndex, point, type, words?, mark?)` and `MarkupSession.placeCueRange(pageIndex: number, text: TextAnchor, type: CueType, mark: 'underline' | 'highlight'): Promise<void>`; `wordRangeFromDrag(layer, from, to, options?: { wholeQuote?: boolean })`.

- [ ] **Step 1: Write the failing tests:**
  - `placement`: `underline is anchorAt as before with no mark key`; `highlight with snap takes the one word under the pointer, mark highlight, x the word's left`; `line with snap stores mark line, text.offset and x at the caret`; `pointer likewise`; `line with snap off or no line near is a free bar: no text, x and y at the pointer, mark line`; `highlight with snap off is the old unbound tick anchor`.
  - `wordRange`: `wholeQuote gives the whole range's text, still cut at 400 characters`.
  - `MarkupSession`: `placeCue passes the chosen mark through to the inserted row`; `placeCueRange inserts a cue whose text is the dragged range`; `the c shortcut places with the current mark`.
  - `a drag with the cue tool in underline or highlight places exactly one cue (the click that follows the drag places none)`.
- [ ] **Step 2: Run** `cd apps/web && pnpm exec vitest run src/markup/placement.test.ts src/markup/wordRange.test.ts src/markup/MarkupSession.test.tsx`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** The cue flyout in `ToolStrip.tsx` gets a second `select` with the accessible name `Cue mark` (Underline, Highlight, Line, Line with pointer) beside `Cue type`. The overlay shows a ghost bar in the target department's colour at `snapToCaret` while the cue tool is in line or pointer mode (update it on `onPointerMove`). `useAnnotationGestures.onSurfaceDown` gains a cue-tool branch for underline and highlight that drags a range (preview boxes from `wordBoxes`) and calls `placeCueRange` on release, using the same trailing-click suppression the annotation drags use (`dragGesture.ts`). Update every `session.placeCue` call site.
- [ ] **Step 4: Run** the three files plus `cd apps/web && pnpm exec vitest run src/markup` and `pnpm --filter @binder/web typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): choose a mark when placing a cue`.

### Task 11: Web editor Mark control and the "restyled" verb

**Files:**
- Modify: `apps/web/src/markup/CueEditor.tsx`, `packages/core/src/history/summarise.ts`
- Test: `apps/web/src/markup/CueEditor.test.tsx`, `packages/core/src/history/summarise.test.ts`

**Interfaces:**
- Consumes: `withMark` (Task 4), `loadWordLayer` (`apps/web/src/markup/wordLayers.ts`), `markOf` (Task 1).
- Produces: the history verb `restyled`, placed after `moved` in `VERB_ORDER`; a cue update whose `before.anchor` and `after.anchor` are equal once `mark` and `text.offset` are removed counts `restyled`, any other anchor change still counts `moved`.

- [ ] **Step 1: Write the failing tests:**
  - `summarise`: `a mark-only anchor change reads "restyled 1 LX cue"`; `a mark change that also moves the anchor reads moved`; `an offset-only change reads restyled`.
  - `CueEditor`: `the Mark control shows the cue's mark and has four options named Underline, Highlight, Line and Line with pointer`; `choosing Line saves an anchor with mark line and offset 0 (x at the caret once the layer loads)`; `choosing Underline from Line removes the offset and the mark key`; `the control is disabled for an unplaced cue and for a cue the user cannot edit`.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/core/src/history/summarise.test.ts` and `cd apps/web && pnpm exec vitest run src/markup/CueEditor.test.tsx`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** The Mark `Segmented` (`aria-label="Mark"`) sits under Type; it saves `{ anchor: withMark(cue.anchor, mark, { layer }) }` with the page's layer from `loadWordLayer(session.pages[pageIndex]?.words_key)`.
- [ ] **Step 4: Run** both commands. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): change a cue's mark in the editor`.

### Task 12: Phase 1 close

**Files:**
- Create: `apps/web/e2e/markStyles.spec.ts`
- Modify: `DESIGN.md` (decisions log), `CHANGELOG.md` (Unreleased, Added), `docs/README.md` (index), `docs/superpowers/specs/2026-10-15-cue-margin-markers.md` (one "Amended by" line under Status)

- [ ] **Step 1: Write the e2e** (`markupHelpers.ts` has `placeWithTool`, `lineOf`, `clickAt`): `place a highlight, a line and a pointer from the cue flyout; each is drawn (rect.cue-fill at 0.28, line.cue-bar, polygon.cue-pointer) and survives a reload`; `change a cue's mark in the editor and see it redrawn`; `the print preview shows the highlight`; `a mid-word line lands inside the word (its x is strictly between the word's edges)`; `Calling mode and the revision review, opened on a show holding a highlight and a line cue, render without console errors and without a cue vanishing` (the spec's compatibility check; fix whichever of `apps/web/src/calling` or `apps/web/src/revisions/thumbShapes.ts` misreads the new anchor fields).
- [ ] **Step 2: Write the docs:** a `DESIGN.md` decisions-log row (highlight prints a translucent fill, overriding "print never fills" for highlight only; per-cue marks; character-level lines), the `CHANGELOG.md` entry (including the note that a cached older web client drops the new fields when it moves a cue), the `docs/README.md` rows for this spec and plan.
- [ ] **Step 3: Run the checks:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, then `docker compose -f deploy/docker-compose.dev.yml up -d` and `pnpm e2e markStyles markup responsive`. Expected: all green (rerun a cold-start failure once).
- [ ] **Step 4: Screenshots:** with the dev stack up, place one of each mark on a fixture show, capture phone (390), tablet (820) and desktop (1280) with the browser pane, and send them with `SendUserFile` (no tokens on screen).
- [ ] **Step 5: Commit** `docs: record the cue mark styles` and stop for Jayden's review before Phase 2.

---

## Phase 2: Movable bubble

### Task 13: Core moved-bubble layout, stamping and verb

**Files:**
- Modify: `packages/core/src/markup/cueTags.ts`, `packages/core/src/anchors/snap.ts`, `packages/core/src/print/stampItems.ts`, `packages/core/src/print/stampScript.ts`, `packages/core/src/history/summarise.ts`, `packages/core/src/index.ts`
- Test: `cueTags.test.ts`, `snap.test.ts`, `stampItems.test.ts`, `stampScript.test.ts`, `summarise.test.ts`

**Interfaces:**
- Produces: `CueTagInput.tag?: BubbleOffset | null`; `CueTagLayout.moved: boolean`; `snapRange(layer: WordLayer, point: { x: number; y: number }, wordCount: number, maxDistance?: number): { x: number; y: number; text: TextAnchor } | null` (nearest line, the word nearest `point.x` as the start, then `wordCount` words by layer index, clamped to the last word); the `cue` `StampItem` gains `tag: BubbleOffset | null`; history verb `bubble moved`, after `restyled` (an anchor change equal once `tag` is removed).

- [ ] **Step 1: Write the failing tests:**
  - `cueTags`: `a moved bubble is centred at (anchorX + dx, y + dy)`; `it is clamped inside the page width and the vertical bounds (so never in the footer)` (Review Focus 4); `it takes no part in stacking: two margin tags that would have stepped around it do not, and it does not step around them`; `it shows the full lead, never the shrunk one`; `it draws no note`; `its leader is one straight segment from the tag centre to the mark, absent when the tag overlaps the mark`; `parallel-leader staggering ignores it`; `moved is false for a margin tag`.
  - `snapRange`: `keeps the requested word count from the nearest word; clamps at the last word; null when no line is in range`.
  - `stampItems` and `stampScript`: `a cue with a tag is stamped at the offset, without its note`.
  - `summarise`: `a tag-only anchor change reads "bubble moved 1 LX cue"`.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/core`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** in `layoutCueTags`: split moved cues out before `stackSide` and `leaderOffsets`, lay each out with its own centre and a `[centre, target]` leader.
- [ ] **Step 4: Run** `pnpm exec vitest run packages/core` and the core typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): a cue's bubble can sit off the margin`.

### Task 14: Web bubble drag, nudge and mark drag

**Files:**
- Modify: `apps/web/src/markup/MarkupOverlay.tsx`, `apps/web/src/markup/CueMarker.tsx`, `apps/web/src/markup/MarkupSession.tsx`, `apps/web/src/markup/cueLayout.ts`
- Test: `CueMarker.test.tsx`, `MarkupSession.test.tsx`; modify `apps/web/e2e/markup.spec.ts` and `apps/web/e2e/markupHelpers.ts`

**Interfaces:**
- Consumes: Task 13.
- Produces: `MarkupSession.setBubble(cueId: string, tag: BubbleOffset | null): Promise<void>` (writes the anchor with `tag` set or removed, through `mayChange`); `moveCue` keeps the cue's `mark` and `tag` and snaps by mark (underline: `anchorAt` as today; highlight: `snapRange` keeping the word count; line and pointer: `snapToCaret`); `CueTrigger` takes `onPointerDown`; `CueMarker` takes `onNudge?: (dx: number, dy: number) => void`; a markup helper `triggerOf(page, cueId)` in `markupHelpers.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `CueMarker`: `arrow keys on a movable marker call onNudge by 1 pt, Shift by 10 pt, and do not scroll the page`; `a marker that is not movable ignores them`.
  - `MarkupSession`: `setBubble writes tag and leaves everything else; null removes it`; `moveCue keeps mark and tag`; `moveCue of a line re-snaps to a character boundary`; `moveCue of a highlight keeps its word count`; `setBubble refuses a cue on a locked layer and says why`.
  - Overlay behaviour (extend the existing overlay or session test): `dragging a selected cue's bubble writes a tag from the drop point and does not change the anchor's x, y or text`; `a drop outside the page writes nothing` (Review Focus 4); `an unselected bubble does not drag`.
- [ ] **Step 2: Run** `cd apps/web && pnpm exec vitest run src/markup`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** `onMarkerDown` begins a bubble drag with an in-overlay preview pill (no portal ghost) and `setBubble` on drop. A selected, editable cue's trigger (fills, underlines, bar; 44 px hit area on coarse pointers) starts the old cross-page drag with the existing `DragGhost` and `moveCue(..., { dropped: true })`. Un-bind the old tag-drag path.
- [ ] **Step 4: Update e2e.** `dragging the cue to page 2 moves it for both users`, `B (SND only) cannot drag A's LX cue ...` and `a drag ends cleanly when a collaborator deletes the cue mid-drag` drag `triggerOf(page, id)` instead of the marker. Add `dragging the bubble moves only the bubble`. Run `pnpm e2e markup`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): drag the bubble on its own; drag the mark to move the cue`.

### Task 15: Editor Bubble row, MCP bubble and Phase 2 close

**Files:**
- Modify: `apps/web/src/markup/CueEditor.tsx`, `apps/api/src/mcp/tools/cues.ts`, `skills/binder/references/tools.md`, `skills/binder/references/placing-cues.md`, `skills/binder/references/data-model.md`, `CHANGELOG.md`, `DESIGN.md`
- Test: `CueEditor.test.tsx`, `apps/api/test/mcpCues.test.ts`, `apps/api/test/revert.test.ts`; Create: `apps/web/e2e/bubble.spec.ts`

**Interfaces:**
- Consumes: `setBubble` (Task 14). Produces: `update_cue` and the coordinates `placement` accept `bubble?: { dx: number; dy: number } | null` (null resets).

- [ ] **Step 1: Write the failing tests:**
  - `CueEditor`: `the Bubble row says "In the margin" or "Moved"; Reset to margin appears only when moved and clears tag; it is disabled when the cue is read-only`.
  - `mcpCues`: `update_cue bubble {dx,dy} stores tag; bubble null removes it; bubble on an unplaced cue is an error; |dx| beyond 14400 is refused`.
  - `revert`: `reverting a bubble move restores the old tag` (Review Focus 3).
  - e2e `bubble.spec.ts`: `move a bubble onto the text, reload, it stays; Reset to margin returns it; the move shows in History as "bubble moved"; the bubble prints where it was put`.
- [ ] **Step 2: Run** the three unit files. Expected: new tests FAIL.
- [ ] **Step 3: Implement** the row, the tool arguments with `.describe()` text, and the docs for `bubble` in the three skill references.
- [ ] **Step 4: Run** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e bubble markup responsive`, and the skill-doc tests. Expected: all green. Send phone, tablet and desktop screenshots of a moved bubble to Jayden.
- [ ] **Step 5: Commit** `feat: move a cue's bubble, in the editor and over MCP` and stop for review before Phase 3.

---

## Phase 3: Connector styles

### Task 16: Shared setting and core strokes

**Files:**
- Modify: `packages/shared/src/markup.ts`, `packages/core/src/markup/cueTags.ts`, `packages/core/src/print/stampItems.ts`, `packages/core/src/print/stampScript.ts`, `packages/core/src/index.ts`
- Test: `packages/shared/src/markupSchemas.test.ts`, `cueTags.test.ts`, `stampItems.test.ts`, `stampScript.test.ts`

**Interfaces:**
- Produces (`@binder/shared`): `type ConnectorWidth = 'thin' | 'medium' | 'bold'`; `type ConnectorPattern = 'solid' | 'dashed' | 'dotted'`; `interface ConnectorStyle { width: ConnectorWidth; pattern: ConnectorPattern }`; `DEFAULT_CONNECTOR_STYLE` (thin, solid); `connectorStyle(settings: Record<string, unknown>, departmentId: string): ConnectorStyle` (anything missing or malformed gives the default). (`@binder/core`): `CueTagInput.connector?: ConnectorStyle`; `CueTagLayout.stroke: { width: number; dash: number[] | null; round: boolean }`; the `cue` `StampItem` gains `connector: ConnectorStyle`; `DisplayedPage.line` takes optional `dash` and `round`.

- [ ] **Step 1: Write the failing tests:**
  - `shared`: `connectorStyle reads a valid entry; a missing department, a non-object settings, a bad width or pattern and a prototype key like "__proto__" all give thin and solid`.
  - `cueTags`: `each width maps to 0.75, 1.5 and 2.5 pt`; `dashed gives [4w, 2.5w], dotted gives round caps with [0, 2.5w], solid gives null`; `parallel leaders on one line step by max(1.5, w + 0.75)`; `no connector input behaves exactly as before`.
  - `stampItems` and `stampScript`: `the cue item carries its department's connector style; the printed connector uses that width, dash and cap; the bubble outline is unchanged`.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/shared packages/core`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** `buildStampItems` reads `connectorStyle(input.settings, dept.id)`. `stampScript` draws each connector segment with `dashArray` and `LineCapStyle.Round` as needed.
- [ ] **Step 4: Run** the same command and both typechecks. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): connector width and pattern per department`.

### Task 17: Web settings, overlay, docs and Phase 3 close

**Files:**
- Create: `apps/web/src/markup/connectorStyleSettings.ts`, `apps/web/src/markup/connectorStyleSettings.test.ts`
- Modify: `apps/web/src/markup/MarkerSideEditor.tsx` (add `useConnectorStyles`, `ConnectorStyleControls`), `apps/web/src/settings/DepartmentsSection.tsx`, `apps/web/src/markup/MarkupSession.tsx`, `apps/web/src/markup/cueLayout.ts`, `apps/web/src/markup/CueMarker.tsx`, `skills/binder/references/tools.md`, `skills/binder/references/data-model.md`, `skills/binder/references/workflows.md`, `CHANGELOG.md`, `DESIGN.md`
- Test: `connectorStyleSettings.test.ts`, `MarkerSideEditor.test.tsx`, `CueMarker.test.tsx`, `apps/web/e2e/settings.spec.ts`

**Interfaces:**
- Produces: `readConnectorStyle(settings: string | null | undefined, departmentId: string): ConnectorStyle`; `withConnectorStyle(settings: string | null | undefined, departmentId: string, style: ConnectorStyle): string` (keeps every other key, including `markerSides`); `MarkupSession.connectorStyle(departmentId: string | null): ConnectorStyle`.

- [ ] **Step 1: Write the failing tests:**
  - `connectorStyleSettings`: `withConnectorStyle keeps stampSet, paperSize, markerSides and other departments' styles; reading it back gives the style`.
  - `MarkerSideEditor`: `the owner sees Connector width and Connector pattern controls named "<CODE> connector width" and "<CODE> connector pattern", and choosing one writes settings.connectorStyles; a non-owner sees them read-only`.
  - `CueMarker`: `the leader polyline uses the stroke width, dash and round caps from the layout`.
  - e2e `settings.spec.ts`: `set SND connector to bold dashed; the page's connector is 2.5 pt with a dash; the print preview matches; other departments are unchanged`.
- [ ] **Step 2: Run** `cd apps/web && pnpm exec vitest run src/markup src/settings`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** The two `Segmented` controls sit beside Marker side in each department card (labels "Connector width", "Connector pattern"), written like `setSide` (read the latest settings just before writing). `layoutPageCues` passes `connector` per cue; `CueTrigger` applies `strokeWidth`, `strokeDasharray`, `strokeLinecap`.
- [ ] **Step 4: Document** `connectorStyles` as a key `update_show` settings carries (tools table, data model, the workflows merge example). Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e settings markup responsive` and the skill-doc tests. Expected: all green. Send screenshots (a bold dashed connector on phone, tablet, desktop) to Jayden.
- [ ] **Step 5: Commit** `feat: connector width and pattern per department` and report the three phases done.
