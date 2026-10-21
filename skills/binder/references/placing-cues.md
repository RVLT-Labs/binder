# Placing cues

The main how-to: choosing the department and type, anchoring a cue to its trigger words, numbering, inserting, labels and notes, batching safely, how it prints, and verifying what you wrote.
Derived from `apps/api/src/services/placement.ts`, `cues.ts`, `renumber.ts`, `packages/core/src/cues/*`, `anchors/quote.ts`, `markup/cueTags.ts`, `print/stampItems.ts`.

Read this before writing any cue. For the exact parameters see [tools.md](tools.md); for step-by-step recipes see [workflows.md](workflows.md).

## Before you write

1. `list_shows`: confirm the show, your `role`, and that `inNow` is empty or the user knows people are in the binder. Check `status` is not `archived`.
2. `list_departments`: get the codes, their `numberFormat`, and which are `hidden`.
3. `list_documents`: find the libretto and its `currentVersionId`; confirm it is `ready`.
4. `list_cues {showId, department}`: see what exists, so you insert rather than duplicate.
5. Read the relevant pages (`search_script`, `get_page`) and quote the trigger line back to the user. Never invent a trigger.

Then write with `place_cue_at_text`, one cue per call.

## Department and type

- **Department** is the layer the cue lives on and whose colour, margin side and number format it takes. Use the code the user says (`LX`, `SND`, `TM`, `SM`, `VID`, `STG`, `FLY`, or a custom one from `list_departments`). Codes are matched case-insensitively. An editor can only write departments in their scope: a cue for another department fails with `forbidden: you cannot edit this layer`; tell the user instead of picking a different department.
- **Type**: `go` (default) is the cue itself. `standby` and `warn` are the calls before it; they print with `SB` or `W` in the tag (`SB LX 12`) and can be left out of a print with `includeStandbyWarn: false`. Only create standbys and warns when the user asks for them; a stage manager usually derives them.
- TheatreMix cues go on `TM` (point format, so `10.5` displays `10.50`). Read `binder://guides/jayden-style` before numbering a TM layer.

## Pick the trigger words and anchor to them

`place_cue_at_text {showId, department, quote, …}` anchors the cue at the first word of `quote` and remembers the words as the cue's trigger (`anchor.text`). The trigger is what prints underlined, what the cue sheet shows in `Trigger`, and what a revision re-finds.

Choosing the quote:

- Quote the words **as they appear on the page**, from the page text, in reading order. Exact matching is tried first; then a forgiving match that ignores case, punctuation and a hyphen at a line end (`today` matches `to-day`, `pirate sherry` matches `pirate sherry;`).
- Three to eight words from one line is ideal. The stored trigger keeps at most eight words and the whole quote is checked, so a longer quote still works but prints as its first eight.
- Prefer a distinctive run: include the character name or an unusual word. Lyrics repeat; a chorus line like `Pour, O pour the pirate sherry` occurs more than once, and the second occurrence may be cut in a later draft while the first survives; the cue then moves to the surviving copy with status `approximate`, so it shows in the review and the user decides.
- A quote that runs across a line or page break still matches in `place_cue_at_text` (the word stream is continuous; verified with `As the curtain rises groups of pirates`, where `As the` ends the previous line), but the cue then sits on the line of the **first** quoted word, which may be the line above the one you mean. `search_script` is stricter: it matches within one printed line only, so the same quote returns no hits there. Read `get_page` to see where the lines break, and quote words that sit on the one line the cue belongs to.
- A quote that is nowhere in the document is `not_found: The quote was not found in "<title>"`. Search for a shorter run, read the page, and quote what is printed. Do not fall back to coordinates for a document that has text.

Ambiguity: when the quote occurs more than once the call writes nothing and returns `{status: "ambiguous", matches: [{occurrence, pageIndex, snippet}]}`. Pick the right one and call again with `occurrence` or `nearPageIndex` (the occurrence nearest that page, earlier on a tie). If the user's cue list gives a page number, use `nearPageIndex: page - 1`. `occurrence` is 1-based in script order and counts every raw match of the pass that found any: exact matches when there are exact ones, otherwise the forgiving matches; overlapping matches each count, so `occurrence` numbers always equal the `ambiguous` list's, which shows the first 20.

The result is `{status: "placed", cue, match: {pageIndex, snippet}}`. Keep `cue.id`.

