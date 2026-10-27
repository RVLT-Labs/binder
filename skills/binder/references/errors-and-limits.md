# Errors and limits

Every error class the tools return, what it means and how to recover; the numeric limits; what is not possible.
Derived from `apps/api/src/errors.ts`, `apps/api/src/mcp/results.ts`, `confirm.ts`, `auth.ts`, the tool schemas, `packages/shared/src/markupSchemas.ts`, `apps/api/src/app.ts`, `upload/fetchPdf.ts`.

Read this when a call fails, before retrying anything, and when deciding whether a request is possible at all.

## How errors arrive

| Where | Shape | Example |
|---|---|---|
| HTTP, before MCP | `401` with `WWW-Authenticate: Bearer realm="binder"` (no token) or `…, error="invalid_token"` (bad, revoked or expired token); body `{"error":"unauthenticated","message":"A valid personal access token is required"}` | Missing or wrong `Authorization` header |
| HTTP | `405` | `GET` or `DELETE /mcp` |
| HTTP | `406` | `POST /mcp` without `Accept: application/json, text/event-stream` |
| HTTP | `403` with JSON-RPC error `{"code":-32000,"message":"Invalid Host: <host>"}` | The request's `Host` (or `Origin`, when sent) is not the app's hostname (`APP_ORIGIN`), `localhost`, `127.0.0.1` or `[::1]` (DNS-rebinding guard) |
| HTTP | `413` | JSON body over 2 MB |
| Tool result | `isError: true`, text `"<code>: <message>"` | `not_found: Cue not found` |
| Tool result | `isError: true`, text `"Input validation error: Invalid arguments for tool <name>: <field>: <message>"` | a value outside the schema |
| Tool result | `isError: true`, text `"CONFIRMATION_REQUIRED: <summary> Call again with confirm: true to proceed."`, `structuredContent: {code: "CONFIRMATION_REQUIRED", summary}` | a gated call without `confirm` |
| Tool result | `isError: true`, text `"internal: Internal server error"` | an unexpected server failure; details are only in the server log |
| Resource read | JSON-RPC error `{code: -32602, message, data: {uri}}` | `No such guide`, `Export not found`, `Page not found`, `Version not found`; other service errors as `"<code>: <message>"`; `-32603` for internal |

Tool errors never carry a stack trace or the row of another show. The full code list in `apps/api/src/errors.ts` is `unauthenticated`, `forbidden`, `not_found`, `invalid`, `conflict`, `payload_too_large`, `unsupported_media_type`. Through MCP you meet `forbidden`, `not_found`, `invalid`, `conflict` and, from `upload_document` and `begin_document_upload`, `payload_too_large` (`Download exceeds 200 MB`, `Upload exceeds 200 MB`); `unauthenticated` is the HTTP 401 and `unsupported_media_type` is REST-only. The REST routes use the same codes as HTTP statuses (`401`, `403`, `404`, `400`, `409`, `413`, `415`).

## Recovery by code

