# Workflows

Recipes as exact tool-call sequences with the checks between steps. Each was run against a local Binder with the public-domain *Pirates of Penzance* libretto fixture; the responses shown are real, trimmed.
Tool details are in [tools.md](tools.md); the rules every recipe obeys are in [safety.md](safety.md).

Read this when you have a task to carry out end to end. Replace the ids with the ones your own `list_shows` and `list_documents` return.

Every recipe starts the same way:

```
0a. list_shows {}                      → showId, role, status, inNow, lastChange
0b. list_departments {showId}          → codes, numberFormat, hidden
0c. list_documents {showId}            → documentId, currentVersionId, status "ready"
```

Stop and tell the user if the show is `archived`, your role cannot do the job, the document is not `ready`, or `inNow` lists people and the job is a bulk write.

## 1. Mark up a script from a cue list the user pasted

The user pastes:

```
LX 10  go       Preset: house to half      "A rocky sea-shore on the coast of Cornwall"
LX 11  go       Build on pirates           "curtain rises groups of pirates"   p.1
SND 20 standby  Sherry reprise             "Pour, O pour the pirate sherry"    p.2
SND 10 go       King enters                "Yes, Frederic, from to-day you rank"
```

1. Steps 0a–0c. Confirm you are owner or an editor scoped to LX and SND.
2. `list_cues {showId, department: "LX"}` and `{…, department: "SND"}`: note existing numbers so you can warn about collisions.
3. For every row, `search_script {versionId, query: <quote>}` and count hits. Build the plan table (number, department, type, label, quote, page, hit count) and **show it to the user** with anything ambiguous or not found marked. Wait for a yes.
4. Place each row in script order with `place_cue_at_text`, passing the user's `number`:

   ```json
   {"showId":"01a146d3-e21c-7a9e-9bd7-b2b7977b0fd6","department":"LX","quote":"A rocky sea-shore on the coast of Cornwall","number":"10","label":"Preset: house to half","type":"go"}
   ```
   ```json
   {"status":"placed","cue":{"id":"01a146d5-8f94-765d-a313-a98c33023402","display":"10","departmentCode":"LX","label":"Preset: house to half",
     "anchor":{"pageIndex":0,"x":89.754,"y":459.12,"status":"ok","text":{"quote":"A rocky sea-shore on the coast of Cornwall","wordStart":47,"wordEnd":54}}},
    "match":{"pageIndex":0,"snippet":"Stanley's Daughters ACT I A rocky sea-shore on the coast of Cornwall ACT II A ruined"}}
   ```
5. A row that comes back `ambiguous` writes nothing. Use the user's page (`nearPageIndex: 1` for "p.2") or the listed `occurrence`:

   ```json
   {"status":"ambiguous","matches":[{"occurrence":1,"pageIndex":0,"snippet":"feet.) OPENING CHORUS ALL: Pour, O pour the pirate sherry; Fill, O fill the"},
                                    {"occurrence":2,"pageIndex":1,"snippet":"out of his indentures. Pour, O pour the pirate sherry; Fill, O fill the"}]}
   ```
   ```json
   {"showId":"…","department":"SND","quote":"Pour, O pour the pirate sherry","occurrence":2,"number":"20","label":"Sherry reprise","type":"standby"}
   → {"status":"placed","cue":{"display":"20","type":"standby","anchor":{"pageIndex":1,"x":86.696,"y":505.49,"status":"ok",…}}}
   ```
6. A row with a quote in different case or punctuation still places (`yes frederic from today you rank` matched `Yes, Frederic, from to-day you rank`). A row that is `not_found` is reported, not guessed.
7. Verify: `list_cues {showId, department: "LX"}` and `"SND"`; check each `display`, `label`, `anchor.text.quote`, `anchor.pageIndex`, and `duplicate: false`.
8. Report the table with cue ids, and the activity line `get_activity {showId, limit: 5}` would show (`added … via <client>`).

## 2. Find where a described moment happens, then place a cue

"Put a sound cue where the Pirate King comes forward."

1. Steps 0a–0c.
2. `search_script {versionId, query: "PIRATE KING"}`:
   ```json
   {"hits":[{"lineIndex":5,"wordStart":14,"wordEnd":15,"pageIndex":0,"snippet":"THE PIRATE KING","box":{"x":81.174,"y":654.965,"w":39.732,"h":10.175}},
            {"lineIndex":20,"wordStart":110,"wordEnd":111,"pageIndex":1,"snippet":"and comes forward with PIRATE KING, who enters)","box":{"x":264.544,"y":423.124,"w":39.732,"h":10.175}}]}
   ```
   The first hit is the dramatis personae on page 1 (not a moment); the second is the stage direction on page 2.
