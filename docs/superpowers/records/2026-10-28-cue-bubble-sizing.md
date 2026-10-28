# Cue bubble sizing (2026-10-28)

What exists now: `settings.cueSizes[departmentId] = 'normal' | 'large'` in the show's settings, read
with `cueSize(settings, departmentId)` in `@binder/shared` (anything missing or malformed is `normal`).
`CUE_SIZE_SCALE` is `{ normal: 1, large: 1.3 }`.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Two sizes, Normal and Large, per department, beside the marker side and connector style | Follows the existing per-department settings model (`markerSides`, `connectorStyles`); a fixed step keeps screen and print identical and the value checkable. |
| 2 | Large is 1.3 times Normal: pill height, radius, padding, the code/number gap and both type sizes | Inside the asked-for +25 to 40 %; 11.7 pt numbers read at arm's length on a music stand without crowding a typical 50 to 70 pt margin. |
| 3 | Marks (underline, highlight, line, pointer), connectors and notes do not scale | They belong to the script text, whose metrics are fixed; only the bubble is the reader's cue. |
| 4 | Normal is exactly today's geometry | An absent size and `normal` produce deep-equal layouts (`packages/core/src/markup/cueSize.test.ts`); every existing layout test is unchanged. |
| 5 | The server validates `cueSizes` (unlike the older keys) in `updateShow` | The web sync path and MCP `update_show` both go through it, so neither can store an unknown size or a department from another show. Entries already stored with the same value are accepted, so a stale entry never blocks an unrelated write. |
| 6 | Owner sets, everyone else reads | Same as every show setting (`updateShow` requires owner); editors and viewers see the word. |

## Geometry

`layoutCueTags` carries a per-cue height into the stack (neighbours sit half of each apart plus the
2 pt gap and the upper one's note), the page bounds (each tag's own half height), the moved-bubble
clamp, the straight-leader tolerance and the leader's start under the pill's curve (`tag.h / 2`). The
margin's shed ladder measures with the scaled `tagWidth`, so a large tag drops its code sooner and
the number always shows. `CueTagLayout` gains `size`, `fontSize` and `radius`; the screen pill and print
stamping draw from them, and the on-screen hit area and drag preview are the laid-out pill.

## Screen and print inputs that differ on purpose (review disposition)

The screen overlay and print stamping call the same `layoutCueTags`, so a tag's size, padding, type,
radius and stacking rule are identical. Two inputs differ, both by the existing margin-markers
contract and both unchanged by this feature (Normal geometry is untouched):

- **The floor.** Print keeps tags above the footer (`bounds.minY` is the footer's top, 19 pt); the
  screen has no footer and uses 0 (`2026-10-15-cue-margin-markers.md`, "The floor (the footer's top
  edge in print, 0 on screen)"). A bubble held against the bottom edge therefore sits 19 pt higher on
  paper at either size (centre 7 vs 26 at Normal, 9.1 vs 28.1 at Large).
- **Notes.** Print draws a cue's note under its tag and counts its 9 pt in the stack; the screen
  draws no note under the tag (it is in the cue editor and the hover title), so crowded tags with
  notes spread further on paper than on screen (Large: 20.2 vs 29.2 pt between two tags on a line).

## Concurrency (review disposition)

Like every show setting, the web writes `settings` as one JSON object (read and written in one local
transaction) and the server replaces it. A size chosen in this browser keeps every setting that has
synced here; a change another device makes while this one is offline can be replaced when this
one's write goes up (last writer wins). This feature does not change that contract; it is a known
limitation of show settings, not of cue sizes.

## Not done

- No migration and no PowerSync change: the value rides in the existing `shows.settings` JSON.
- Cue sheets (tables) are not affected.
