# Binder data model

What the objects are, how they relate, and who may touch which.
Derived from `packages/shared/src/markup.ts`, `markupSchemas.ts`, `layers.ts`, `roles.ts`, `types.ts`, and `apps/api/src/services/tenancy.ts`, `layers.ts`, `cues.ts`, `annotations.ts`, `history.ts`.

Read this when a tool result has a field you do not recognise, or before deciding which layer, role or department a write belongs to.

## The tree

```
organisation
└── show  (status: prep | rehearsal | running | archived; settings)
    ├── show membership  (user, role: owner | editor | viewer, departments: ['*'] | [departmentId, …])
    ├── department  (code, name, colour, numberFormat, sortOrder, hidden)   = a layer
    ├── document  (kind, title, currentVersionId, ocrMode, snapToText, sortOrder)
    │   └── document version  (versionNumber, label, status, pageCount, failureCode)
    │       └── page  (index, width, height, status, ocrApplied)  + word layer blob
    ├── cue  (department layer, major.minor, label, type, notes, colour, anchor | null)
    ├── annotation  (department or personal layer, type, anchor, geometry, text, style)
    ├── change log row  (seq, batchId, user, via, agent, table, rowId, op, before, after, layer)
    └── export record  (kind, filename, layerSelection, privateTo, options, fileKey)
```

Every show-scoped row carries `showId`, `createdAt`, `updatedAt`, `updatedBy`. Deletes are real, not soft.

## Organisations and shows

- A user gets a personal organisation on sign-up. Shows live in an organisation; `create_show` puts a show in `organisationId` or your first organisation.
- `status`: `prep`, `rehearsal`, `running` or `archived`. **An archived show is read-only for everyone**, including owners and agents: every write returns `forbidden: show is archived`. The one exception is `update_show` with only `status` set to a non-archived value, by an owner. Exports still work on archived shows (printing a closed show is a reason to keep it). `list_shows` reports `inNow: []` and no presence for archived shows.
- `settings` is free JSON the app reads a few keys from: `paperSize` (`A4` default, or `Letter`: cue sheets are laid out for it), `stampSet` (string list of stamp texts, default `Enter, Exit, Fly in, Fly out, Blackout, Standby, Go`), `markerSides` (`{<departmentId>: "right"}`; anything else means the left margin). `update_show` replaces the whole object.

## Members and roles

| Role | Can read | Can write |
|---|---|---|
| `viewer` | everything in the show (every department layer, own personal layer, history, exports) | only their own personal layer |
| `editor` | the same | cues and annotations on department layers in their `departments` scope; their personal layer; documents, uploads, processing controls (cancel, retry, remove); re-anchoring review items on layers they can edit; reverts on layers they can edit |
| `owner` | the same, plus member emails | everything: every layer, members, departments, show title, status and settings |

- `departments` on a membership is `['*']` (all) or a list of department ids. It limits **editors only**; owners edit everything, viewers nothing. Tools accept codes and translate them.
- A show always keeps at least one owner (`conflict: A show needs at least one owner`).
- Membership is by existing user: `add_show_member` cannot create accounts (`not_found: No user with that email`).
- A non-member asking for a show, cue, annotation, document, version or export gets `not_found`, never `forbidden`, so ids do not reveal what exists. A token whose scope excludes the show gets `forbidden: token scope does not include this show`.

## Tokens

A personal access token (`bnd_…`) belongs to one user and is either unscoped (`*`: every show that user belongs to, and may create organisations and shows) or scoped to a list of show ids (those shows only; `create_show` and `create_organisation` are `forbidden`). Tokens are created in the web settings page or by the CLI, never through MCP. Every write an agent makes is attributed to the token's user with `via: "mcp"` and the client's name as `agent`.

## Departments and layers