```json
{"status":"placed","cue":{"id":"01a146d5-8f94-765d-a313-a98c33023402","departmentCode":"LX","display":"10","label":"Preset: house to half","type":"go",
  "anchor":{"pageIndex":0,"x":89.754,"y":459.12,"status":"ok","text":{"quote":"A rocky sea-shore on the coast of Cornwall","wordStart":47,"wordEnd":54}}},
 "match":{"pageIndex":0,"snippet":"Stanley's Daughters ACT I A rocky sea-shore on the coast of Cornwall ACT II A ruined"}}
```

Coordinates are for marks that are not about a line: `create_cue` with `anchor: {documentId, pageIndex, x, y}` places a cue at a point on the **current** version with no trigger words. On the page it prints as a tick at the anchor instead of an underline, the cue sheet's `Trigger` is empty, and a revision can only keep its page and position. Use it only for scans with no text, or when the user gives a position. `x` and `y` are PDF points, origin bottom left (see [reading-scripts.md](reading-scripts.md)).

## Numbering

A cue number is `major.minor`: major 0..9999, minor 0..99, given as text with at most two decimals (`"14"`, `"14.5"`, `"14.25"`; `"14.50"` equals `"14.5"`). Display follows the department: `decimal` shows `14.5`, `point` shows `14.50`. Major `0` is the line-check range and renumbering leaves it alone.

**Leave `number` out and Binder suggests one** (`suggestCueNumber` in `packages/core/src/cues/numbering.ts`). The neighbours are the department's cues anchored on the **same document version** as the new anchor, in reading order; cues on other documents, on older versions, and unplaced cues are not neighbours, so they are not avoided.

| Situation | Suggested number |
|---|---|
| No cue of the department on this version yet | `10` (the block size), even if the department has cues elsewhere, so it can duplicate one |
| After the last cue (no later neighbour) | the next integer: after `12` comes `13`, after `12.5` comes `13` |
| Before the first cue (no earlier neighbour) | the previous neighbour counts as `0`, so the next integer above 0 if it is below the first cue: before `10` comes `1`; before `1` the midpoint rule gives `0.5`; before `0.5` → `0.2` |
| Between two cues | the next integer after the earlier one if it is below the later one (`10` and `12` → `11`); else a multiple of `.50` strictly between them (`10` and `11` → `10.5`), else of `.10` (`10` and `10.5` → `10.2`), else the hundredth midpoint (`10` and `10.1` → `10.05`) |
| Nothing fits (between `10.01` and `10.02`) | the earlier number again, so the cue is flagged `duplicate` for you to fix |
| Unplaced (no anchor) | the department's highest number anywhere plus one, integer |

So on a fresh layer, placing in script order gives `10, 11, 12, …`, and inserting later gives point cues. Verified: a cue placed between LX 10 and LX 11 got `10.5`; between 10 and 10.5 got `10.2`; a cue placed above LX 10 got `1`, and one above that got `0.5`. Pass `number` yourself whenever the suggestion would be wrong for the user: anything before the first cue (`1` is rarely wanted; `0.x` is the line-check range), a new document or version of a department that already has numbers, and any list with numbers of its own. Check `duplicate` on every result either way.

**Give `number` when the user's cue list has numbers**, and keep them exactly. Do not renumber someone's list to taste.

Collisions are not refused. The result and `list_cues` carry `duplicate: true` on every cue that shares a number with another in the same department. After a batch, filter `list_cues` for `duplicate` and either renumber the newcomer (`update_cue {cueId, number}`) or ask the user.

**Renumber from script order** (`renumber_cues {showId, department, documentId, blockSize?}`) rewrites one department's placed numbers in one document: cues on the current version in reading order, then any left on an older version, starting at `blockSize` (default 10) and counting up in integers with minors reset. It is one revertable batch. It ignores unplaced cues and the 0 range and does not avoid their numbers, so an unplaced `12` can collide with a renumbered placed cue. The result's `flagged` lists both cues with reason `duplicate` (as does `list_cues` with `duplicate: true`); fix them with `update_cue` or ask the user. Only run it when the user asks for a renumber; it changes every cue's number and so every printed script and cue sheet.

## Inserting between existing cues

1. `list_cues {showId, department, documentId}` and find the cues either side of the new trigger (compare `anchor.pageIndex`, then higher `y` is earlier). Only cues on the current version count as neighbours.
2. Both sides present: `place_cue_at_text` without `number` gives the point cue between them (or the free integer, if one fits).
3. No earlier neighbour (the new cue is the first on the page run): the suggestion is `1` (then `0.5`, `0.2`…), which is almost never what the user wants. Pass `number` yourself, usually the block below the first cue (`9`, or `5`), and say so.
4. No later neighbour: the suggestion is the next integer after the last cue, which is usually right.
5. If the user wants a specific number (`12.5`), pass it; if that number exists, the result says `duplicate: true` and you fix one of them.