| Code | Meaning | What to do |
|---|---|---|
| `unauthenticated` (HTTP 401) | No valid token on the request. | Stop. Ask the user to check the token in the client configuration. Never ask them to paste a token into the chat. |
| `forbidden: token scope does not include this show` | The token is scoped to other shows. | The user needs a token with that show in scope, or `*`. You cannot widen it. |
| `forbidden: token scope does not allow creating organisations or shows` | Scoped token on `create_show` / `create_organisation`. | Same. |
| `forbidden: Forbidden` | Role too low (owner-only tool, or editor-only upload/control as a viewer; also a revert of a department or show edit as a non-owner, or of a document edit as a viewer). | Tell the user what role is needed; do not retry. |
| `forbidden: you cannot edit this layer` | Editor outside their department scope, viewer on a department layer, a move into a layer you cannot edit, or a revert of a row on such a layer. | Report which layer; an owner can widen the scope with `update_show_member`. |
| `forbidden: show is archived` | Every write on an archived show. | Only an owner can unarchive with `update_show {status}`; ask before doing that. |
| `forbidden: a personal annotation goes on your own personal layer` | You named someone else's personal layer. | Use `personal`. |
| `forbidden: an export can only include your own personal layer` | Same, in `layers`. | Drop it. |
| `not_found: …` | The id does not exist, is in a show you are not a member of, is another member's personal annotation or private export, or the email has no account. | Check the id came from a list call on this show; do not guess ids. For `No user with that email`, the person must sign up first. |
| `not_found: The quote was not found in "<title>"` | `place_cue_at_text` found no match, even forgiving. | Quote fewer, more distinctive words from the page text; check the document is the right one; read the page. |
| `invalid: unknown department: X` | No such code or id in that show. | `list_departments` and use a real code. |
| `invalid: number must be a decimal like 14 or 14.5 (at most two decimals): X` | Bad cue number text. | Reformat (`"14.25"`, not `"14.253"` or `"14,5"`). |
| `invalid: anchor pageIndex N is beyond the P pages` | Page out of range. | `get_document` for the count; pages are zero-based. |
| `invalid: occurrence N: the quote appears M times` | Occurrence past the list. | Use one from the `ambiguous` response. |
| `invalid: "<title>" is still being processed (queued); try again shortly` | The current version is not ready. | Poll `get_document`. |
| `invalid: give either departmentId, or department with showId` and friends | Argument combination. | Follow the message. |
| `invalid: This script has N pages.` / `pages look like 1-43 or 3, 7-9` | Bad page range. | Fix the range. |
| `invalid: File names can't contain / \ : * ? " < > \|` and the other file-name texts | Bad `filename`. | Use letters, digits, spaces, hyphens. |
| `invalid: Copy it to your personal layer instead.` | Moving a department annotation to personal. | Create a copy on `personal` instead. |
| `invalid: a <op> on <table> cannot be reverted` | Revert of a lifecycle event. | Explain; cannot be undone through tools. |
| `invalid: text: a note needs text`, `a stamp needs 1 to 40 characters`, `anchor: a highlight needs anchor text`, `geometry.w: …` | Annotation rules. | Fix the fields ([annotations.md](annotations.md)). |
| `invalid: Too many changes to compare line by line.` | More than 4000 differing lines. | Read pages or compare smaller uploads. |
| `invalid: URL resolves to a private or reserved address`, `Only http and https URLs can be fetched`, `URLs with credentials are not accepted`, `Not a valid URL`, `Download failed with HTTP N`, `Too many redirects`, `File is not a PDF`; `payload_too_large: Download exceeds 200 MB` | `upload_document` refused the URL or the download. | Use a public https URL to a PDF under 200 MB; for a file on your machine (or any private script) use `begin_document_upload`. |
| `conflict: … has changed since (col, col); revert with force to overwrite` | Someone changed the row after the change you are reverting. Only callers who may edit that row are told; others get `forbidden: you cannot edit this layer`. | Show the user; only add `force: true` on their explicit say-so. |
| `conflict: <table> <id>: row exists again` | Reverting a delete whose row was recreated (including by an earlier revert). | Nothing to do; it is already back. |
| `conflict: A department with code X already exists` | Duplicate code. | Pick another, or `list_departments` for the existing one. |
| `conflict: User is already a member of this show` | `add_show_member` twice. | Use `update_show_member`. |
| `conflict: A show needs at least one owner` | Demoting or removing the last owner. | Make someone else owner first (confirm-gated). |
| `conflict: This upload has already finished`, `This upload is not processing`, `This upload is still being processed; cancel it first`, `Only a failed upload can be removed`, `A newer version exists; upload again or remove this one`, `The uploaded file is no longer stored; upload it again`, `Cues or annotations are anchored to this version` | Processing-control state rules. | Follow the message ([documents-and-processing.md](documents-and-processing.md)). |
| `conflict: This version is still being processed; try again shortly` | `get_page` asked for an image before the searchable PDF exists. | Poll, or `includeImage: false`. |
| `conflict: this item changed while it was being re-anchored; try again` | A race on `resolve_reanchor_item`. | Call again once. |
| `Input validation error: …` | Schema: wrong type, enum, range or missing field. | Read the field and limit in the message; see the limits below. |
| `CONFIRMATION_REQUIRED` | Gated call. | Show `summary` to the user verbatim, wait for a clear yes, call again with `confirm: true` and otherwise identical arguments. |
| `internal: Internal server error` | Server fault. | Retry once after a pause; if it persists, stop and tell the user to check the API log. |

