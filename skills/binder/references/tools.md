# Binder MCP tools and resources

Every tool and resource the Binder MCP server registers, with its parameters, result, role, confirm gate and errors.
Derived from `apps/api/src/mcp/tools/*.ts` and `apps/api/src/mcp/resources/*.ts`; the examples are real responses from a local instance, trimmed.

Read this when you need the exact name, parameter or result shape of a call. For how to use them together, read [workflows.md](workflows.md).

## Conventions

- Endpoint: `POST /mcp`, bearer token `Authorization: Bearer bnd_...` (see [SKILL.md](../SKILL.md)). Stateless: `GET` and `DELETE` answer `405`.
- Only the token the user supplied for this session, held by the client configuration or an environment variable the user set (`$BINDER_TOKEN` below). Never echo, log, paste or store it.
- Every successful call returns `structuredContent` (JSON): read that. Most tools also put the same JSON in one `text` content block; `get_page` instead puts a header line and the page text in its text block and adds an `image/jpeg` block; the two export tools add a `resource_link` block.
- A failed call returns `isError: true` and one text block `"<code>: <message>"`, where `code` is `forbidden`, `not_found`, `invalid` or `conflict`. A call whose arguments fail the schema returns `"Input validation error: Invalid arguments for tool <name>: <field>: <message>"`. A gated call made without `confirm: true` returns `isError: true`, text `"CONFIRMATION_REQUIRED: <summary> Call again with confirm: true to proceed."` and `structuredContent: {code: "CONFIRMATION_REQUIRED", summary}`. See [errors-and-limits.md](errors-and-limits.md).
- Ids are UUIDs (v7). Page indices are zero-based. Coordinates are PDF points, origin bottom-left, in the page's displayed (rotated) space.
- `department` arguments accept a code (`LX`, any case, trimmed) or a department id.
- Paginated list tools take `cursor` (a string of digits from the previous `nextCursor`; omit for the first page) and `limit` (1 to 200, default 50). The history tools page with `before` instead.
- Roles: `viewer` reads, `editor` writes on the department layers in their scope (default all) and on their own personal layer, `owner` does everything. Archived shows refuse every write except `update_show` setting `status` back. See [data-model.md](data-model.md).
- Annotations in the MCP sense (`readOnlyHint`, `destructiveHint`, `idempotentHint`) are listed as "Hints".

## Calling the endpoint with plain HTTP

An MCP client does this for you. Without one, `curl` works: the endpoint is stateless, so no `initialize` is needed and every request stands alone.

- Required headers: `Authorization: Bearer $BINDER_TOKEN`, `Content-Type: application/json`, and `Accept: application/json, text/event-stream` (without the `Accept` header the answer is HTTP `406`).
- The request host must be the app's own hostname (`APP_ORIGIN`), `localhost`, `127.0.0.1` or `[::1]`; anything else is refused (DNS-rebinding guard).
- The response is server-sent events: an `event: message` line, then `data: {…}` holding the JSON-RPC result. The useful part is `result.structuredContent` (or `result.content[0].text` on an error).

```bash
curl -s "$BINDER_API/mcp" \
  -H "Authorization: Bearer $BINDER_TOKEN" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_shows","arguments":{}}}'
```

```
event: message
data: {"result":{"content":[{"type":"text","text":"{\"active\":[…],\"archived\":[]}"}],"structuredContent":{"active":[…],"archived":[]}},"jsonrpc":"2.0","id":1}
```

Other methods: `tools/list`, `resources/list`, `resources/templates/list`, `resources/read` with `{"uri":"binder://…"}`.

## Shows and organisations

### `list_organisations`

Lists the organisations you belong to. Hints: read-only.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `cursor` | string | no | From the previous `nextCursor`. |
| `limit` | integer 1..200 | no | Default 50. |

Returns `{organisations: [{id, name}], nextCursor?}`. Any token: a show-scoped token still lists every organisation its user belongs to.

```json
{"organisations":[{"id":"01a146d2-b39d-7bd7-9218-efbc0fa1f344","name":"Skill Docs Agent's organisation"}]}
```

### `create_organisation`

Creates an organisation with you as its owner. Hints: write. Needs a token that is not limited to particular shows (`forbidden: token scope does not allow creating organisations or shows` otherwise).

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `name` | string 1..200 | yes | Trimmed. |

Returns the organisation row `{id, name, createdAt}`.

### `list_shows`

The shows this token reaches, active and archived, with your role. Start here. Hints: read-only.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `cursor`, `limit` | | no | Pagination over active then archived. |

Returns `{active: Show[], archived: Show[], nextCursor?}`. Each show: `id`, `title`, `status` (`prep`, `rehearsal`, `running`, `archived`), `organisationId`, `role`, `inNow` (people with the show open now: `{userId, name, departments}`; always `[]` for archived shows) and `lastChange` (`{at, userId, label, summary, sentence, count, via, agent, batchId}` or `null`).

```json
{"active":[{"id":"01a146d3-e21c-7a9e-9bd7-b2b7977b0fd6","title":"Pirates of Penzance (skill docs)","status":"prep",
  "organisationId":"01a146d2-b39d-7bd7-9218-efbc0fa1f344","role":"owner","inNow":[],
  "lastChange":{"at":"2026-10-16T22:27:48.168Z","userId":"01a146d2-…","label":"Skill Docs Agent via curl",
    "summary":"uploaded 1 document","sentence":"document uploaded","count":2,"via":"mcp","agent":"curl/8.7.1","batchId":"01a146d4-…"}}],
 "archived":[]}
```

Check `inNow` before a bulk edit: a non-empty list means a person is working in that binder right now.

### `get_show`

One show with your role and member count. Hints: read-only. Any member.

| Parameter | Type | Required |
|---|---|---|
| `showId` | string | yes |

Returns the show row plus `role` and `memberCount`: `{id, organisationId, title, status, settings, createdAt, updatedAt, updatedBy, role, memberCount}`. Errors: `not_found: Show not found` (not a member, or no such show); `forbidden: token scope does not include this show`.

### `create_show`

Creates a show with you as owner and the seven default departments. Hints: write. Unscoped tokens only.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `title` | string 1..200 | yes | |
| `organisationId` | string | no | Default: your first organisation. `invalid: You belong to no organisation; call create_organisation first` when you have none. |

Returns the show row (`status` starts as `prep`, `settings` as `{}`). The departments are always the seven defaults (`LX`, `SND`, `TM`, `VID`, `SM`, `STG`, `FLY`); there is no argument to choose others, so adjust them afterwards with `create_department` and `update_department`. Errors: `not_found: Organisation not found` (an `organisationId` you are not a member of).

### `update_show`