3. `get_page {versionId, index: 1, includeImage: false}` and read around line 20 to confirm it is `(FREDERIC rises and comes forward with PIRATE KING, who enters)`.
4. Tell the user: "Page 2, the stage direction *FREDERIC rises and comes forward with PIRATE KING, who enters*. Place SND there?" Wait.
5. `place_cue_at_text {showId, department: "SND", quote: "FREDERIC rises and comes forward with PIRATE KING", label: "King enters"}` (no `number`: the next one from the neighbours).
6. `get_cue {cueId}` and quote back `display`, page and trigger.

## 3. Bulk-import cues from CSV

The user supplies a CSV with the columns of Binder's own cue sheet (`Cue, Type, Label, Page, Document, Trigger, Notes, Status`), or any sheet with number, type, label, trigger and page.

1. Steps 0a–0c. Parse the CSV; map `Cue` → `number` (text, at most two decimals), `Type` → `type` (`go` when blank), `Label`, `Trigger` → `quote`, `Page` → `nearPageIndex = Page - 1`, `Notes` → `notes`. Rows without a trigger become unplaced cues.
2. Dry check every trigger with `search_script` and collect: found once, found several times (note which hit is on `Page`), not found. Show the user the counts and the problem rows. Wait for a yes.
3. Check `list_cues {showId, department}` for existing numbers; list the collisions the import would create.
4. Import in script order, one `place_cue_at_text` per row with `number`, `label`, `type`, `notes`, `quote`, `nearPageIndex`. Unplaced rows: `create_cue {showId, department, number, label, type, notes}`.
   ```json
   {"id":"01a146d6-57b4-72f6-b192-3815be8762c4","departmentCode":"LX","display":"12","type":"warn","label":"Unplaced spare","anchor":null,"duplicate":false}
   ```
5. Keep a ledger `row → cueId`. If a call fails with a transport error, `list_cues` and look for the row's quote before retrying it (see [placing-cues.md](placing-cues.md#batching-and-idempotency)).
6. Verify with `export_cue_list {showId, department, format: "csv"}` and read `binder://shows/{showId}/exports/{exportId}`; diff its rows against the input.
7. The import never renumbers. If the user wants script-order numbers afterwards, recipe 4.

## 4. Audit a department's numbering and fix collisions

1. Steps 0a–0c.
2. `list_cues {showId, department: "LX"}`. The list is in number order; walk it and report every `duplicate: true`, every placed cue whose number is out of reading order (compare `anchor.pageIndex`, then higher `y` first), and the unplaced cues.
   ```
   {"display":"12","label":"Act II preset reference","duplicate":true,"page":0,"y":397}
   {"display":"12","label":"Unplaced spare","duplicate":true,"page":null}
   ```
