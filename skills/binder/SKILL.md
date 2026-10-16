---
name: binder
description: Use when an agent works in Binder (by RVLT), the musical-theatre script-markup app, through its MCP server. Triggers - placing, editing, renumbering or deleting cues on a script; reading or searching a script's pages; adding notes, highlights, shapes or stamps; handling a new script revision and its re-anchoring review; exporting a marked-up script PDF or a department cue sheet; reading the change history, answering "what changed", and reverting; setting up a show, its departments, members and settings; uploading documents and dealing with processing failures.
version: 1.0.0
author: Jayden Nawotka
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [theatre, scripts, cues, stage-management, mcp, binder]
    related_skills: [theatremix-script-building]
---

# Binder: marking up scripts through MCP

Binder holds a theatre show's binder: the script and score as PDFs with a word layer per page, departments (`LX`, `SND`, `TM`, `SM`…) as layers, cues numbered per department and anchored to lines of the script, and annotations on department layers or on your own private layer. Every change is logged with who made it and through what, and can be reverted. An agent works through the same service layer as the web app, over MCP at `POST /mcp`, as the person whose token it carries.

This file is enough to avoid every serious mistake. The references hold the detail; read the one for the job before doing it.

## When to use

- Place, edit, move, renumber or delete cues (go, standby, warn) for a department on a script.
- Find a line or a described moment in a script, read a page, search the text.
- Add notes, highlights, boxes, arrows or stamps; read what others annotated.
- A new draft of the script arrived: upload it as a version, review where the marks landed, compare versions.
- Export a marked-up script PDF or a department's cue sheet (PDF, XLSX, CSV) and fetch the file.
- Answer who changed what and when; undo a change or a whole batch.
- Set up a show: departments, members and roles, settings; upload documents; cancel, retry or remove a failed upload.

Not for: building TheatreMix `.tmix` files (that is the `theatremix-script-building` skill, which reads Binder through these same tools), mixing advice, or anything outside the show binder.

## Prerequisites and connection