Changes title, status or settings. Hints: write, idempotent. Owners only. **Not confirm-gated: ask the user first** before `status: "archived"` (read-only for everyone until an owner changes it back) and before `settings` (it replaces the whole object).

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `showId` | string | yes | |
| `title` | string 1..200 | no | |
| `status` | `prep` `rehearsal` `running` `archived` | no | Archiving makes the show read-only; only an owner changing `status` back can write to it after that. |
| `settings` | object | no | Replaces **all** settings. Read `get_show` first and send the merged object. Keys the app reads: `paperSize` (`A4` or `Letter`), `stampSet` (string list), `markerSides` (`{<departmentId>: "left" | "right"}`), `connectorStyles` (`{<departmentId>: {"width": "thin" | "medium" | "bold", "pattern": "solid" | "dashed" | "dotted"}}`; each missing or invalid field falls back to its default, thin or solid). |

Returns the show row. A patch that changes nothing returns the current row and logs nothing. Errors: `forbidden: Forbidden` (not an owner), `forbidden: show is archived` (any other change to an archived show).

```json
{"id":"01a146d3-…","settings":{"stampSet":["Enter","Exit","Blackout","Fly in","Fly out","Mic swap"],"paperSize":"A4","markerSides":{"01a146d3-e223-71ae-80f9-a877475e6464":"right"}}}
```

### `add_show_member`

Adds an existing Binder user by email. Hints: write. Owners only. **Always confirm-gated.**

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `showId` | string | yes | |
| `email` | email, ≤254 | yes | Matched case-insensitively. |
| `role` | `owner` `editor` `viewer` | yes | |
| `departments` | string[] 1..200 | no | Codes or ids, or `["*"]` (default all). Only editors are limited by it. |
| `confirm` | boolean | no | |

Returns the membership `{id, showId, userId, role, departments, createdAt, updatedAt, updatedBy}` (`departments` holds ids, or `["*"]`). The owner check runs before the gate, so a non-owner gets `forbidden` and never a summary; the archived-show check runs after it, so on an archived show the confirmed call answers `forbidden: show is archived`.

Errors: `not_found: No user with that email` (there is no sign-up through MCP), `conflict: User is already a member of this show`, `invalid: unknown department: X`, `invalid: '*' cannot be combined with department ids`.

```json
{"code":"CONFIRMATION_REQUIRED","summary":"This adds nobody@local.test to the show as editor, giving them access to every document and layer they can see."}
```

### `update_show_member`

Changes a member's role or department scope. Hints: write, idempotent. Owners only. Confirm-gated when it grants or removes `owner`.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `membershipId` | string | yes | From `list_show_members`. |
| `role` | `owner` `editor` `viewer` | no | |
| `departments` | string[] 1..200 | no | Codes, ids or `["*"]`. |
| `confirm` | boolean | no | |

