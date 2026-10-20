# Cue marker styles, Phase 1: rulings, deferred items and status

Spec: `docs/superpowers/specs/2026-10-20-cue-marker-styles.md`. Plan: `docs/superpowers/plans/2026-10-20-cue-marker-styles.md`.
Branch `claude/cue-markers-placement-419c91`, 20 commits from the plan commit (82054f5) to 1c45ce8, not pushed.

## Status

Phase 1 (Tasks 1 to 12: mark styles) is built and reviewed: each task had its own spec-and-quality review, there was one final whole-branch review, and one fix wave with a scoped re-review. At the last run: `pnpm lint` and `pnpm typecheck` clean, `pnpm test` 236 files / 2505 tests passed, `pnpm e2e markStyles markup responsive` 57 passed (1 skipped by its own spec), `pnpm e2e annotations palette` 19 passed. Screenshots (phone, tablet, desktop, print) were taken on the final code.

Phase 2 (movable bubble, Tasks 13 to 15) and Phase 3 (connector styles, Tasks 16 and 17) are NOT started.

## Added after Phase 1: Task 12b, crowded margin bubbles spread around their lines

Jayden asked that crowded bubbles move "both up and down a bit around their own lines (not only down)". Built as plan Task 12b (commits ee6b2d8 core, 84d833d e2e, 60c9183 docs, c7d4d1e follow-up): `stackSide` in `packages/core/src/markup/cueTags.ts` now groups overlapping tags and centres each group on where its members want to be (zero total displacement), merging groups that then overlap and holding the result inside the footer floor and page top. Seven old cueTags tests changed by design (listed in the task report); the new e2e `bubbleSpread.spec.ts` was checked against the OLD stacking code and fails there at the "middle bubble level with the line" assertion. Trade-off seen in the screenshot: with four cues on one line the outer bubbles sit about one script line away from it. A stale test title in `CueMarker.test.tsx` ("a tag pushed off its line...") is left as is; it is still true.

## Rulings made while executing (each with what it costs if wrong)

1. Task 9: a highlight's fill rects carry both classes `cue-fill cue-highlight` (one element), so the existing hover, select and click handling applies; fill-opacity 0.28, 0.4 when filled. The plan's wording was ambiguous. Cost: a selector rename.
2. Tasks ran one implementer at a time, and Phases 2 and 3 were not dispatched (the plan says stop for review after Task 12).
3. Before any e2e run, ports :3000, :5173 and :4173 were checked and a sibling session's server would have been reported, not killed. Cost: e2e waits for a person.
4. `cutQuote` lives in `packages/core/src/anchors/snap.ts`, not `quote.ts` (quote.ts imports snap.ts; the reverse would be circular). Still exported from the package index.
5. Task 5: a highlight's leader ends at the padded outer edge of its first fill; a line's at `bar.x` at `caret.box.y - UNDERLINE_DROP`; a free bar's at `(anchorX, bar.y1)`. Cost: a 1 pt shift in where a leader ends.
6. Task 6: "the old range was longer than its cut quote" is decided from the old version's word stream, not `wordEnd - wordStart` arithmetic (layer word indices are not guaranteed to be in reading order).
7. The pointer triangle points down at the bar (apex at `(bar.x, bar.y2)`, base at `y2 + 5`, half-width 3), matching the approved mockup.
8. With Snap off, a cue-tool range drag selects no range and falls through to the click path (an unbound tick): the spec's literal reading. Cost: a Snap-off user cannot drag-select a range for a cue.
9. The `restyled` history verb ignores `x` when either side's mark is a line or pointer (a line's stored `x` follows its character offset). Cost: a line restyle would read "moved".
10. The "cut range comes back approximate" flag covers underline as well as highlight (the two range marks); one older reanchor test's expectation for a cut underline changed from `ok` to `approximate` as a result. Cost: a rare false "approximate".
11. A finger cannot drag a range on a touch screen (the page scrolls); this is documented in CHANGELOG Known issues with the workaround (an Apple Pencil, or place an underline and switch its Mark to Highlight in the cue editor), not built. Cost: iPad users use the workaround until it is built.
12. Controller edit (docs only): the DESIGN.md decisions row now quotes Jayden verbatim for the vertical line; the implementer had paraphrased inside quotation marks.

## Deferred minors (reviewers raised them; none blocks merge)

- Task 1: an annotation offset clause is unreachable on its own; `CUE_MARKS` cast could go; new tests are top-level `test()`.
- Task 2: `snapToCaret` assigns `pick` inside a `forEach` (needs a cast); a combining-mark test literal may be precomposed; the cap test checks `wordEnd` not the quote word count.
- Task 3: `anchorAtMatch` with `maxWords <= 0` would throw (no caller); `rangeText` with out-of-layer indices yields an empty quote.
- Task 4: `withMark` with a `NaN` offset and no layer stores `NaN` (only reachable from code; the schema allows integers only).
- Task 5: no tests for a pointer on a right tag or a caret with empty trigger boxes.
- Task 6: a cut highlight or underline whose range crosses a page is not downgraded (stored `wordEnd` is per start page; in CHANGELOG Known issues); two linear scans per range mark in `reanchorAll`.
- Task 7: the pointer test does not tie the apex to `bar.y2`; the PDF check does not tie 28% multiply to the highlight specifically.
- Task 8: the missing-word-layer branch of `update_cue` has no test and a bare `catch`; one description line is over 100 columns; the revert test goes through the service, not MCP.
- Task 9: `matchMedia` is read on every render of every `CueTrigger`; the highlight and word rects are near duplicates.
- Task 10: the line ghost re-renders the overlay on every pointer move in line mode; `placeCueRange` returns silently if `highlightPoint` is null (unreachable); no tests for the touch and relocating skips.
- Task 11: `saveMark` snapshots the anchor before awaiting the word layer (a remote edit or two quick picks can save from a stale anchor); an offset-only change reads "restyled" (the plan's test requires it; revisit when the caret becomes draggable in Phase 2); no visible reason on the disabled Mark control for an unplaced cue.
- Task 12: a few weak e2e assertions (a vacuous `offset >= 0`, `bar.height > 0`); the console-error collector may flake on benign resource errors while a second version processes.
- Visual: on desktop the cue editor's Mark control wraps "Line with pointer" to three lines in the narrow panel, so its selected fill is about twice as tall as its neighbours; a shorter label ("Pointer") would remove it. The pointer triangle (6 by 5 pt) is small at phone and tablet zoom.

## Out of scope on purpose (Phase 1 only)

Moving a highlight or underline with the margin tag re-creates an up-to-eight-word range until Phase 2's `snapRange`; an annotation highlight whose quote was cut at 400 characters now comes back `approximate` on re-anchor (follows from ruling 10).
