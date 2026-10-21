# Cue marker styles, Phase 2 (movable bubble): rulings, deferred items and status

Spec: `docs/superpowers/specs/2026-10-20-cue-marker-styles.md`. Plan: `docs/superpowers/plans/2026-10-20-cue-marker-styles.md` (Tasks 13 to 15). Phase 1 record: `2026-10-20-cue-marker-styles-phase1.md`.
Branch `claude/cue-markers-placement-419c91`, 15 commits from the end of Phase 1 (607b043) to abab2ca, not pushed.

## Status

Phase 2 is built and reviewed: each task had its own spec-and-quality review (Tasks 13 and 14 each needed one fix round), then one whole-phase review (Opus) and one fix wave with a scoped re-review. At the last full run: `pnpm lint` and `pnpm typecheck` clean, `pnpm test` 2607 of 2608 (the one failure is the timing-bound `apps/api/test/revisions.test.ts`, which passes alone and is known to flake under load), `pnpm e2e bubble markup markStyles bubbleSpread responsive` 61 passed (1 skipped by its own spec).

What exists now: a cue's anchor can carry `tag: { dx, dy }`; core lays a moved bubble out (no part in the margin spread, full lead, no note, one straight leader that aims at the nearest end of its mark, none when the bubble sits on its own mark); print stamps it where it was put; the web drags the bubble on its own (preview pill), nudges it with Alt+arrow keys (one write per burst), and moves the cue by dragging its MARK; the cue editor has a Bubble row ("In the margin" or "Moved") with Reset to margin; `update_cue` and the coordinates `placement` accept `bubble`; history reads "bubble moved" in the activity feed and "Bubble moved" / "Bubble back in the margin" in the per-cue panel; revert restores the old tag.

Phase 3 (connector styles, Tasks 16 and 17) is NOT started.

## Rulings made while executing (each with what it costs if wrong)

12. `anchorChangeKind(before, after)` returns `'restyled' | 'moved' | 'bubble-moved'`: equal once `tag` is removed (and tags differ) is `bubble-moved`; a change that alters the tag and anything else is `moved`. The activity feed (`summarise.ts`) and the per-cue history text (`formatChange.ts`) both use it. The plan only named `summarise.ts`. Cost: the per-cue history would say "Moved on p.N" for a bubble move.
13. An offset-only change with the SAME mark now reads `moved`, not `restyled` (the caret is draggable); `restyled` needs the two marks to differ. This changed four pre-existing test expectations by design (two in `anchorChange`/`summarise`, two in `formatChange`). Cost: a caret drag reads "restyled".
14. The e2e added in Phase 1's fix wave (restyle a cue to highlight, drag its margin tag, check it still draws a fill) was retargeted to drag the cue's TRIGGER, since the tag drag now moves only the bubble.
15. Keyboard nudges coalesce into ONE write per burst (a per-cue target every press builds on, drawn live, written ~300 ms after the last press and flushed on blur, deselect, unmount and `pagehide`). A held arrow key must not lose steps or flood the change log. Cost: a nudge reaches history and sync ~300 ms late.
16. Nudging needs Alt: Alt+Arrow moves 1 pt, Alt+Shift+Arrow 10 pt; plain arrows and Shift+arrows on a focused cue marker are not intercepted and still turn the page. The whole-phase review found that after `]`, a cue-list pick or a click, focus lands on the cue marker, so plain arrows would nudge a bubble instead of turning the page, and one stray press pins a bubble off the margin. The review said it was Jayden's call; the nudge was an accessibility addition of the plan's, and Alt is the smallest change that regresses nothing. **Jayden may prefer a pick-up mode (Enter or M) or no keyboard nudge; tell the next session if so.** Cost: a keyboard user needs Alt.
17. No change for the screen-versus-print footer floor of a moved bubble: the margin-markers spec already says the floor is the footer top in print and 0 on screen for margin tags, and the Phase 2 spec says a moved bubble uses "the same vertical bounds as auto tags". Cost: a bubble dragged into the bottom 19 pt prints slightly higher than it looks.
18. MCP `update_cue` with an `anchor` and no `bubble` keeps replacing the whole anchor (including `mark` and `tag`), as the docs say; the web keeps both on a re-placement. An agent that wants the bubble to stay sends `bubble` too. Cost: an agent re-placing a cue loses a user-placed bubble.

Smaller decisions: a bubble-only `update_cue` changes ONLY `tag` (it skips the word-layer load and `withMark`); the 8 px touch drag threshold applies to a bubble drag on a touch pointer only; the mark drag needs the Select tool while the bubble drag has no tool check (recorded in DESIGN.md).

## Deferred minors (reviewers raised them; none blocks merge)

- Task 13: the no-note rule lives in three places (layout, print items, print stamping; only the layout one is load-bearing); no tests for the clamp edge cases (a pill wider than the page, `minY > maxY`); `barBoxes` uses the full pointer width for the whole pointer bar; contact with a mark's edge counts as overlap.
- Task 14: a burst that returns to the stored value still issues a no-op write (`planPatch` writes nothing); the first-word rule from `anchorAt` is not applied to `snapRange` (a highlight dragged from outside the line's extent starts at the nearest word); on touch a selected cue's 44 px pad can capture a tap meant for a neighbouring line.
- Task 15: the 44 px Reset target is asserted by class only (no coarse-pointer e2e); `tools.md` quotes a service error text an MCP caller never sees (the zod schema refuses first); `place_cue_at_text` takes no `bubble` (place the cue, then move its bubble).
- Visual (screenshots): on tablet a bubble dragged under the docked editor panel is hidden while the editor is open (inherent); a long leader crosses text lines (expected for a bubble far from its mark).
- Product notes: there is no in-app hint that a cue now moves by its mark (it is in the CHANGELOG, DESIGN.md and the skill); an iPad finger cannot drag a multi-word range (Phase 1, Ruling 11).