For TheatreMix layers, the house style is tens for songs and consecutive integers within a song (`10, 11, 12`), points for later insertions (`11.5`); see `binder://guides/jayden-style`.

## Labels and notes

- `label` (≤200 chars): the short operational text that prints in the cue sheet. House style is terse: what happens, not prose (`Build on pirates`, `Mic swap: Frederic to Ruth`, `Blackout`). Include a page reference only when the user's list does.
- `notes` (≤10000 chars): longer operator notes. On the page the **whole note is flattened to one line** (all whitespace, line breaks included, collapsed to single spaces) and printed under the tag in 7 pt, cut with `…` to the note column (the margin less 8 pt); no note prints when that column is under 40 pt, that is when the margin is under 48 pt. The print can leave notes out with `includeCueNotes: false`. The full text goes to the cue sheet's `Notes` column, so put the operator's one-glance phrase first.
- `colour` overrides the department colour for one cue; leave it `null` unless asked.

## Batching and idempotency

MCP writes are immediate and each call is its own transaction and change-log batch. There is no bulk-create tool: a cue list is one `place_cue_at_text` per row.

- **Plan first.** Resolve every quote with `search_script` (or a dry `place_cue_at_text` is not possible: it writes on a unique match), build the table of `number, department, type, label, quote, page`, show it to the user, and only then write.
- **Write in script order**, one call at a time, and record each returned `cue.id` against the row. Stop on the first error and report it; do not keep going blind.
- **Retries.** A call that timed out may still have written. Before retrying, `list_cues {showId, department}` and look for the row's label and quote (`anchor.text.quote`); if it is there, skip it. Never retry by re-sending the whole list.
- **Idempotency key.** Binder has none for MCP creates. Make your own: the pair `(department, quote, occurrence)` identifies a placement; a cue with the same trigger and label already on the layer is yours from an earlier attempt.
- **Ambiguous rows** return without writing; resolve them and continue. They do not break ordering because numbers are suggested from neighbours at the time of each call, so finish the unambiguous rows in order first only if numbers are given explicitly; otherwise resolve each ambiguity before moving on, so suggested numbers stay in script order.
- After the batch, `get_activity {showId, limit: N}` shows your rows as `<user> via <client>` with one batch per call; `revert_batch` undoes one call, `delete_cues` with the collected ids undoes the lot (more than 10 needs `confirm: true`).

## How a cue looks on the page

From `packages/core/src/markup/cueTags.ts` and `print/stampScript.ts`, the same layout on screen and in print:

```
 ┌──────────┐
 │ LX  12   │────────┐                 ← tag: white pill, department-coloured outline
 └──────────┘        │                    (dashed for standby, heavier for warn)
  Slow 8 count…      │                 ← note: one line under the tag, department colour
                     └── KING: Yes, Frederic, from to-day you rank
                         ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾  ← trigger words underlined
```

- The **tag** sits flush in the margin of the department's side (`settings.markerSides[departmentId]`, left by default), level with the trigger line. It shows the department code (with `SB` or `W` for standby and warn) and the number in bold. When the margin is too narrow the code is dropped, then the type word, so the number always shows.
- The **leader line** runs from the tag to the underline's end at the underline's `y`, so it never crosses a glyph. A tag spread above or below its line by a crowded stack leaves at its own centre, turns in the gutter beside the text block and comes in at the line.
- Tags on one side keep page order. Tags that crowd one another stack 2 pt apart and spread up and down around their own lines (two cues on one line sit just above and just below it); a tag that overlaps nothing stays level with its line. Nothing goes under the footer.
- The **trigger words** are underlined (1.5 pt) on each line they cover. A cue without trigger words gets a short vertical tick at its anchor instead. That is the default `underline` mark; a cue can choose another with `anchor.mark` (see below).
- The **note** is the whole `notes` text flattened to one line of 7 pt in the department colour directly under the tag, cut with `…` to the note column (margin less 8 pt); none when the margin is under 48 pt.
- Several cues on one line get leaders 1.5 pt apart so they separate in black and white.

### Marks: underline, highlight, line, pointer