- A Binder personal access token (`bnd_…`) configured in the MCP client as `Authorization: Bearer bnd_…` against `https://<binder host>/mcp` (local: `http://localhost:3000/mcp`). The token belongs to one user and is either unscoped (`*`) or limited to some shows. Only that person can create one, in the web settings page or with the operator CLI. **There is no tool to create, list, revoke or widen a token, and no OAuth.** If the token cannot reach a show, say so.
- **Token handling.** You use only the token the user supplied for this session: the one in the client configuration, or one they put in an environment variable (`$BINDER_TOKEN`) for REST uploads. Never ask the user to paste a token into the chat, and never echo, log, print, store or reuse it. When a step needs a token you do not hold (a `curl` upload), give the user the command with `$BINDER_TOKEN` and `$BINDER_API` as placeholders to run themselves.
- User-run setup, not yours: Claude Code `claude mcp add --transport http binder https://<host>/mcp --header "Authorization: Bearer bnd_…"`; Claude Desktop `mcp-remote` with the header in `env` (see `docs/mcp.md`).
- Plain HTTP (no MCP client): `POST /mcp` with `Authorization: Bearer $BINDER_TOKEN`, `Content-Type: application/json` and `Accept: application/json, text/event-stream` (**required**; without it the answer is `406`), body `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_shows","arguments":{}}}`. No `initialize` is needed (stateless). The reply is server-sent events (`event: message` then `data: {…}`); read `result.structuredContent`. Full example in [references/tools.md](references/tools.md#calling-the-endpoint-with-plain-http).
- Every write is attributed to the token's user as `<name> via <your client name>` in the show's activity feed. Behave as if the stage manager is reading each line.
- The server serves this skill itself: an agent can read it from the `binder://skill/index` resource (its links point at the other files as `binder://skill/{slug}`).
- The server's `instructions` on connect summarise the tools; `binder://guides/jayden-style`, `binder://guides/mic-and-dca-practice` and `binder://guides/tmix-format` are the house rules. Read `jayden-style` before numbering a `TM` layer.

## Mental model

```
organisation → show (status, settings, members with roles)
                ├─ departments = layers (code, colour, numberFormat, hidden)   + your personal layer
                ├─ documents (kind) → versions (status, current one) → pages (words, image)
                ├─ cues: department layer, number major.minor, type, label, notes, anchor | null
                ├─ annotations: layer, type, anchor, geometry, text
                ├─ change log → history, activity feed, revert
                └─ export records → files
```

- **Ids**: `list_shows` → `showId`; `list_documents` → `documentId` and `currentVersionId`; page tools take the **version** id. Pages are zero-based (`pageIndex + 1` is what a person calls the page).
- **Coordinates**: PDF points, origin bottom-left; higher `y` is higher on the page. You rarely need them.
- **An anchor** ties a mark to a document version, a page and a point, and, for cues placed by text and for highlights, to the words (`anchor.text = {quote, wordStart, wordEnd}`). Text anchors survive a script revision; positional ones only keep page and position.
- **Roles**: `viewer` reads everything (except others' personal layers) and writes only their personal layer; `editor` writes cues and annotations on the departments in their scope and uploads documents; `owner` does everything including members, departments and settings. **Archived shows are read-only for everyone.**
- **Numbers**: text with at most two decimals (`"14"`, `"14.5"`); display follows the department (`decimal` 14.5, `point` 14.50). Omit the number and Binder suggests the next one from the neighbours in script order; collisions are flagged `duplicate: true`, never refused.
- **Writes are immediate** and each call is logged as its own batch. Cue and annotation changes (inserts, edits, deletes) and edits to departments, documents and shows can be reverted; document lifecycle events (upload, cancel, retry, remove) and membership changes cannot. The web app queues offline edits and syncs later, so `lastChange` and `inNow` from `list_shows` are your only warning that people are active.
- **Every new show has the same seven departments**: `LX`, `SND`, `TM`, `VID`, `SM`, `STG`, `FLY`. `create_show` cannot choose others; adjust them afterwards.

## The standard workflow

1. **Orient.** `list_shows` (role, status, `inNow`, `lastChange`) → `list_departments` → `list_documents` (the libretto's `currentVersionId`, `status: "ready"`).
2. **Read.** `search_script {versionId, query}` to find lines; `get_page {versionId, index, includeImage: false}` to read them (add the image when layout matters). `list_cues {showId, department}` to see what is already there.
3. **Plan.** Resolve every cue to a department, number, type, label, page and **quoted trigger words as printed**. Show the plan; for anything bulk, wait for a yes.
4. **Write.** One `place_cue_at_text {showId, department, quote, number?, label?, type?, notes?}` per cue. `ambiguous` means nothing was written: call again with `occurrence` or `nearPageIndex`. Use `create_cue` with coordinates only for scans without text. Edit with `update_cue`, annotate with `create_annotation`.
5. **Verify.** `list_cues` again (numbers, `duplicate`, `anchor.status`, `anchor.text.quote`), or `export_cue_list … csv` and read the resource. Report with page and trigger per cue.
6. **Hand back.** Name the activity line (`get_activity`) and how to undo (`revert_batch` / `delete_cues`).

Recipes with real responses: [references/workflows.md](references/workflows.md).

## Hard rules

1. **Read before you write.** Never write to an id you did not just list, and never place a cue on words you have not seen on the page.
2. **Never invent cues.** Every cue traces to the user's list or request; report each with its 1-based page and the quoted trigger. A quote that is `not_found` is reported, not approximated.
3. **Plan before bulk.** More than a handful of writes, any renumber, delete, batch revert, revision handling or membership change: show the table first, wait for a yes, write in order, report against the plan.
4. **Respect roles, scope and archived shows.** A `forbidden` is an answer, not an obstacle: do not switch department, layer or tool to get around it. Do not ask an owner to unarchive a show as a step.
5. **Never touch another member's personal layer.** Only `layer: "personal"` (yours). Their notes do not exist to you: no probing, no guessing what is there.
6. **Tokens stay where they are.** Never ask for, print, store or reuse a token; never use a production token for experiments; never contact a Binder the client is not configured for.
7. **The confirm gate.** `add_show_member`, `remove_show_member`, `update_show_member` (owner grant or removal), `delete_cues` and `delete_annotations` (over 10), `revert_batch` (over 10 rows) and `remove_version` (a document's only version) return `CONFIRMATION_REQUIRED` with a summary and change nothing. Show the summary verbatim, get an explicit yes to that action, then call again with `confirm: true`. Never pre-set it. The deletes check only that the rows exist before gating, so a summary is not proof you may delete: the confirmed call can still be `forbidden`.
8. **Ungated but consequential: ask first anyway.** `renumber_cues`, `update_show` with `status: "archived"` or `settings` (replace-all), `update_department` `code` or `hidden`, `update_show_member` demotions, `remove_version` on a version with siblings (permanent), `revert_change` with `force`, and `upload_document` with `documentId` (re-anchors every mark on the document, other members' personal notes included, and switches the current version). Table in [references/safety.md](references/safety.md#ungated-but-consequential).
9. **Keep the user's numbers and labels.** Do not renumber or rename to taste; `renumber_cues` only on request, and tell them it changes every printed number.
10. **Anchor to words, not coordinates.** `place_cue_at_text` makes a text anchor that follows the line through revisions; a coordinate anchor (`create_cue` / `update_cue` with `anchor`) has no trigger words, prints as a tick, and only keeps page and position. Prefer distinctive quotes (character name plus a few words) that sit on one printed line: `search_script` finds nothing across a line wrap, and `place_cue_at_text` anchors a wrapped quote on its first word's line. Repeated lyric lines can be re-anchored to the wrong verse.
11. **Undo through the log**, never by hand: `revert_change` for one row, `revert_batch` for a call. A `conflict` on revert means someone edited since; show it and ask before `force`.
12. **Retries read first.** A write that timed out may have landed: `list_cues` for the quote before sending it again. There is no idempotency key.
13. **When a result looks wrong, stop.** Read (`get_cue`, `get_page`, `get_history {rowId}`), tell the user, and do not try variations in their binder.
14. **After a revision, check beyond the review list.** `get_reanchor_review` shows `approximate` and `unresolved` items; a cue whose line was cut while the same words survive elsewhere moves there with status `ok`. Read `compare_versions` and check cues near removed lines.

## Errors in one line

Tool errors arrive as `isError: true` with text `<code>: <message>`: `forbidden` (role, scope, archived, layer), `not_found` (missing, not your show, someone else's personal item), `invalid` (bad value, bad combination, quote not matching rules), `conflict` (state, revert drift, duplicate code), and from `upload_document` `payload_too_large` (download over 200 MB). Schema failures read `Input validation error: …`; a gated call reads `CONFIRMATION_REQUIRED: …`. Do not retry an error unchanged, except the ones that say "try again" (a version still processing: poll `get_document` first; a re-anchor race: once). Full table: [references/errors-and-limits.md](references/errors-and-limits.md).

## Map of the references

| Read | When |
|---|---|
| [references/tools.md](references/tools.md) | You need a tool's exact parameters, result shape, role, gate or error texts. Every tool and resource. |
| [references/data-model.md](references/data-model.md) | Shows, members and roles, departments and layers, the personal layer, documents and versions, anchors, cues, annotations, the change log, archived shows, web versus MCP. |
| [references/reading-scripts.md](references/reading-scripts.md) | Pages, words, the coordinate system, search, text versus positional anchors, scans and OCR. |
| [references/placing-cues.md](references/placing-cues.md) | **The main how-to**: department and type, trigger words, numbering and inserting, labels and notes, batching and retries, how a cue prints, verifying. |
| [references/annotations.md](references/annotations.md) | Notes, shapes, arrows, stamps, highlights, layers and who can edit what. |
| [references/revisions-and-history.md](references/revisions-and-history.md) | Uploading a revision, re-anchoring, the review list, compare, history, activity, attribution, revert and its limits. |
| [references/exports-and-print.md](references/exports-and-print.md) | Marked-script PDF options, cue sheets, export records, reading files, size limits. |
| [references/documents-and-processing.md](references/documents-and-processing.md) | Uploads, processing, every failure code and fix, cancel, retry, remove. |
| [references/workflows.md](references/workflows.md) | Numbered recipes: cue list markup, find-then-place, CSV import, numbering audit, revision, print, undo, what changed, show setup. |
| [references/errors-and-limits.md](references/errors-and-limits.md) | Every error class and recovery, limits, timeouts, what is not possible. |
| [references/safety.md](references/safety.md) | The rules above, with the reasons and the confirm-gate script. |

## Verification

Written against `apps/api/src/mcp/*`, `apps/api/src/services/*`, `packages/core/src/*` and `packages/shared/src/*` on branch `main`, and every recipe was run against a local API with the public-domain *Pirates of Penzance* fixture (`fixtures/public/generated/pirates-short.pdf` and its revised cut). `apps/api/test/skillDocs.test.ts` fails when a tool named in these files leaves the registry or a registered tool or resource template is missing from `references/tools.md`.
