# Revisions and history

Uploading a new script version and reviewing where the marks landed; reading the change log and activity feed; reverting; comparing versions.
Derived from `apps/api/src/processing/reanchorJob.ts`, `packages/core/src/anchors/reanchor.ts`, `apps/api/src/services/revisions.ts`, `history.ts`, `revert.ts`, `packages/core/src/history/summarise.ts`.

Read this when a new draft of the script arrives, when the user asks what changed or who changed it, or before undoing anything.

## Uploading a revision

A revision is a new **version** of the same document, never a new document (a new document has no cues on it).

1. `list_documents {showId}`: find the document id and note `currentVersionId`.
2. Tell the user what the upload will do (step 4: every mark on the document is re-anchored, other members' personal notes included, and the current version switches; none of it is gated) and get a yes. Then upload as the next version: `upload_document {showId, url, documentId, label?}` for a public URL, or over REST for a local file: `curl -F label="Rehearsal cut 2" -F file=@script.pdf -H "Authorization: Bearer $BINDER_TOKEN" "$BINDER_API/api/shows/$SHOW/documents/$DOC/versions"` (`$BINDER_TOKEN` is the session token the user set in the environment; if you do not hold one, give the user that command to run). The response has the new `version.id` with `status: "queued"`.
3. Poll `get_document {documentId}` until that version is `ready` (or `failed`: see [documents-and-processing.md](documents-and-processing.md)). The current version is **unchanged** while it processes, so people keep working on the old one.
4. When the version is ready, the server runs the **re-anchoring job** and then switches `currentVersionId` to it. Confirm with `get_document` that `document.currentVersionId` is the new id before reading the review.

Verified on a three-page libretto: processing and re-anchoring finished within a minute; `get_activity` then showed the run as one batch.

## What re-anchoring does

For every cue and annotation anchored on the old version (other members' personal annotations included, since the job is the server's), the job computes a new anchor on the new version and writes it through the normal change log under one batch, `batchId: "reanchor:<newVersionId>"`, attributed to the uploader with `via: "web"` and `agent: "Binder re-anchoring"`:

| The mark has | Result | Status |
|---|---|---|
| a quote found exactly once in the new text | moved to that line; `x` kept relative to the line's left edge; word indices rebound | `ok` |
| a quote found once with the forgiving match (case, punctuation, line-end hyphen) | the same | `approximate` |
| a quote found several times | the occurrence nearest the old relative position in the document | `approximate` |
| a quote found nowhere, or no quote; page counts equal | same page and position; words unbound (`wordStart: -1`) | `approximate` |
| the same, page counts differ, page still exists | same page and position | `unresolved` |
| the same, page no longer exists | the last page | `unresolved` |

Re-anchoring never deletes a mark. The old anchor is kept in the log as `before`, and the review list shows it as `previous`.

Two consequences to warn the user about:

- A cue whose line was **cut** keeps its page and position with status `approximate`; it needs a decision.
- A cue whose line was cut while the **same words survive once elsewhere** moves there with status `ok` and does not appear in the review. Verified: a cue on the second `Pour, O pour the pirate sherry` moved to the first when the second was cut. After a revision, read `compare_versions` and check cues near every removed line, not only the review list.

## The review list

`get_reanchor_review {documentId}` → `{currentVersionId, pending, olderVersions}`.

- `pending`: items on the current version whose status is `approximate` or `unresolved`.
- `olderVersions`: items still anchored to another version (a revert, or a cue placed offline on the old version after the switch).
- Each item: `table` (`cues` or `annotations`), `rowId`, `layer`, `title` (`LX 12 · Fly out`, `note · first words…`), `anchor`, `previous` (the anchor before the latest run moved it, or `null`). Grouped by layer in department order, your personal layer last, then reading order. Other members' personal items are never shown.

```json
{"table":"cues","rowId":"01a146d5-9075-770d-bfc6-bbedf46308dd","layer":"department:01a146d3-e223-71ae-80f9-a877475e6464","title":"SND 10 · King enters",
 "anchor":{"pageIndex":1,"x":101.359,"y":397.299,"status":"approximate","text":{"quote":"Yes, Frederic, from to-day you rank","wordStart":-1,"wordEnd":-1},"documentVersionId":"01a146d8-…"},
 "previous":{"pageIndex":1,"x":101.359,"y":397.299,"status":"ok","text":{"quote":"Yes, Frederic, from to-day you rank","wordStart":115,"wordEnd":120},"documentVersionId":"01a146d4-…"}}
```

Resolving, one item per call, with `resolve_reanchor_item {table, rowId, action}` (needs edit rights on the item's layer; returns `{anchor}`):

| Item | What to do |
|---|---|
| `approximate` and the line is still there (`search_script` the quote on the new version finds it, or the page image shows it at the anchor) | `accept`: status becomes `ok` where it is. |
| `approximate` but the line moved and the match is wrong | Move it: for a cue, `update_cue` with a coordinate anchor loses the trigger words, so prefer `delete_cues` + `place_cue_at_text` with the right quote, carrying over `number`, `label`, `type` and `notes` from `get_cue`; `place_cue_at_text` has no `colour`, so set a custom colour afterwards with `update_cue`. The cue gets a new id and a fresh history (its old rows stay under the old id). For an annotation, `update_annotation` with a new `anchor` (and `text` for a highlight) keeps the id. |
| the line was cut and the cue no longer applies | Ask the user; `delete_cues` if they agree, or leave it `unresolved` with a note. |
| `unresolved` with words unbound | Find the new line with `search_script`; re-place as above, or `accept` to keep it where it is. |
| in `olderVersions` | `reanchor` runs the matcher from its version to the current one (then it appears in `pending` if not `ok`), or `revert` puts back `previous`. `accept` is refused here: `invalid: Re-anchor or move it to the current version first`. |
| the run moved something that was right before | `revert`: restores `previous`, which puts the item back on the **older** version; it then shows in `olderVersions` until re-anchored or moved. `invalid: nothing to revert to: no re-anchoring run moved this item` when no run touched it. |

Every resolution is an ordinary logged edit by you, revertable with `revert_change`.

## Comparing versions

`compare_versions {fromVersionId, toVersionId, limit?, context?}` gives a line diff in reading order: `entries` of `{op: "same" | "added" | "removed", text, old: {pageIndex, lineIndex}, new}` with `added` and `removed` counts for the whole diff. Lines compare by their normalised words, so punctuation and case changes are not differences. `limit` (default 2000) counts changed lines; `context` (default 2) is the unchanged lines kept around each; `truncated` says whether changes were cut. Pass `context: 0` and a small `limit` for a quick "what was cut" summary:

```json
{"added":17,"removed":15,"truncated":false,"entries":[
  {"op":"removed","text":"SAMUEL: Two and twenty, now he's rising,","old":{"pageIndex":1,"lineIndex":9}},
  {"op":"removed","text":"Pour, O pour the pirate sherry;","old":{"pageIndex":1,"lineIndex":16}},
  {"op":"added","text":"that, once out of my indentures, I shall feel myself","new":{"pageIndex":2,"lineIndex":32}}]}
```

A rewrite of more than 4000 differing lines is refused (`invalid: Too many changes to compare line by line.`); compare act by act with smaller uploads, or read the pages.

`get_version_anchors {versionId}` lists every cue and annotation with the anchor it had on that version (its current one, or the newest in its history that was on the version), grouped by layer then reading order: the way to see where marks sat on an older draft, or to print an older version with its marks (`export_marked_script` with `versionId`).

## The change log and activity feed

Every write, by anyone through any path, is a row in the show's change log. Two views:

- `get_history {showId, …}`: rows newest first, with `before` and `after` holding only the changed columns. Filter by `rowId` (one cue's whole story), `table`, `layer`, `userId`, `kind` and a `from`/`to` window; page back with `before: nextBefore`. Each row's `seq` is what `revert_change` takes.
- `get_activity {showId, …}`: the same rows grouped into batches, newest first, each with a sentence (`moved 3 TM cues and relabelled 1`, `deleted 11 VID cues`, `uploaded 1 revision`), who did it, `fromSeq`/`toSeq`, and the `batchId` and `userId` that `revert_batch` takes. The show card's `lastChange.sentence` in `list_shows` words the same batch differently (`revision uploaded`, `LX relabelled 3 cues`); `lastChange.summary` uses the feed's wording.

Only writes are logged. Exports, page reads, searches and history reads leave no row: for "what was exported" use `list_exports`.

Attribution: `label` is the person's name, or `<name> via <client>` when an `agent` is recorded. The agent is the MCP client's declared `name/version` (`claude-code` shows as `Claude Code`, `claude-desktop` as `Claude Desktop`, `claude-ai` as `Claude`; anything else as it calls itself, up to the first `/`), or the HTTP `User-Agent` for a client that does not declare one (a `curl` upload over REST shows as `via curl`). The server's re-anchoring run shows as `<uploader> via Binder re-anchoring`. `kind: "agent"` selects rows with an agent, which includes that run; `kind: "human"` rows come from the web app.

"What changed since yesterday": `get_activity {showId, from: "<ISO time>"}`; add `layer: "LX"` for one department, `kind: "human"` to leave agents out. The `from`/`to` bounds are inclusive and parsed with `Date.parse`; always give them in UTC (`2026-10-15T22:00:00Z`), because you cannot discover the server's or the user's time zone, and say the bound you used.

A revert is logged as an ordinary new batch with ordinary wording (`relabelled 1 LX cue and edited 1`): nothing in the row or group marks it as a revert. The only link is the `batchId` that `revert_change` / `revert_batch` returned, so keep it and name it when you report; otherwise a revert is recognisable only by its `before`/`after` being the earlier row's `after`/`before`.

```json
{"groups":[{"batchId":"reanchor:01a146d8-a21b-780e-a484-d4fde54749e0","userId":"01a146d2-…","label":"Skill Docs Agent via Binder re-anchoring",
  "summary":"moved 3 LX annotations; moved 1 SND annotation; moved 5 LX cues; moved 2 SND cues; updated 1 document","at":"2026-10-16T22:32:53.908Z","fromSeq":115670,"toSeq":115681,"count":12,"via":"web","agent":"Binder re-anchoring"}]}
```

## Revert

Reverting writes the old values back as a **new** logged change in a new batch, which can itself be reverted. Nothing is ever removed from the log.

`revert_change {seq, force?}` reverts one row:

- cues and annotations: inserts (deleted again), updates (old columns restored), deletes (recreated with the same id);
- departments, documents and shows: updates only (`invalid: a insert on departments cannot be reverted`); a document's `currentVersionId` change only as part of its whole batch.
- Rights are the owning service's: edit rights on the layer for cues and annotations, editor on the show for documents, owner for departments and shows.
- **Conflict rule:** if any column the change wrote has changed since (compared with the row's `after`), the call is `conflict: cues <id> has changed since (label, notes); revert with force to overwrite` and nothing is written. `force: true` overwrites anyway (ungated: ask first). A revert of a revert is therefore a conflict too: revert the newer batch instead.
- Reverting the same `seq` twice (verified): an **update** answers the conflict above, and only with `force` is it skipped as `already-reverted`; an **insert** whose row is already gone is skipped `already-reverted` with no `force` needed; a **delete** whose row is back is `conflict: cues <id>: row exists again` unless `force`, which skips it. A row that is gone when an update is reverted is `conflict … no longer exists` for a single revert and `row-gone` in a batch.
- Returns `{batchId, reverted, skipped}`.

`revert_batch {showId, batchId, userId, force?, confirm?}` reverts every row one user wrote in one batch, newest first, all or nothing: one conflict or one layer you cannot edit refuses the whole call. It first does the work as a dry run; when that would change or delete more than 10 rows it returns `CONFIRMATION_REQUIRED` with `Reverting this batch changes 11 rows and deletes 0.` until called with `confirm: true`. Returns `{batchId, reverted, skipped, rows, deletes}`.

A re-anchoring run (`batchId` starting `reanchor:`) is reverted as one document operation: any editor may, it restores the previous anchors and the previous current version, including other members' personal annotations that the run moved (counted, never named). Rows changed since the run are a conflict unless `force`, and forcing over a layer you cannot edit is `forbidden`.

Limits of revert:

- Document and version lifecycle events (upload, cancel, retry, remove) are not revertable. `remove_version` is permanent.
- Membership changes are not revertable through these tools; use `add_show_member` / `update_show_member` again.
- Reverting an insert deletes the row; a cue someone has since edited is protected by the conflict rule, so read the conflict message and ask before forcing.
- A revert runs as you: it needs your rights on every row's layer, so an SND-scoped editor cannot revert an LX change. (Today the conflict check runs before the rights check, so such an attempt can return `conflict` naming the drifted columns instead of `forbidden`.)

Safe undo recipe: [workflows.md](workflows.md#7-undo-a-mistake-safely).