`mark` says how the cue marks its place; absent means `underline`. Set it with `place_cue_at_text {mark, charOffset}` or restyle a placed cue with `update_cue {mark, charOffset}` (the quote and page stay; `x` follows a line or pointer's character position, so switching to a line moves `x` to the caret and leaving a line keeps `x` at the old caret position).

| Mark | Drawn as | Use it for |
|---|---|---|
| `underline` | The default: the trigger words underlined. | A cue that fires on a phrase. |
| `highlight` | The whole quoted range filled with the department colour at about 28% (translucent, so the text still reads). `place_cue_at_text` anchors the **whole** matched quote, not the usual first eight words. | A cue that spans a passage, such as underscore or a held effect. Quote the passage in full. |
| `line` | A thin vertical bar in the department colour at one character position inside the first word, a little taller than the word. | A cue on an exact syllable or breath: `charOffset` 3 puts it after the third character of the word. |
| `pointer` | The same bar with a small triangle on top. | A line cue that should be easy to spot. |

- `charOffset` counts characters from the start of the quote's first word: 0 is before it, the word's length is after its last character. To put a bar in a later word, start the `quote` at that word. `charOffset` is an error with `underline` or `highlight`, and `place_cue_at_text` rejects an offset past the end of the first word (`update_cue` clamps it).
- A `line` or `pointer` ignores the rest of the quote for drawing; the quote is still what re-anchoring searches for after a revision.
- A cue placed by **coordinates** (`create_cue` or `update_cue` with `anchor`, which accept `mark`) binds no word: a `line` or `pointer` is a free bar 14 pt tall centred on `(x, y)`, and an `underline` or `highlight` falls back to the short tick.
- Marks belong to cues; annotation tools refuse a `mark` (and a `bubble`).
- Read the mark back from `anchor.mark` (absent is `underline`) and, for a line or pointer, `anchor.text.offset`.

### The bubble: in the margin, or moved

By default the number bubble sits in the margin, level with the trigger line. It can be moved: the offset is stored as `anchor.tag` (`{dx, dy}` in points from the cue's point, `dx` right and `dy` up) and absent means the margin. Set it with `update_cue {bubble: {dx, dy}}` or when placing by coordinates (`create_cue` or `update_cue` `anchor: {…, bubble: {dx, dy}}`); `update_cue {bubble: null}` puts it back in the margin. `place_cue_at_text` takes no `bubble`: place the cue, then move its bubble.

- Moving the bubble moves **only the bubble**. The cue stays on its words. In the app, dragging the bubble moves the bubble; moving the cue is dragging its **mark** (with the Select tool) or "Move to...". Alt+arrow keys nudge a selected cue's bubble 1 pt (10 pt with Shift; plain arrows still turn the page), and the cue editor's Bubble row says "In the margin" or "Moved" and has **Reset to margin**.
- A moved bubble takes no part in the margin spread, is joined to its mark by one straight leader to the end of the mark nearest the bubble (none when it sits over its own mark), and **draws no note**. It prints where it was put, on screen and in the export.
- A restyle (`mark`, `charOffset`) keeps the bubble where it was put. A new coordinate `anchor` replaces the whole anchor, so the bubble returns to the margin unless that anchor carries a `bubble`.
- History reads a bubble change as "bubble moved" ("Bubble back in the margin" on a reset), and reverting it restores the old position.
- Offsets are limited to ±14400 points; a bubble can be put anywhere on, or past the edge of, the page, so check it still lands on the paper. Read it back from `anchor.tag`.

Every page of a marked-script export also carries a footer: `Show · Document v2 · LX, SND · export <id tail> · 2026-10-16 22:31`.

## Verify what you wrote

After every batch, read back and compare against the plan:

1. `list_cues {showId, department, documentId}`: every planned row is present once, `display` matches the plan, no unexpected `duplicate: true`, every `anchor.status` is `ok`, every `anchor.text.quote` is the trigger you meant.
2. For anything that looks off, `get_page {versionId, index}` of that page and read the lines around the anchor's `y`.
3. Optionally `export_cue_list {showId, department, format: "csv"}` and read the resource: the `Trigger` and `Page` columns are the quickest human-readable check, and the `Status` column flags `duplicate`, `approximate`, `unresolved` and `on older version`.
4. Report to the user: the count, the numbers, and anything you skipped or could not place, each with its page (1-based) and quote.

```
Cue,Type,Label,Page,Document,Trigger,Notes,Status
10,go,Preset: house to half,1,,A rocky sea-shore on the coast of Cornwall,,
11,go,Act II card,1,,ACT II,,
13,go,Build on pirates (entrance),1,,curtain rises groups of pirates,Slow 8 count build; hold until King speaks,
```