- A department is a layer. Code: 1 to 8 letters or digits starting with a letter, stored upper case, unique per show. `numberFormat` decides how minors display: `decimal` shows `10.5` for minor 50 (`10.25` for minor 25), `point` always shows two places (`10.50`).
- `sortOrder` orders departments everywhere (lists, cue sorting, crowded tags). `hidden` keeps a department and its cues but drops it from pickers and from `layers: "all"` exports.
- Departments are never deleted.
- Every new show starts with the same seven: `LX` Lighting, `SND` Sound, `TM` TheatreMix (point format), `VID` Video, `SM` Stage management, `STG` Stage, `FLY` Flys, in that order. `create_show` takes no department list; change them afterwards.
- Every user also has a **personal layer** per show, keyed `personal:<userId>`. It holds annotations only (never cues), is visible to its owner alone, and is editable by its owner whatever their role. Nothing you do can read, list, edit, delete, export or revert another member's personal layer; those rows answer `not_found` as if they did not exist, and history filters them out.
- A layer key is `department:<departmentId>` or `personal:<userId>`. Tools print it as `layer` on annotations and log rows, and accept it wherever a layer is named.

## Documents, versions and pages

- `kind`: `libretto`, `score`, `blocking`, `other`. `place_cue_at_text` defaults to the first `libretto`.
- A document has versions numbered from 1; `currentVersionId` is the one in use. Uploading a version does not make it current until it has processed and its re-anchoring run has finished ([revisions-and-history.md](revisions-and-history.md)).
- Version `status`: `queued`, `processing`, `ready`, `failed`. A failed version has `failureCode` and a plain `failureMessage` ([documents-and-processing.md](documents-and-processing.md)).
- `ocrMode`: `auto` runs text recognition on pages without text; `never` skips it, so a scan becomes `ready` with empty word layers and is marked up by position only.
- `snapToText` (default on for libretto and other, off for score and blocking) switches the web app's drag snapping (MCP never snaps) and, with `ocrMode: "auto"`, tells processing that the document must have readable text: a text-anchored upload with under 20 characters fails `no_text`/`low_resolution`, a score or blocking one comes up `ready` regardless ([documents-and-processing.md](documents-and-processing.md)).
- Pages are zero-based. `width` and `height` are PDF points of the displayed (rotated) page. Each ready page has a **word layer**: `words` as `[text, x, y, w, h]` boxes and `lines` as lists of word indices in reading order.

## Coordinates and anchors

Coordinates are PDF points with the origin at the **bottom left** of the displayed page, after `/Rotate`. A4 is 595.28 × 841.89. Higher `y` is higher on the page; reading order within a page is descending `y`.

An anchor:

```json
{"documentId":"…","documentVersionId":"…","pageIndex":0,"x":89.754,"y":459.12,"status":"ok",
 "text":{"quote":"A rocky sea-shore on the coast of Cornwall","wordStart":47,"wordEnd":54}}
```

- `documentVersionId` says which version the position belongs to. A cue whose anchor is on a version other than the document's current one is "on an older version".
- `status`: `ok`, `approximate` (re-anchoring matched loosely or fell back to position on a same-length script) or `unresolved` (page counts differ, or the page no longer exists). Only re-anchoring sets anything but `ok`.
- `text` is the **text anchor**: the quoted words (at most 8 for a cue placed by text, up to 400 characters for a highlight) and their inclusive indices into that page's `words`. `wordStart: -1, wordEnd: -1` means "unbound": the quote is remembered but the words were not found on this version. A cue without `text` is a **positional anchor**: it survives revisions only by page and position.

## Cues

| Field | Type | Notes |
|---|---|---|
| `departmentId` | id | The layer. Shown as `departmentCode` in results. |
| `major`, `minor` | 0..9999, 0..99 | The number, stored in hundredths: `14.5` is `{14, 50}`. `display` renders it per the department format. Major 0 is the line-check range and is never renumbered. |
| `label` | ≤200 chars | Short operational description. |
| `type` | `go`, `standby`, `warn` | Tag outline: solid, dashed, heavy. Printed lead: `LX`, `SB LX`, `W LX`. |
| `notes` | ≤10000 chars | Printed as one line under the tag in the margin. |
| `colour` | `#RRGGBB` or null | Null means the department colour. |
| `anchor` | anchor or null | Null is unplaced: sorts last in cue sheets, skipped by renumbering. |
| `duplicate` | boolean (result only) | Another cue in the same department has the same number. |
| `payload` | object | Reserved; `{}` today. |