Returns the membership. Errors: `conflict: A show needs at least one owner` (demoting the last owner), `not_found: Membership not found` (no such id), `not_found: Show not found` (the membership's show is one you are not a member of), `forbidden: Forbidden` (not an owner). A demotion from `editor` to `viewer`, or a scope change, is **not confirm-gated: ask the user first**, since it takes access away.

```json
{"code":"CONFIRMATION_REQUIRED","summary":"This makes Scoped Editor an owner of the show, so they can change members, settings and every layer."}
```

### `remove_show_member`

Removes a member. Hints: destructive. Owners only. **Always confirm-gated.**

| Parameter | Type | Required |
|---|---|---|
| `membershipId` | string | yes |
| `confirm` | boolean | no |

Returns the removed membership row. Errors: `conflict: A show needs at least one owner`, `not_found: Membership not found` (no such id), `not_found: Show not found` (its show is not one you belong to), `forbidden: Forbidden` (not an owner).

### `list_show_members`

Members with role and scope. Hints: read-only. Any member; `email` is `null` unless you are an owner.

| Parameter | Type | Required |
|---|---|---|
| `showId` | string | yes |

Returns `{members: [{membershipId, userId, name, email, role, departments}]}`; `departments` is department ids or `["*"]`.

## Departments

### `list_departments`

A show's departments (layers), hidden ones included, in `sortOrder` then code order. Hints: read-only. Any member.

| Parameter | Type | Required |
|---|---|---|
| `showId` | string | yes |

Returns `{departments: [{id, showId, code, name, colour, numberFormat, sortOrder, hidden, createdAt, updatedAt, updatedBy}]}`. New shows start with `LX`, `SND`, `TM` (point format), `VID`, `SM`, `STG`, `FLY`.

```json
{"departments":[{"id":"01a146d3-e223-71ae-80f9-a876f368c5ec","code":"LX","name":"Lighting","colour":"#C9811F","numberFormat":"decimal","sortOrder":0,"hidden":false}, …]}
```

### `create_department`

Adds a department. Hints: write. Owners only.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `showId` | string | yes | |
| `code` | string | yes | 1 to 8 ASCII letters or digits, starting with a letter (`/^[A-Z][A-Z0-9]{0,7}$/` after trimming and upper-casing: `props` becomes `PROPS`). |
| `name` | string 1..60 | yes | |
| `colour` | `#RRGGBB` | yes | At least 3:1 mark contrast on white; outside ΔE76 20 of RVLT red. |
| `numberFormat` | `decimal` `point` | no | Default `decimal`. |

Returns the department row; `sortOrder` is the show's highest plus 10. Errors: `conflict: A department with code X already exists`, schema error on a bad code or colour, `forbidden: Forbidden`.

### `update_department`

Renames, recolours, reorders or hides a department, or changes its code or number format. New colour values require at least 3:1 mark contrast on white and must stay outside ΔE76 20 of RVLT red. Unchanged legacy colours remain valid on unrelated edits; they are never silently recoloured. Hints: write, idempotent. Owners only. Departments are never deleted: hide one and its cues stay.

| Parameter | Type | Required |
|---|---|---|
| `departmentId` | string | yes |
| `code`, `name`, `colour`, `numberFormat`, `sortOrder` (int32), `hidden` (boolean) | | no |

Returns the department row. Errors: `conflict: A department with code X already exists`, `forbidden: show is archived`, `forbidden: Forbidden`. Changing `code` renames every printed tag and cue sheet, and `hidden: true` drops the department from pickers and from `layers: "all"` exports: **not confirm-gated, ask the user first.**

## Cues

A cue is `{id, showId, departmentId, major, minor, label, type, notes, colour, anchor, payload, createdAt, updatedAt, updatedBy}` plus, in every result, `departmentCode`, `display` (the number as the department shows it) and `duplicate` (another cue in the department has the same number). `anchor` is `null` when unplaced, else `{documentId, documentVersionId, pageIndex, x, y, status, text?}` with `text: {quote, wordStart, wordEnd}` when the cue is bound to words. See [data-model.md](data-model.md).

### `list_cues`

Hints: read-only. Any member.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `showId` | string | yes | |
| `department` | code or id | no | |
| `documentId` | string | no | Only cues anchored in this document (any version). |
| `placed` | boolean | no | `true` placed only, `false` unplaced only. |
| `cursor`, `limit` | | no | |

Returns `{items: Cue[], nextCursor?}` sorted by department `sortOrder`, then code, then `(major, minor)`, then creation time.

```json
{"items":[{"id":"01a146d5-8f94-765d-a313-a98c33023402","departmentCode":"LX","display":"10","label":"Preset: house to half","type":"go","notes":"","colour":null,"duplicate":false,
  "anchor":{"documentId":"01a146d4-…","documentVersionId":"01a146d4-…","pageIndex":0,"x":89.754,"y":459.123,"status":"ok",
            "text":{"quote":"A rocky sea-shore on the coast of Cornwall","wordStart":47,"wordEnd":54}}}]}
```

### `get_cue`

Hints: read-only. Any member.

| Parameter | Type | Required |
|---|---|---|
| `cueId` | string | yes |

Returns the cue. Errors: `not_found: Cue not found` (missing, or in a show you are not a member of).

### `create_cue`

Creates a cue, placed by coordinates or unplaced. Hints: write. Editor on the department's layer. Prefer `place_cue_at_text` for a cue that should sit on a line of script: a coordinate anchor carries no trigger words (see [placing-cues.md](placing-cues.md)).

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `showId` | string | yes | |
| `department` | code or id | yes | |
| `number` | string | no | `"14"` or `"14.5"` (`14.50` is the same); major 0..9999, minor 0..99. Omit to take the next number from the department's neighbours in script order (or highest + 1 when unplaced). |
| `label` | string ≤200 | no | Default `""`. |
| `type` | `go` `standby` `warn` | no | Default `go`. |
| `notes` | string ≤10000 | no | Default `""`. |
| `colour` | `#RRGGBB` or `null` | no | `null` (default) means the department colour. |
| `anchor` | `{documentId, pageIndex, x, y, mark?, bubble?}` | no | Placed on the document's **current** version with status `ok`. `x`, `y` 0..14400 points. `mark` is `underline` (the default, not stored), `highlight`, `line` or `pointer`. A coordinate anchor binds no word, so a `line` or `pointer` is a free bar at `(x, y)` (no `text`, no offset) and an `underline` or `highlight` falls back to a tick; use `place_cue_at_text` to mark words. Add `bubble: {dx, dy}` to draw the cue's number bubble off the margin (see `update_cue`). |

Returns the cue. Errors: `invalid: unknown department: X`, `invalid: number must be a decimal like 14 or 14.5 (at most two decimals): X`, `invalid: anchor pageIndex N is beyond the P pages`, `invalid: the document has no current version`, `invalid: anchor does not point at a version of a document in this show` (a `documentId` from another show), `not_found: Document not found` (a document you cannot see), `forbidden: you cannot edit this layer`, `forbidden: show is archived`.

```json
{"id":"01a146d6-57b4-72f6-b192-3815be8762c4","departmentCode":"LX","display":"12","type":"warn","label":"Unplaced spare","anchor":null,"duplicate":false}
```

### `place_cue_at_text`

Anchors a new cue at the first word of a quoted line. Hints: write. Editor on the department's layer. **The main placement tool.**

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `showId` | string | yes | |
| `department` | code or id | yes | |
| `quote` | string 1..2000 | yes | Words of the script in reading order. Matched exactly first, then with case, punctuation and a hyphenated line end ignored (`today` matches `to-day`). Unlike `search_script`, the quote may run across a line or page break; the cue then sits on the line of the **first** quoted word. |
| `documentId` | string | no | Default: the show's first `libretto`, else its first document. |
| `occurrence` | integer ≥1 | no | Which match to use when there are several: 1-based, in script (reading) order, counting every raw match of the pass that found any (exact matches when there are exact ones, else forgiving ones; overlapping matches each count). The `ambiguous` list shows the first 20, but `occurrence` can go beyond 20. |
| `nearPageIndex` | integer ≥0 | no | With several matches: the one nearest this page (earlier wins a tie). |
| `number`, `label`, `type`, `notes` | | no | As `create_cue`. No `colour` or `anchor`. |
| `mark` | `underline` `highlight` `line` `pointer` | no | How the cue is drawn (see [placing-cues.md](placing-cues.md#how-a-cue-looks-on-the-page)). Default `underline`, which stores no `mark`. A `highlight` anchors the **whole** matched quote (up to 400 characters, cut on a word boundary) instead of its first 8 words. A `line` or `pointer` is a bar inside the quote's first word. |
| `charOffset` | integer 0..1000 | no | Only with `line` or `pointer`: characters into the quote's **first word** where the bar sits, 0 being before its first character and the word's length after its last. Default 0. Stored as `anchor.text.offset`, with `anchor.x` at that character. |

Returns one of:

- `{status: "placed", cue, match: {pageIndex, snippet}}`: the cue, anchored on the current version at the first matched word's `x` (for a `line` or `pointer`, the bar's x) and its line's centre `y`, with `anchor.text` holding the matched words (at most 8, the whole quote for a `highlight`) and their indices.
- `{status: "ambiguous", matches: [{occurrence, pageIndex, snippet}]}` (at most 20 listed): **nothing was written**. Call again with `occurrence` or `nearPageIndex`.

Errors: `not_found: The quote was not found in "<title>"`, `not_found: Document not found` (a `documentId` of another show), `invalid: occurrence N: the quote appears M times`, `invalid: "<title>" has no current version`, `invalid: "<title>" is still being processed (queued); try again shortly`, `invalid: the show has no documents to place a cue in`, `invalid: unknown department: X`, `invalid: charOffset only applies to a line or pointer mark`, `invalid: charOffset N is past the end of "word" (L characters)`, `forbidden: you cannot edit this layer`.

```json
{"status":"ambiguous","matches":[
  {"occurrence":1,"pageIndex":0,"snippet":"feet.) OPENING CHORUS ALL: Pour, O pour the pirate sherry; Fill, O fill the"},
  {"occurrence":2,"pageIndex":1,"snippet":"out of his indentures. Pour, O pour the pirate sherry; Fill, O fill the"}]}
```

```json
{"status":"placed","cue":{"id":"01a146d5-904e-7fe9-9254-58358cd33fc3","departmentCode":"SND","display":"20","type":"standby",
  "anchor":{"pageIndex":1,"x":86.696,"y":505.49,"status":"ok","text":{"quote":"Pour, O pour the pirate sherry;","wordStart":80,"wordEnd":85},"documentId":"01a146d4-…","documentVersionId":"01a146d4-…"}},
 "match":{"pageIndex":1,"snippet":"out of his indentures. Pour, O pour the pirate sherry; Fill, O fill the"}}
```

### `update_cue`

Changes any writable field. Hints: write, idempotent. Editor on the cue's layer (and on the target layer when `department` changes).

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `cueId` | string | yes | |
| `number` | string | no | As `create_cue`. |
| `label`, `type`, `notes`, `colour` | | no | |
| `department` | code or id | no | Moves the cue to another layer. |
| `anchor` | `{documentId, pageIndex, x, y, mark?, bubble?}` or `null` | no | `null` unplaces. A coordinate anchor replaces the whole anchor, **including any trigger words** (`anchor.text` is dropped) and any earlier `mark` or `tag` (the bubble goes back to the margin unless the anchor carries a `bubble`), and is placed on the current version with status `ok`. |
| `mark` | `underline` `highlight` `line` `pointer` | no | Restyles the cue where it stands: the quote and page are kept and the mark changes; `anchor.x` follows a line or pointer's character position (switching to a line moves `x` to the caret, and leaving a line keeps `x` where the caret was). Switching to `underline` removes the stored `mark`; away from `line` or `pointer` removes `text.offset`. With `anchor` too, the new anchor is applied first and `mark` on top of it; `anchor: null` with `mark`, `charOffset` or `bubble` is an error (it would unplace and restyle at once). Error on an unplaced cue. |
| `charOffset` | integer 0..1000 | no | Moves a `line` or `pointer` to this character inside the first word of the anchor's quote (clamped to the word's length; `anchor.x` follows). Applies to the mark after this call, so `{mark: "line", charOffset: 3}` works in one call. |
| `bubble` | `{dx, dy}` or `null` | no | Moves only the cue's number **bubble**, leaving the cue where it is: `dx` and `dy` are PDF points from the cue's point (`dx` right, `dy` up; each from -14400 to 14400) and are stored as `anchor.tag`. `null` puts the bubble back in the margin by removing `tag`. Without `bubble` a restyle or a charOffset keeps the bubble where it was put. With `anchor` too, the new anchor is applied first and `bubble` on top of it (the same `bubble` is also accepted inside `anchor`, as on `create_cue`). Error on an unplaced cue. A moved bubble draws on the page where it was put with one straight leader to its mark and no note, on screen and in print. |

Returns the cue. Omitted fields are unchanged; a patch that changes nothing logs nothing. Errors as `create_cue`, plus `not_found: Cue not found`, `invalid: the cue is unplaced; place it before changing its mark, charOffset or bubble`, `invalid: this call both unplaces the cue (anchor: null) and restyles it (mark, charOffset or bubble); do one or the other`, `invalid: bubble.dx must be a number from -14400 to 14400 points` (or `bubble.dy`; the schema also refuses an offset outside that range before the call runs), `invalid: charOffset needs a cue anchored to a word; this cue is not bound to any` (a coordinate-only or unbound anchor) and `invalid: charOffset only applies to a line or pointer mark`.

### `delete_cues`

Deletes cues, all or nothing. Hints: destructive. Editor on every cue's layer. **Confirm-gated when more than 10 distinct ids are given.** The gate only checks that the cues exist, so a caller without edit rights on a layer gets `CONFIRMATION_REQUIRED` first and `forbidden: you cannot edit this layer` only on the confirmed call (verified).

| Parameter | Type | Required |
|---|---|---|
| `cueIds` | string[] 1..1000 | yes |
| `confirm` | boolean | no |

Returns `{deleted: [ids]}` (duplicates in the input are collapsed). One refused or missing cue refuses the whole call.

```json
{"code":"CONFIRMATION_REQUIRED","summary":"This deletes 11 cues from VID."}
```

### `renumber_cues`

Renumbers one department's cues anchored in one document by script order. Hints: write, idempotent. Editor on the layer. One revertable batch. **Not confirm-gated: ask the user first** (it changes every number on the layer, and so every printed script and cue sheet).

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `documentId` | string | yes | |
| `departmentId` | string | one of | Give either `departmentId` alone, or `department` with `showId`. |
| `department` | code or id | one of | |
| `showId` | string | with `department` | |
| `blockSize` | integer 2..1000 | no | Default 10. |

Order: cues on the current version first (page, then top to bottom), then cues left on an older version; the first takes `blockSize`, the rest consecutive integers, minors reset to 0. Unplaced cues, cues with major 0 (line checks) and cues in other documents are untouched, and the renumbering does **not** avoid their numbers (an unplaced `12` can end up duplicated by a renumbered placed cue). Returns `{changed, flagged: [{cueId, reason: "spilled" | "overflow" | "duplicate"}]}`. `duplicate` lists every cue (renumbered or left alone: unplaced, in another document, or already in the cue list) that shares a number with a cue this renumbering governs, both sides of each collision, in the same department only, and again on a re-run that changes nothing. `spilled` and `overflow` appear only when script items group cues (not in this milestone). `flagged: []` means no collision. The result lists cue ids only, so call `list_cues` for the numbers.

Errors: `invalid: give either departmentId, or department with showId`, `invalid: department needs showId`, `not_found: Department not found`, `not_found: Document not found`.

```json
{"changed":4,"flagged":[]}
```

With a collision (an unplaced `12` and a renumbered cue that landed on `12`):

```json
{"changed":4,"flagged":[{"cueId":"01a146d5-8f94-765d-a313-a98c33023402","reason":"duplicate"},{"cueId":"01a146d6-57b4-72f6-b192-3815be8762c4","reason":"duplicate"}]}
```

## Annotations

An annotation is `{id, showId, layerKind, layerId, layer, anchor, type, geometry, text, style, createdAt, updatedAt, updatedBy}`; `layer` is the layer key (`department:<id>` or `personal:<userId>`). Types: `note`, `rect`, `ellipse`, `line`, `arrow`, `stamp`, `highlight`. See [annotations.md](annotations.md).

Layer arguments accept `personal` (your own layer), a department code or id, or a layer key.

### `list_annotations`

Every department layer plus your own personal layer, oldest first; nobody else's personal layer is ever included. Hints: read-only. Any member.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `showId` | string | yes | |
| `layer` | layer ref | no | Another user's personal key is `not_found: Layer not found`. |
| `documentId` | string | no | |
| `cursor`, `limit` | | no | |

Returns `{items: Annotation[], nextCursor?}`.

### `get_annotation`

Hints: read-only. Any member. Another user's personal annotation is `not_found: Annotation not found`, exactly like a missing id.

| Parameter | Type | Required |
|---|---|---|
| `annotationId` | string | yes |

### `create_annotation`

Hints: write. Your personal layer, or a department layer you can edit.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `showId` | string | yes | |
| `layer` | layer ref | yes | |
| `type` | annotation type | yes | |
| `anchor` | `{documentId, pageIndex, x, y, text?}` | yes | On the current version. `text: {quote (1..400), wordStart, wordEnd}` is required for a `highlight` (inclusive word indices on that page, from `get_page` or `search_script`). |
| `geometry` | object | for shapes | `rect`/`ellipse`: `{w, h}` both > 0 (anchor is the bottom-left corner). `line`/`arrow`: `{dx, dy}` not both 0 (anchor is the start). Others: `{}`. |
| `text` | string ≤2000 | for note, stamp | A `note` needs text; a `stamp` 1 to 40 characters (the show's `stampSet` lists the usual choices). |
| `style` | object | no | `{colour: #RRGGBB, strokeWidth: 0.5..12, fontSize: 6..72}`, each optional. |

Returns the annotation. Errors: `invalid: text: a note needs text`, `invalid: text: a stamp needs 1 to 40 characters`, `invalid: anchor: a highlight needs anchor text`, `invalid: geometry.w: Invalid input: expected number, received undefined; …`, `invalid: anchor pageIndex N is beyond the P pages`, `forbidden: a personal annotation goes on your own personal layer`, `forbidden: you cannot edit this layer`.

```json
{"id":"01a146d6-58dd-797e-93cc-993a029a71f2","layer":"department:01a146d3-e223-71ae-80f9-a876f368c5ec","type":"note","text":"Check followspot pickup here",
 "anchor":{"documentId":"01a146d4-…","documentVersionId":"01a146d4-…","pageIndex":0,"x":300,"y":470,"status":"ok"},"geometry":{},"style":{}}
```

### `update_annotation`

Hints: write, idempotent. Editor on the current layer, and on the target layer when `layer` changes.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `annotationId` | string | yes | |
| `layer` | layer ref | no | Personal to department is allowed (sharing). Department to personal is refused: `invalid: Copy it to your personal layer instead.` |
| `type`, `geometry`, `text`, `style` | | no | The merged row must still be valid (a `rect` keeps `w` and `h`). |
| `anchor` | `{documentId, pageIndex, x, y, text?}` | no | A moved highlight keeps its bound words unless `text` names new ones. |

Returns the annotation.

### `delete_annotations`

All or nothing. Hints: destructive. **Confirm-gated when more than 10 distinct ids are given.** As with `delete_cues`, the gate runs before the layer-rights check.

| Parameter | Type | Required |
|---|---|---|
| `annotationIds` | string[] 1..1000 | yes |
| `confirm` | boolean | no |

Returns `{deleted: [ids]}`. The gate's summary names the layers, for example `This deletes 12 annotations from LX, your personal layer.`

## Documents and processing

Document summary: `{id, showId, title, kind, currentVersionId, sortOrder, ocrMode, snapToText}`. Version summary: `{id, versionNumber, label, status, pageCount, uploadedAt, error, failureCode, failureMessage, originalSizeBytes}`; `status` is `queued`, `processing`, `ready` or `failed`. See [documents-and-processing.md](documents-and-processing.md).

### `list_documents`

Hints: read-only. Any member.

| Parameter | Type | Required |
|---|---|---|
| `showId` | string | yes |
| `cursor`, `limit` | | no |

Returns `{documents: [{…document, versions: [version summary, oldest first]}], nextCursor?}` in display order.

```json
{"documents":[{"id":"01a146d4-1b45-7a9a-91f1-8b4242b4fc61","title":"Pirates libretto","kind":"libretto","currentVersionId":"01a146d8-a21b-780e-a484-d4fde54749e0","sortOrder":0,"ocrMode":"auto","snapToText":true,
  "versions":[{"id":"01a146d4-1b45-7a9a-91f1-8b4345cda4b4","versionNumber":1,"label":null,"status":"ready","pageCount":3,"failureCode":null,"failureMessage":null,"originalSizeBytes":7094},
              {"id":"01a146d8-a21b-780e-a484-d4fde54749e0","versionNumber":2,"label":"Rehearsal cut 2","status":"ready","pageCount":3,"failureCode":null,"failureMessage":null,"originalSizeBytes":7442}]}]}
```

### `get_document`

A document, all its versions, and one version's pages. Hints: read-only. Any member.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `documentId` | string | yes | |
| `versionId` | string | no | Default: the current version (else the latest). |

Returns `{document, versions, version: {…version summary, pages: [{index, width, height, status, ocrApplied}]}}`. Use it for the page count before `get_page`. Errors: `not_found: Document not found`, `not_found: Version not found` (a `versionId` of another document).

### `update_document`

Hints: write, idempotent. Editors and owners.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `documentId` | string | yes | |
| `title` | string 1..200 | no | |
| `kind` | `libretto` `score` `blocking` `other` | no | |
| `ocrMode` | `auto` `never` | no | Used by future uploads to this document. |
| `snapToText` | boolean or `null` | no | `null` restores the kind default (on for libretto and other). Only the web app snaps; MCP coordinate anchors never do. |
| `sortOrder` | int32 | no | |

Returns the document summary.

### `upload_document`

The server downloads a PDF from a public http(s) URL. Hints: write, open-world. Editors and owners on an unarchived show.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `showId` | string | yes | |
| `url` | string | yes | http or https only; no credentials in the URL; no private, loopback, link-local, CGNAT, multicast or reserved address (checked at connect time and after every redirect). At most 200 MB, 60 s. |
| `documentId` | string | no | Add the next version to this document instead of creating one. |
| `kind` | document kind | for a new document | |
| `title` | string 1..200 | no | New document only; default: the file name from the URL. |
| `label` | string 1..200 | no | New version only; default: the file name. |
| `ocrMode` | `auto` `never` | no | New document only. |

Returns `{document, version}` with the version `queued`; poll `get_document` until `ready` or `failed`.

**Side effect of `documentId`: not confirm-gated, ask the user first.** Once the new version is `ready` the server re-anchors **every** cue and annotation on the document, other members' personal annotations included, and switches the document's current version to it ([revisions-and-history.md](revisions-and-history.md)). Say so before uploading a revision.

Errors: `invalid: Not a valid URL`, `invalid: Only http and https URLs can be fetched`, `invalid: URLs with credentials are not accepted`, `invalid: URL resolves to a private or reserved address`, `invalid: Download failed with HTTP N`, `invalid: Download failed (ECONNREFUSED)` and similar, `invalid: Too many redirects`, `payload_too_large: Download exceeds 200 MB`, `invalid: File is not a PDF`, `invalid: kind is required for a new document`, `invalid: kind, title and ocrMode apply only to a new document; use update_document`, `invalid: label applies only to a new version of a document`, `forbidden: show is archived`, `forbidden: Forbidden` (viewer).

For a file on the user's machine, the REST upload takes the same bearer token (see "Calling the endpoint with plain HTTP" above for how to hold it). New document: `kind` and `title` required, `ocrMode` optional; `snapToText` is **not** accepted and is silently dropped, so set it with `update_document` afterwards. New version: `label` required. Both answer `201` with the rows.

```bash
curl -F kind=libretto -F title="Pirates libretto" -F ocrMode=auto -F file=@script.pdf \
  -H "Authorization: Bearer $BINDER_TOKEN" "$BINDER_API/api/shows/$SHOW/documents"
curl -F label="Rehearsal cut 2" -F file=@script.pdf \
  -H "Authorization: Bearer $BINDER_TOKEN" "$BINDER_API/api/shows/$SHOW/documents/$DOC/versions"
```

### `cancel_version_processing`

Stops a version still `queued` or `processing`: it becomes `failed` with `failureCode: "cancelled"` and keeps its file. Hints: write, idempotent. Editors and owners.

| Parameter | Type | Required |
|---|---|---|
| `versionId` | string | yes |

Returns the version summary. Cancelling an already cancelled version returns it unchanged. Errors: `conflict: This upload has already finished` (ready), `conflict: This upload is not processing` (failed for another reason).

### `retry_version`

Runs a failed version again from the stored file. Hints: write. Editors and owners.

| Parameter | Type | Required |
|---|---|---|
| `versionId` | string | yes |

Returns the version summary with `status: "queued"`. Only the document's newest version can be retried. The job reads the document's **current** `ocrMode` and `snapToText` when it runs, so a `no_text` or `low_resolution` failure can be rescued without a re-upload: `update_document {documentId, snapToText: false}` (keep OCR, drop the text requirement) or `{ocrMode: "never"}` (skip OCR), then `retry_version` (verified: both came up `ready`). `unreadable` and `password_protected` fail the same way again: upload a corrected file. Errors: `conflict: This upload has already finished`, `conflict: This upload is still being processed`, `conflict: A newer version exists; upload again or remove this one`, `conflict: The uploaded file is no longer stored; upload it again`.

### `remove_version`

Permanently removes a **failed** version and its files; the document too when it was the only version. Hints: destructive. Editors and owners. **Confirm-gated when the document would go with it**; removing a failed version that has siblings is permanent too but ungated: ask the user first. Cannot be reverted.

| Parameter | Type | Required |
|---|---|---|
| `versionId` | string | yes |
| `confirm` | boolean | no |

Returns `{removed: {versionId, documentId, documentRemoved}}`. When a removed version was current and others remain, the highest ready version becomes current (or none). Errors: `conflict: Only a failed upload can be removed`, `conflict: This upload is still being processed; cancel it first`, `conflict: Cues or annotations are anchored to this version`.

```json
{"code":"CONFIRMATION_REQUIRED","summary":"This is the only version of \"Textless page\", so removing it deletes the whole document and its stored file permanently."}
```

## Pages and search

### `get_page`

One page: its text, word boxes and (by default) a JPEG. Hints: read-only. Any member.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `versionId` | string | yes | A document **version** id, not a document id. |
| `index` | integer ≥0 | yes | Zero-based. |
| `includeImage` | boolean | no | Default `true`. |
| `maxPx` | integer 100..1600 | no | Long side of the JPEG; default and cache size 1600. |

Content: a text block (`Page 0 of version …: 595.28 x 841.89 pt, status ready, 197 words.` then the page text) and, with the image, an `image/jpeg` block. `structuredContent`: `{versionId, index, width, height, rotation, status, ocrApplied, image: {width, height} | null, text, words: [[text, x, y, w, h], …], lines: [[wordIndex, …], …]}`. Boxes are PDF points rounded to 0.1, origin bottom-left; `y` is the bottom of the word box. A page that is not ready, or a scan processed with `ocrMode: "never"`, has `words: []` and `text: ""`.

Errors: `not_found: Page not found` (index past the end), `not_found: Version not found`, `conflict: This version is still being processed; try again shortly` (image requested before the searchable PDF exists). A 200-word page is about 9 KB of structured JSON (roughly 2,500 tokens) plus the image; pass `includeImage: false` when you only need the words.

```json
{"versionId":"01a146d4-1b45-7a9a-91f1-8b4345cda4b4","index":0,"width":595.28,"height":841.89,"rotation":0,"status":"ready","ocrApplied":false,"image":null,
 "text":"THE PIRATES OF PENZANCE\nOR\nTHE SLAVE OF DUTY\nDRAMATIS PERSONAE\n…",
 "words":[["THE",50,778.6,22,10.2],["PIRATES",75.1,778.6,47.1,10.2],["OF",125.2,778.6,15.3,10.2],["PENZANCE",143.5,778.6,59.9,10.2],["OR",56.1,763.2,16.5,10.2],…],
 "lines":[[0,1,2,3],[4],[5,6,7,8],…]}
```

### `search_script`

Phrase search over a version's ready pages. Hints: read-only. Any member.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `versionId` | string | yes | |
| `query` | string 1..500 | yes | Words matched in order within one line, ignoring case, diacritics and edge punctuation (inner apostrophes and hyphens stay, so `to-day` does not match `today`; `place_cue_at_text` is more forgiving). |
| `limit` | integer 1..200 | no | Default 50. |

Returns `{hits: [{pageIndex, lineIndex, wordStart, wordEnd, snippet, box: {x, y, w, h}}]}` in page then reading order; `wordStart`/`wordEnd` index that page's `words`, `box` is the first word's box.

```json
{"hits":[{"lineIndex":0,"wordStart":1,"wordEnd":1,"pageIndex":0,"snippet":"THE PIRATES OF PENZANCE","box":{"x":75.058,"y":778.613,"w":47.069,"h":10.175}},
         {"lineIndex":10,"wordStart":39,"wordEnd":39,"pageIndex":0,"snippet":"Chorus of Pirates, Police, and General Stanley's","box":{"x":106.859,"y":500.404,"w":37.29,"h":10.175}}]}
```

## History and revert

See [revisions-and-history.md](revisions-and-history.md). Both read tools take `layer` (a code, id, `personal` or a layer key), `kind` (`human`, `agent`, `all`; `agent` means the row has an `agent`, which includes the server's re-anchoring run), `from` and `to` (ISO 8601, inclusive), `before` (the previous `nextBefore`) and `limit` (1..200, default 50).

### `get_history`

The change log, newest first. Hints: read-only. Any member; other people's personal layers are never included.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `showId` | string | yes | |
| `rowId` | string | no | One cue, annotation, department, document or show. |
| `table` | string | no | `cues`, `annotations`, `departments`, `documents`, `document_versions`, `shows`, `show_memberships`. |
| `userId` | string | no | |
| `layer`, `kind`, `from`, `to`, `before`, `limit` | | no | A `layer` filter also returns the rows of cues that left that department. |

Returns `{entries: [{seq, serverTs, clientTs, userId, userName, via, agent, batchId, table, rowId, op, before, after, layer}], nextBefore}`; `before`/`after` hold only the changed columns (`null` for the missing side of an insert or delete). Errors: schema error on a non-ISO date, `invalid: layer must be department:<id> or personal:<userId>` for a malformed key.

```json
{"seq":115607,"serverTs":"2026-10-16T22:31:30.711Z","userName":"Skill Docs Agent","via":"mcp","agent":"skill-docs-agent/1.0","batchId":"01a146d7-8096-…","table":"cues","op":"update",
 "before":{"label":"Build on pirates","notes":"Slow 8 count build"},"after":{"label":"Build on pirates (entrance)","notes":"Slow 8 count build; hold until King speaks"},"layer":"department:01a146d3-…"}
```

### `get_activity`

The same log as one line per batch. Hints: read-only. Any member.

| Parameter | Type | Required |
|---|---|---|
| `showId` | string | yes |
| `layer`, `kind`, `from`, `to`, `before`, `limit` | | no |

Returns `{groups: [{batchId, userId, label, summary, at, fromSeq, toSeq, count, via, agent}], nextBefore}`; `limit` counts groups. `label` reads `Jayden` or `Jayden via Claude Code`.

```json
{"groups":[{"batchId":"01a146d7-83a0-73ac-b507-cb9a71c62d7d","userId":"01a146d2-…","label":"Skill Docs Agent via skill-docs-agent","summary":"deleted 11 VID cues","at":"2026-10-16T22:31:31.488Z","fromSeq":115626,"toSeq":115636,"count":11,"via":"mcp","agent":"skill-docs-agent/1.0"}],"nextBefore":115625}
```

### `revert_change`

Writes one log row's old values back as a new logged change. Hints: write, destructive. Rights are the owning service's: edit rights on the layer for cues and annotations, editor for documents, owner for departments and shows. The rights check runs before any conflict check, so a caller without rights gets `forbidden: you cannot edit this layer` (or `forbidden: Forbidden`) and never learns whether the row changed. `force: true` is **not confirm-gated: ask the user first**, since it overwrites someone's later edit.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `seq` | integer ≥1 | yes | |
| `force` | boolean | no | Overwrite columns that changed since. |

Returns `{batchId, reverted, skipped: [{seq, reason: "row-gone" | "already-reverted"}]}`. Inserts and deletes can be reverted for cues and annotations only; departments, documents and shows allow updates only. Reverting the same `seq` twice (verified): an update is `conflict … has changed since` unless `force`, with which it is skipped as `already-reverted`; an insert is skipped `already-reverted` without `force`; a delete is `conflict … row exists again` unless `force`. Errors: `conflict: cues <id> has changed since (label, notes); revert with force to overwrite`, `conflict: cues <id>: row exists again`, `invalid: a insert on departments cannot be reverted`, `invalid: the current version can only be reverted together with its whole batch`, `not_found: Change not found`.

### `revert_batch`

Reverts every row one user wrote in one batch, newest first, all or nothing. Hints: write, destructive. **Confirm-gated when it would change or delete more than 10 rows.**

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `showId` | string | yes | |
| `batchId` | string | yes | From `get_activity`. |
| `userId` | string | yes | The batch's user, from `get_activity`. |
| `force` | boolean | no | |
| `confirm` | boolean | no | |

Returns `{batchId, reverted, skipped, rows, deletes}`. A re-anchoring run (`batchId` `reanchor:<versionId>`) is reverted as one document operation by any editor. The gate is decided by a dry run that does all the work and rolls it back, so `forbidden` and `conflict` surface **before** any `CONFIRMATION_REQUIRED`, rights first. Errors as `revert_change`, plus `not_found: Batch not found`.

```json
{"code":"CONFIRMATION_REQUIRED","summary":"Reverting this batch changes 11 rows and deletes 0."}
```

## Exports

See [exports-and-print.md](exports-and-print.md). An export record is `{id, showId, kind, filename, layerSelection: [{kind, id}], privateTo, options, fileKey, createdBy, createdAt, …}`; `kind` is `pdf-script`, `pdf-sheet`, `csv` or `xlsx`.

### `list_exports`

Newest first. Hints: read-only. Any member; exports private to someone else are never listed.

| Parameter | Type | Required |
|---|---|---|
| `showId` | string | yes |
| `cursor`, `limit` | | no |

Returns `{items: ExportRecord[], nextCursor?}`.

### `export_marked_script`

Prints a document version with chosen layers to a PDF. Hints: write. Any member (viewers too); works on archived shows.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `documentId` | string | yes | |
| `versionId` | string | no | Default: current version. Needs a searchable PDF (normally `ready`): otherwise `invalid: the version has no searchable PDF yet (status: queued)`. |
| `layers` | `"all"`, `"none"` or string[] ≤200 | yes | `all`: every non-hidden department, no personal layer. `none`: clean copy. List: codes, ids, `personal` (your own), or layer keys. |
| `pages` | string ≤200 | no | `"all"` or `"1-5, 8"` (1-based; hyphen, en or em dash). Past the end is an error. |
| `paper` | `A4` `Letter` | no | Fit every page to this paper. Omit to keep page sizes. |
| `includeStandbyWarn` | boolean | no | Default `true`. |
| `includeAnnotations` | boolean | no | Default `true`. |
| `includeCueNotes` | boolean | no | Default `true`: each cue's note prints under its tag. |
| `filename` | string ≤200 | no | With or without `.pdf`. Default: `<show>-<document>-v<n>-<layers>.pdf` slug. |

Returns `{record, uri}` plus a `resource_link` block `{uri, name, mimeType: "application/pdf"}`. Including `personal` sets `privateTo` to you. Errors: `invalid: This script has 3 pages.`, `invalid: pages look like 1-43 or 3, 7-9`, `invalid: File names can't contain / \ : * ? " < > |`, `invalid: unknown department: X`, `invalid: the version has no searchable PDF yet (status: queued)`, `forbidden: an export can only include your own personal layer`.

```json
{"record":{"id":"01a146d7-8673-7a3b-9921-c2503abc8f67","kind":"pdf-script","filename":"pirates-of-penzance-skill-docs-pirates-libretto-v1-LX.pdf",
  "layerSelection":[{"id":"01a146d3-e223-71ae-80f9-a876f368c5ec","kind":"department"}],"privateTo":null,
  "options":{"pages":"1-2","includeCueNotes":true,"includeAnnotations":true,"includeStandbyWarn":true}},
 "uri":"binder://shows/01a146d3-e21c-7a9e-9bd7-b2b7977b0fd6/exports/01a146d7-8673-7a3b-9921-c2503abc8f67"}
```

### `export_cue_list`

A department's cue sheet. Hints: write. Any member; works on archived shows.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `format` | `pdf` `xlsx` `csv` | yes | |
| `department` | code or id | one of | Needs `showId`. |
| `departmentId` | string | one of | Alone. |
| `showId` | string | with `department` | |

Columns `Cue, Type, Label, Page, Document, Trigger, Notes, Status`, in cue-number order with unplaced cues last. Returns `{record, uri}` plus a `resource_link`; the file is named `<show> - <CODE> cue sheet.<ext>`. Errors: `invalid: give either department or departmentId`, `invalid: showId is required with a department code`, `not_found: Department not found`; a bad `format` is a schema error (`Input validation error`), never the service's `format must be pdf, xlsx or csv`.

## Revisions

See [revisions-and-history.md](revisions-and-history.md).

### `get_reanchor_review`

What a revision left to review for a document. Hints: read-only. Any member.

| Parameter | Type | Required |
|---|---|---|
| `documentId` | string | yes |

Returns `{currentVersionId, pending: ReviewItem[], olderVersions: ReviewItem[]}`; each item is `{table: "cues" | "annotations", rowId, layer, title, anchor, previous}`. `pending`: on the current version with status `approximate` or `unresolved`. `olderVersions`: still anchored to another version. `previous` is the anchor before the latest re-anchoring run moved the row, or `null`.

```json
{"currentVersionId":"01a146d8-a21b-…","pending":[{"table":"cues","rowId":"01a146d5-9075-…","layer":"department:01a146d3-e223-…","title":"SND 10 · King enters",
  "anchor":{"pageIndex":1,"x":101.359,"y":397.299,"status":"approximate","text":{"quote":"Yes, Frederic, from to-day you rank","wordStart":-1,"wordEnd":-1},"documentVersionId":"01a146d8-…","documentId":"01a146d4-…"},
  "previous":{"pageIndex":1,"x":101.359,"y":397.299,"status":"ok","text":{"quote":"Yes, Frederic, from to-day you rank","wordStart":115,"wordEnd":120},"documentVersionId":"01a146d4-…","documentId":"01a146d4-…"}}],
 "olderVersions":[]}
```

### `resolve_reanchor_item`

Resolves one review item as an ordinary logged edit. Hints: write. Edit rights on the item's layer.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `table` | `cues` `annotations` | yes | |
| `rowId` | string | yes | |
| `action` | `accept` `revert` `reanchor` | yes | `accept`: status `ok` where it is (must be on the current version). `revert`: put back `previous`. `reanchor`: match again from its version to the current one (a no-op on the current version). |

Returns `{anchor}`. Errors: `invalid: Re-anchor or move it to the current version first`, `invalid: nothing to revert to: no re-anchoring run moved this item`, `invalid: this cue is not placed, so it has no anchor to resolve`, `invalid: this document has no current version`, `conflict: this item changed while it was being re-anchored; try again`.

### `get_version_anchors`

Every cue and annotation that was on a version, with the anchor it had there. Hints: read-only. Any member.

| Parameter | Type | Required |
|---|---|---|
| `versionId` | string | yes |

Returns `{anchors: [{table, rowId, layer, anchor}]}` grouped by layer then reading order.

### `compare_versions`

A line diff of two versions of one document. Hints: read-only. Any member.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `fromVersionId` | string | yes | |
| `toVersionId` | string | yes | |
| `limit` | integer 1..10000 | no | Default 2000; counts changed entries only. |
| `context` | integer 0..20 | no | Default 2 unchanged lines either side of each kept change. |

Returns `{entries: [{op: "same" | "added" | "removed", text, old?: {pageIndex, lineIndex}, new?}], added, removed, truncated}`. Lines are compared by their normalised words, so case and punctuation changes are not differences. Errors: `invalid: the versions belong to different documents`, `invalid: Too many changes to compare line by line.` (more than 4000 differing lines).

```json
{"added":17,"removed":15,"truncated":false,"entries":[{"op":"same","text":"Fred'ric's out of his indentures.","old":{"pageIndex":1,"lineIndex":8},"new":{"pageIndex":1,"lineIndex":8}},
  {"op":"removed","text":"SAMUEL: Two and twenty, now he's rising,","old":{"pageIndex":1,"lineIndex":9}}, …]}
```

## Resources

Read with `resources/read`; list the fixed ones with `resources/list` and the templates with `resources/templates/list`. A missing or invisible resource is a JSON-RPC error (`code: -32602`, message `No such guide`, `Export not found`, `Page not found`, `Version not found`).

| URI template | Content | Notes |
|---|---|---|
| `binder://shows/{showId}/versions/{versionId}/pages/{index}/words` | `application/json` text: `{width, height, status, text, words, lines}` | The same compact word layer as `get_page`. `showId` must be the version's show. |
| `binder://shows/{showId}/versions/{versionId}/pages/{index}/image` | `image/jpeg` blob (base64) | The 1600 px render. |
| `binder://shows/{showId}/exports/{exportId}` | blob (base64) with the record's MIME type (`application/pdf`, `text/csv`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) | An export private to another member is not found. |
| `binder://guides/{slug}` | `text/markdown` | Listed: `jayden-style`, `mic-and-dca-practice`, `tmix-format`. House rules for cue style, mics and DCAs, and the TheatreMix `.tmix` format. |
| `binder://skill/{slug}` | `text/markdown` | Listed: `index` (this skill's `SKILL.md`) and one slug per file in `references/` (`tools`, `placing-cues`, …). Relative links between the files are rewritten to `binder://skill/…` resources so they can be followed. |

```json
{"uri":"binder://shows/01a146d3-…/exports/01a146d7-8761-…","mimeType":"text/csv","blob":"77u/Q3VlLFR5cGUs…"}
```

Decoded, that CSV starts with a byte order mark: `Cue,Type,Label,Page,Document,Trigger,Notes,Status` then one CRLF-terminated row per cue.