Retry policy: do not retry a `forbidden`, `not_found`, `invalid` or `conflict` unchanged; they will not change by themselves. The exceptions are the time-dependent ones, which say so in their text: `invalid: "<title>" is still being processed (queued); try again shortly`, `conflict: This version is still being processed; try again shortly` (poll `get_document`, then retry), and `conflict: this item changed while it was being re-anchored; try again` (retry once). A transport failure (timeout, connection reset) on a **write** may have committed: read before retrying ([placing-cues.md](placing-cues.md#batching-and-idempotency)). Reads are safe to retry.

## The confirm gate

Seven calls change nothing and return `CONFIRMATION_REQUIRED` until `confirm: true`:

| Tool | When |
|---|---|
| `add_show_member` | always |
| `remove_show_member` | always |
| `update_show_member` | granting or removing `owner` |
| `delete_cues` | more than 10 distinct ids |
| `delete_annotations` | more than 10 distinct ids |
| `revert_batch` | the dry run would change or delete more than 10 rows |
| `remove_version` | the version is the document's only one, so the document goes too |

What runs before the gate differs by tool:

| Tool | Before the gate | After `confirm: true` |
|---|---|---|
| `add_show_member`, `update_show_member`, `remove_show_member` | owner check and membership lookup (a non-owner gets `forbidden`, never a summary) | the archived-show check (`forbidden: show is archived`), email lookup, scope validation |
| `remove_version` | version lookup, editor check, archived check | the state checks (`conflict …`) |
| `revert_batch` | a full dry run: rights (`forbidden`) first, then conflicts and `not_found`; all surface before the gate | nothing new |
| `delete_cues`, `delete_annotations` | only that every id exists and is visible | the layer-rights check, so a viewer or an out-of-scope editor is asked to confirm and then gets `forbidden: you cannot edit this layer` (verified) |

So a `CONFIRMATION_REQUIRED` from a delete is not proof the delete is allowed. `confirm` is per call: it does not carry over to the next call, and sending `confirm: true` on an ungated call is harmless.

Ungated but consequential (ask the user first; the full table is in [safety.md](safety.md#ungated-but-consequential)): `renumber_cues`, `update_show` with `status: "archived"` or `settings`, `update_department` `code` or `hidden`, `update_show_member` demotions that only change `role` or `departments`, `remove_version` on a version with siblings, `revert_change` with `force`, and `upload_document` with `documentId` (it re-anchors every mark on the document and switches the current version).

## Limits

| What | Limit |
|---|---|
| Request body | 2 MB JSON per MCP request |
| `limit` on paginated lists | 1..200, default 50; `cursor` is a digit string |
| History `limit` | 1..200, default 50; `before` ≥ 1; `from`/`to` accept any string `Date.parse` reads (prefer UTC ISO 8601 with `Z`) |
| `compare_versions` | `limit` 1..10000 (default 2000), `context` 0..20 (default 2), at most 4000 differing lines |
| `search_script` | query 1..500 chars, `limit` 1..200 (default 50), one line per hit |
| `place_cue_at_text` | quote 1..2000 chars; at most 20 matches listed when ambiguous; stored trigger at most 8 words; `occurrence` and `nearPageIndex` ≤ 100000 |
| Cue number | major 0..9999, minor 0..99; text with at most two decimals |
| Cue `label` | 200 chars; `notes` 10000 chars; `colour` `#RRGGBB` |
| Annotation `text` | 2000 chars; stamp 1..40; highlight quote 1..400; `strokeWidth` 0.5..12; `fontSize` 6..72; geometry values ≤ 14400 |
| Coordinates | `x`, `y` 0..14400 points; `pageIndex` 0..100000 |
| `delete_cues`, `delete_annotations` | 1..1000 ids; more than 10 needs `confirm` |
| `layers` list, `departments` scope | at most 200 entries |
| Department code | 1..8 letters or digits, letter first; name 60 chars |
| Titles, names, labels, filenames | 200 chars (`filename` 196 before `.pdf`) |
| Email | 254 chars |
| `get_page` image | `maxPx` 100..1600 |
| Uploads | 200 MB; URL fetch 60 s; OCR up to 30 min per version (retries included) |
| Strings | no NUL characters anywhere |

## Timeouts and timing

- There is no server-side timeout on a tool call beyond the HTTP client's. Exports of long scripts and OCR-heavy reads can take tens of seconds; set a client timeout of a few minutes for `export_marked_script`.
- Processing is asynchronous: poll `get_document`. A 147-page text libretto processes in a few minutes; a three-page one in seconds. Re-anchoring after a revision adds seconds.
- Presence (`inNow`) is live and best-effort: a person who closed the tab in the last 15 seconds may still show.

## Not possible through MCP

- **No minting tokens.** Tokens are created in the web settings page or by the CLI; there is no tool to create, list, revoke or widen one. If the token you have cannot reach a show, say so.
- **No OAuth.** Only the bearer token header.
- **No sign-up.** `add_show_member` only adds users who already exist.
- **No freehand ink.** Annotation types are note, stamp, highlight, rect, ellipse, line, arrow.
- **No deleting documents, ready versions, departments, shows, organisations or export records.** Departments are hidden instead; only failed versions can be removed.
- **No file bodies over MCP.** Local files go over REST with the same token.
- **No bulk create or transaction across calls.** One cue per call; a failed batch is undone with `delete_cues` or `revert_batch`.
- **No access to another member's personal layer**, ever, by any role.
- **No reading web-only state**: layer visibility, locks, the active layer, snap settings, or edits still queued offline on someone's device.
- **No TheatreMix (`.tmix`) export yet**; the `tmix` record kind is reserved.