Numbers are unique per department in intent, never enforced: a collision is flagged, not refused. `LX 10` and `TM 10` coexist.

## Annotations

| Type | Geometry | Text | Drawn as |
|---|---|---|---|
| `note` | `{}` | required | A tinted block whose top-left corner is the anchor, with a bar in the layer colour. |
| `stamp` | `{}` | 1..40 chars | A rounded pill centred on the anchor, turned 3°. |
| `highlight` | `{}` | optional | A fill over the bound words (`anchor.text` required); an unbound one draws a dashed marker with the first characters of its quote. |
| `rect`, `ellipse` | `{w, h}` > 0 | optional | From the anchor (bottom-left corner) right and up. |
| `line`, `arrow` | `{dx, dy}` not both 0 | optional | From the anchor by the offset; the arrow head is at the end. |

`style` is `{colour?, strokeWidth? (0.5..12), fontSize? (6..72)}`; defaults are the layer colour, 1.5 pt, 10 pt (12 pt for stamps). Geometry is relative to the anchor so re-anchoring moves a shape with its anchor. Text is at most 2000 characters.

## The change log

Every write by every path (web, sync, MCP, the server's re-anchoring job) appends rows inside the same transaction:

| Column | Meaning |
|---|---|
| `seq` | Global sequence; what `revert_change` takes and what `before`/`nextBefore` page on. |
| `batchId` | One call's rows share a batch. Web clients choose their own; MCP calls get a fresh UUID per call; `renumber_cues` and `revert_batch` write one batch; a re-anchoring run is `reanchor:<versionId>`. |
| `userId`, `userName`, `via`, `agent` | Who and how: `via` is `web`, `sync` or `mcp`; `agent` is the MCP client's `name/version` (or the HTTP `User-Agent` for clients that do not declare themselves, including `curl` uploads over REST with a bearer token), `null` for a person in the app, and `Binder re-anchoring` (with `via: web`) for the server's run. |
| `table`, `rowId`, `op` | `cues`, `annotations`, `departments`, `documents`, `document_versions`, `shows`, `show_memberships`; `insert`, `update` or `delete`. |
| `before`, `after` | Only the changed columns. Insert: `before` null. Delete: `after` null. |
| `layer` | The row's layer key, for cues, annotations and departments; null otherwise. Rows on another member's personal layer are invisible to you. |

An annotation moved from a personal layer onto a department layer is logged on the department layer with `before.layerKind: "personal"`; for anyone but its owner `layerId` reads `null`.

## Export records

`kind`: `pdf-script` (marked script), `pdf-sheet`, `csv`, `xlsx` (cue sheets). `layerSelection` is the list of layer refs printed. `privateTo` is the creator's user id when the selection included their personal layer, else `null`; private records never show to anyone else. `options` holds a script print's `{pages, paper?, includeStandbyWarn, includeAnnotations, includeCueNotes}` and is `null` for sheets. The file is read as the `binder://shows/{showId}/exports/{exportId}` resource.

## Web app versus MCP

The web app is offline-first: it writes to a local database and uploads batches later through the sync path (`via: "sync"`, with the client's own `batchId` and `clientTs`). MCP writes go straight to the server and are visible to every client on its next sync. So:

- An edit a person made offline is not in `list_cues` or `get_history` until their device reconnects; `lastChange` and `inNow` in `list_shows` are your warning that people are active.
- Your write can land on a row a person is editing offline; when their device reconnects the sync path applies their patch column by column, last writer by arrival wins, and both changes are logged. Prefer narrow patches (one field) over rewriting whole cues.
- Snapping to text, the active layer, layer locks and visibility toggles are web-only; MCP has no equivalent, which is why `place_cue_at_text` exists.