3. Propose a fix per collision and wait: usually `update_cue {cueId, number: "12.5"}` for the newcomer, or a renumber of the whole layer.
4. Point fix: `update_cue {cueId: "01a146d6-57da-7e94-8d5a-45a4f72a3791", number: "11.5"}` → `{"display":"11.5","duplicate":false}`.
5. Whole layer, only on request (it is not confirm-gated, so the user's yes to the plan is the gate): `renumber_cues {showId, department: "LX", documentId}` → `{"changed":4,"flagged":[]}`. It numbers placed cues `10, 11, 12…` in script order and leaves unplaced cues and the `0` range alone, without avoiding their numbers, so an unplaced cue can now share a number with a placed one. `flagged` then lists both cues with `"reason":"duplicate"` (an empty `flagged` means no collision). Re-run step 2 to see the numbers, and fix them with `update_cue`.
6. `get_activity {showId, limit: 1}` gives the renumber's `batchId`; keep it so `revert_batch` can undo the whole renumber if the user changes their mind.

## 5. Handle a new script revision

1. Steps 0a–0c. Note `currentVersionId` (v1) and `list_cues {showId, documentId}` as the before-picture.
2. Tell the user the upload will re-anchor every mark on the document (other members' personal notes included) and switch the current version, ungated; wait for a yes. Upload: `upload_document {showId, url, documentId, label: "Rehearsal cut 2"}`, or over REST for a local file (`curl -F label="Rehearsal cut 2" -F file=@script.pdf -H "Authorization: Bearer $BINDER_TOKEN" "$BINDER_API/api/shows/$SHOW/documents/$DOC/versions"`, with the session token the user set in the environment, or hand them the command). Keep `version.id` (v2).
3. Poll `get_document {documentId}` until v2 is `ready` and `document.currentVersionId` is v2. If v2 is `failed`, read `failureMessage` and go to [documents-and-processing.md](documents-and-processing.md).
4. `compare_versions {fromVersionId: v1, toVersionId: v2, context: 0, limit: 200}` and summarise for the user: how many lines added and removed, and where.
   ```json
   {"added":17,"removed":15,"truncated":false,"entries":[{"op":"removed","text":"SAMUEL: Two and twenty, now he's rising,","old":{"pageIndex":1,"lineIndex":9}}, …]}
   ```
5. `get_reanchor_review {documentId}`. Present `pending` and `olderVersions` by layer with each `title`, status, page and `previous` page.
   ```json
   {"pending":[{"table":"cues","rowId":"01a146d5-9075-…","title":"SND 10 · King enters","anchor":{"status":"approximate","pageIndex":1,"text":{"wordStart":-1,…}},"previous":{"status":"ok","pageIndex":1,…}}],"olderVersions":[]}
   ```
6. For each item, decide with the user and call `resolve_reanchor_item`:
   - still on its line → `{"table":"annotations","rowId":"…","action":"accept"}` → `{"anchor":{"status":"ok",…}}`
   - line moved → re-place by quote: `get_cue`, then `delete_cues` and `place_cue_at_text` with the old `number`, `label`, `type` and `notes` (then `update_cue {colour}` if it had one; the id and history are new), or `update_annotation` with a new anchor
   - line cut → ask; delete, or leave it and tell the user
   - on an older version → `"action":"reanchor"` (or `"revert"` to put the run's move back)
7. Cues the run moved with status `ok` are not in the review, but a cue whose copy of a repeated line was cut is now `approximate` and is in the review. Still check, from step 4's removed lines, `list_cues {showId, documentId}` for any cue whose `anchor.text.quote` matches a removed line. Verified case: SND 20 on the second `Pour, O pour the pirate sherry` is `approximate` on the first when the second is cut.
8. `get_reanchor_review` again until `pending` and `olderVersions` are empty, then report.
9. If the run as a whole was wrong (wrong file uploaded), `get_activity {showId, limit: 5}` gives the `reanchor:<v2>` batch. Call `revert_batch {showId, batchId, userId}` without `confirm`; a run that moved more than 10 rows answers `CONFIRMATION_REQUIRED` with its summary. Show it, and on the user's yes call again with `confirm: true`: every anchor is restored and v1 is current again (recipe 7 rules apply).

## 6. Prepare and fetch a print of one department's layer

"Print the LX script for Act I (pages 1–2) on A4 without standbys."

1. Steps 0a–0c. Confirm the document and version with the user; `get_document` for the page count.
2. `list_cues {showId, department: "LX", documentId}` and check for `approximate`/`unresolved` anchors or `duplicate: true`: a print freezes them on paper, so say so first.
3. Export:
   ```json
   {"documentId":"01a146d4-1b45-7a9a-91f1-8b4242b4fc61","layers":["LX"],"pages":"1-2","paper":"A4","includeStandbyWarn":false}
   ```
   ```json
   {"record":{"id":"01a146d7-8673-7a3b-9921-c2503abc8f67","kind":"pdf-script","filename":"pirates-of-penzance-skill-docs-pirates-libretto-v1-LX.pdf","privateTo":null,
     "options":{"pages":"1-2","paper":"A4","includeCueNotes":true,"includeAnnotations":true,"includeStandbyWarn":false}},
    "uri":"binder://shows/01a146d3-e21c-7a9e-9bd7-b2b7977b0fd6/exports/01a146d7-8673-7a3b-9921-c2503abc8f67"}
   ```
4. Fetch: `resources/read {uri}` → `{"mimeType":"application/pdf","blob":"JVBERi0xLjcK…"}`; decode and confirm it starts `%PDF-`. For a large file, hand the user the `uri` and filename instead of reading it.
5. Also offer the cue sheet: `export_cue_list {showId, department: "LX", format: "pdf"}` (or `xlsx`, `csv`) and its `uri`.
6. Tell the user the filename, what it includes, and that it is listed under the show's exports (`list_exports {showId}`).

## 7. Undo a mistake safely

"Undo what I just did to the LX cues."

1. `get_activity {showId, limit: 10}` and find the batch: match `label` (the person, or `<person> via <client>` for your own calls), `summary` and `at`. Show the user the line you intend to revert and its `count`.
   ```json
   {"batchId":"01a146d7-83a0-73ac-b507-cb9a71c62d7d","userId":"01a146d2-…","label":"Skill Docs Agent via skill-docs-agent","summary":"deleted 11 VID cues","at":"2026-10-16T22:31:31.488Z","count":11}
   ```
2. For one field of one cue, use the row instead: `get_history {showId, rowId: cueId}` and pick the `seq` whose `after` holds the wrong value.
3. Revert:
   - one row: `revert_change {seq}` → `{"batchId":"01a146d8-a12b-…","reverted":1,"skipped":[]}`
   - a batch: `revert_batch {showId, batchId, userId}`. More than 10 rows answers `{"code":"CONFIRMATION_REQUIRED","summary":"Reverting this batch changes 11 rows and deletes 0."}`: show the summary to the user, and only on their yes call again with `confirm: true` → `{"batchId":"01a146d7-8430-…","reverted":11,"skipped":[],"rows":11,"deletes":0}`.
4. A `conflict: cues <id> has changed since (label, notes); revert with force to overwrite` means someone edited the row after the change you are undoing. Do not add `force` on your own: tell the user which columns moved and ask. You only get this conflict for rows you may edit; if you get `forbidden: you cannot edit this layer` instead, tell the user whose layer it is rather than retrying.
5. Verify with `get_cue` / `list_cues`, and `get_activity {showId, limit: 1}`: the revert is a new batch worded like any edit (`relabelled 1 LX cue and edited 1`), with nothing marking it as a revert, so quote the `batchId` the revert returned when you report; that batch can itself be reverted if the undo was wrong.
6. Never undo by hand-editing values back: a revert keeps the log honest and reversible.

## 8. Answer "what changed since yesterday"

1. Work out the time in UTC ISO 8601 (you cannot discover the server's or the user's time zone; "yesterday" means the last 24 hours unless the user gives a zone, and say which bound you used).
2. `get_activity {showId, from: "2026-10-15T22:00:00Z", limit: 50}`; page with `before: nextBefore` while `nextBefore` is not null. Only writes are in the feed: for exports use `list_exports`.
   ```json
   {"groups":[{"label":"Skill Docs Agent via skill-docs-agent","summary":"relabelled 1 LX cue and edited 1","at":"2026-10-16T22:32:44.582Z","count":1,"batchId":"01a146d8-a12b-…"},
              {"label":"Skill Docs Agent via skill-docs-agent","summary":"retried 1 upload","at":"2026-10-16T22:32:44.200Z","count":1,"batchId":"01a146d8-9fa8-…"},
              {"label":"Skill Docs Agent via skill-docs-agent","summary":"deleted 1 SND annotation","at":"2026-10-16T22:31:32.077Z","count":1,"batchId":"01a146d7-85ec-…"}],"nextBefore":115660}
   ```
3. Narrow when asked: `layer: "LX"` for one department, `kind: "human"` for people only, `kind: "agent"` for agents (the server's re-anchoring run counts as an agent).
4. For detail on one line, `get_history {showId, from, to, layer}` and read `before`/`after`, or `rowId` for one cue's story. Map department ids in `layer` keys to codes with `list_departments`.
5. Answer in the feed's own words, grouped by person, with times, and offer the revert recipe for anything the user wants undone. Do not infer edits you cannot see: other members' personal layers are not in the log you read.

## 9. Set up a show (owner only)

1. `list_organisations {}` → `organisationId`; `create_show {title, organisationId}` → `showId`. The seven default departments (`LX`, `SND`, `TM`, `VID`, `SM`, `STG`, `FLY`) are always created; there is no way to pick others at creation.
2. Adjust departments: `update_department {departmentId, numberFormat, colour, hidden}`; `create_department {showId, code, name, colour}` for extra ones.
3. `update_show {showId, settings: {...merged}}` for `paperSize`, `stampSet`, `markerSides` and `connectorStyles` (read `get_show` first; `settings` replaces the whole object).
4. Upload the libretto (recipe 5 step 2 without `documentId`, with `kind: "libretto"` and `title`; over REST `snapToText` is not accepted, so set it with `update_document` afterwards if needed), poll until `ready`.
5. Add people with `add_show_member {showId, email, role, departments}`; each one is confirm-gated, so show the summary and get a yes per member. Scope editors to their departments. The user must already exist in Binder.
6. `list_show_members` to read back, and hand the user the `showId`.
