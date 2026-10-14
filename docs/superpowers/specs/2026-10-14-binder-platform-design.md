# Binder platform design

Date: 2026-10-14
Status: approved in conversation, awaiting written review
Author: Jayden Nawotka with Claude

## 0. Name

The product is **Binder**, by RVLT, a sibling of RVLT Flow. The name is the stage manager's binder: the ring binder of paperwork that holds the whole show. In the UI, each show's workspace is called its binder. The repository is `binder`, packages are scoped `@binder/*`, and the working directory at `/Users/jayden/cueapp` should be renamed to `/Users/jayden/binder` before M0 starts.

## 1. Purpose

Binder is a web platform for musical theatre production teams. It imports script and score PDFs, text-based or scanned, lets people annotate them and place cues, manages cues per department, and holds all show documentation as views over a single show graph. Its first integration target is generating TheatreMix show files from the mic plot and the cue points marked on the script.

The reference competitor is Cuelist (thecuelist.com). Cuelist places cues on a PDF and shares them in real time, but has no OCR, treats cues as drawings rather than data, and holds nothing beyond the script. Binder keeps Cuelist's strengths (PDF-centred, real-time, per-department layers, print export) and adds the show graph underneath.

Binder is AI-first. Everything a person can do in the binder, an agent can do through Binder's MCP server: read pages as images and text, search the script, place and move cues, annotate, build the show graph, run the allocator, generate exports, and work with history. The rule that makes this true is structural (section 3.10): every capability is implemented once in a service layer, and the web UI, the sync write path, and the MCP server are three clients of it. A capability is not done until it is in the MCP.

### 1.1 Primary users

Sound (designer, A1, A2) and lighting are the version one users. Stage management, directors, and production managers are supported by the same model and roles but are not the design centre of version one.

### 1.2 Success criteria for version one

- A real show is run from Binder: script marked up, cues placed, mic plot built, and the TheatreMix file generated from it rather than by hand.
- Editing works in a venue with no internet and syncs when a connection returns.
- Two people can work on the same show at once without overwriting each other, and each can see what the other is doing: who is in the binder, which page they are on, which cue they have selected, and their edits as they land.
- A scanned script is searchable and cues snap to its text, and the PDF itself carries the extracted text so it is searchable outside Binder too.
- A revised script PDF arrives mid-rehearsal and the cues follow it, with the ones that could not be placed automatically listed for review.
- Any change can be traced to who made it and when, and undone. The binder can be captured as a named version and restored. Every export says which version it came from.
- Binder is where a production's documentation lives, not one tool among several.
- The current workflow (Cuelist markup, print, hand-build one .tmix per cast variant) is replaced end to end.

### 1.3 Constraints

- Self-hosted on Jayden's Coolify server, Docker containers only.
- Personal tool first. No billing, no public sign-up, no onboarding flows.
- Native iPad client later. The backend and data model must not need rework for it.
- Real show materials never enter git. They carry real names.

### 1.4 Prior work this design builds on

- `/Users/jayden/theatremix-skills/`: a working skill with a `.tmix` validator and seed-clone builder, plus references on Jayden's cue style, mic and DCA practice, the verified file format, and scanned score handling. The rules in sections 4.8, 6.3, and 6.4 come from it.
- `/Users/jayden/hermes-backup-2026-09-06-132644/theatremix_analysis/`: the original schema reverse-engineering.
- `/Users/jayden/Downloads/35mm-draft-v1/`: an end-to-end generated draft (show.json, cue sheet, mic allocation, .tmix) that is the shape of what Binder automates.

## 2. Scope

### 2.1 In version one

- Accounts, organisations, shows, show membership with roles and department scope.
- Document upload (PDF), page rendering, word layer from embedded text or OCR, client-side search.
- Script structure: acts, scenes, songs, anchored to pages in one or more documents.
- Cues per department with (major, minor) numbering, anchored to page positions with text anchors.
- Annotations: text notes, cue markers with standby, warn, go styling, shapes, arrows, stamps. Department layers and a personal layer.
- Cue list views per department, auto numbering from script order, print export to PDF.
- Show graph: people, characters, casting with cast variants, appearances per scene or song, mics, mic assignments per scene range.
- Native documents, built in the app from the show graph rather than uploaded: mic plot, mic swap and handover sheet, book of faces, contact sheet, scene and song breakdown, per-department cue sheets and run sheets. The script and score are the only uploaded PDFs in version one (section 7).
- TheatreMix: automatic DCA allocation for TM cues, .tmix writer with one file per cast variant, .tmix reader to bootstrap shows from existing files.
- Exports: every native document to PDF and to Excel or CSV; the marked script to PDF; `.tmix`.
- Multi-show: a user works in several shows at once and can see and export archived ones.
- MCP server: every capability in this list is exposed as MCP tools and resources in the same milestone it ships in the UI, authenticated as a specific user, logged in history as that user acting through a named agent.
- Offline: all reads and writes work without a connection; a show can be made available offline on demand.
- Real-time: changes from other users appear within a second or two without reload, merged at field level.
- Presence: who is in the binder, which document and page they are viewing, and which cue or annotation they have selected.
- Version control, as four features (section 4.12): script revisions with automatic re-anchoring and a review list; a change log on every row with per-row history, an activity feed, and revert; named and automatic snapshots of the whole binder with compare and restore; export records tied to snapshots with a changelog since the previous export.

### 2.2 Deferred, with the model already supporting them

- Freehand ink with pressure.
- ETC Eos and QLab cue list export, OSC go to TheatreMix.
- Share links.
- Pages: collaborative rich-text documents inside a binder (see section 12).
- Native iPad client.
- Positions, FX, snippets, and channel levels in .tmix output.
- Server-side full-text search.

## 3. Architecture

### 3.1 Shape

A TypeScript monorepo managed with pnpm workspaces.

| Package | Role |
|---|---|
| apps/web | React and Vite single-page app, installable PWA, PDF.js viewer, SVG overlay, local SQLite via PowerSync |
| apps/api | Node with Hono. Auth, uploads, blob serving, sync write path, sync token minting, OCR job queue and worker, the service layer, and the MCP server |
| packages/db | Drizzle schema and migrations for Postgres, plus the PowerSync sync rules and the client schema derived from the same source |
| packages/core | Pure domain logic with no I/O: cue sorting and numbering, anchor ordering, mic plot derivation, DCA allocation, .tmix reader and writer, PDF coordinate maths, CSV export |
| packages/shared | Zod schemas and types shared by web and api |

packages/core must remain free of Node-only and browser-only dependencies so it runs in both, and so it can be ported for a native client later.

### 3.2 Data flow

1. The browser holds a SQLite database (wa-sqlite in a worker, OPFS storage) mirrored from Postgres by PowerSync. All reads come from it. All writes go to it first.
2. PowerSync queues local writes and uploads them to `POST /sync/upload` as batched create, update, and delete operations. An update carries only the columns that changed.
3. The API validates each operation against the user's membership and department scope, applies accepted operations to Postgres in one transaction as column-level patches, writes one ChangeLog row per accepted operation with the before and after values of the touched columns, and returns the list of rejected operations with reasons. Because patches are per column, two people editing different fields of the same cue at the same time both win.
4. The client discards rejected operations locally and shows a notice. Rejections are expected to be rare (a viewer editing, a revoked membership) and never block the queue.
5. PowerSync streams Postgres changes back to every connected client whose sync rules include the affected rows.

Blobs (original PDFs, page thumbnails, per-page word layers) do not go through PowerSync. The API serves them from storage after a membership check. The client caches them with the Cache API, keyed by blob URL. "Make available offline" on a show prefetches every blob the show references.

Identifiers are UUIDv7 generated on the client so rows can be created offline.

### 3.3 Sync rules

- Global bucket per user: their user row, organisation memberships, show memberships, and the show rows those memberships point to, including archived shows so the home screen can list them.
- Show bucket per show membership: every show-scoped table filtered by show id. Archived shows are excluded unless the user has opened them on this device or marked them available offline.

Row-level write rules live in the API, not in sync rules.

### 3.4 Auth

Better Auth with email and password plus magic link. Sessions are cookies. The API mints a short-lived JWT for PowerSync carrying the user id, refreshed by the client before expiry.

### 3.5 Storage

A `BlobStore` interface with `put`, `get`, `delete`, and `exists`. Version one implements it on a disk volume. An S3-compatible implementation (MinIO) is a drop-in later. Blob keys follow `shows/{showId}/documents/{documentId}/versions/{versionId}/original.pdf`, `.../versions/{versionId}/searchable.pdf`, `.../versions/{versionId}/pages/{index}/thumb.png`, `.../versions/{versionId}/pages/{index}/words.json`. The show id in the key is what the blob route checks membership against.

### 3.6 Jobs

pg-boss on the same Postgres runs document processing jobs inside the API container. One job per uploaded document fans out to one job per page. Jobs are idempotent and retried three times.

### 3.7 Deploy

Coolify runs four services and one volume: Postgres, the PowerSync service (open edition, Postgres bucket storage), the API container (which includes the job worker, the presence websocket, and has poppler, tesseract, and OCRmyPDF installed), the static web app behind a reverse proxy, and a disk volume for blobs mounted into the API container. Backups are a nightly Postgres dump plus the blob volume.

### 3.8 The sync spike

The first task of milestone M0 is a time-boxed spike, five working days at most: PowerSync service on Coolify, a two-table schema, a browser client creating rows offline and seeing them on a second browser online. Exit criteria: offline create and update, sync on reconnect, server-side rejection surfacing in the client, and a Swift SDK smoke test against the same service. If the spike fails, the fallback is ElectricSQL for the read path with TanStack DB on the client, keeping the same API write path. The decision is recorded in docs/superpowers/specs as an addendum.

### 3.9 Real-time collaboration

The target is Google Docs-style: several people in one binder, each seeing the others' edits and positions as they happen, with nobody's work lost. Three mechanisms cover it.

**Data changes** travel through the sync path in 3.2. The target is under two seconds from one client's edit to another's screen when both are online. Every row is its own unit, and updates are column-level patches, so concurrent edits collide only when two people change the same field of the same row within the same second. That case resolves last-writer-wins and the loser sees the winning value appear, which is the behaviour of a shared spreadsheet.

**Presence** does not belong in the database. The API hosts a websocket per show (`/shows/:id/presence`) carrying ephemeral state: user, document, page, selected cue or annotation, and a colour. Clients send on change and every five seconds; the server fans out to the show and drops a user after fifteen seconds of silence. The viewer shows avatars on the thumbnail rail and the page, and a coloured outline on a cue someone else has selected. Presence is best-effort and silently absent offline.

**Long-form text** (cue notes, person notes) is a plain column and merges at field level like everything else. Collaborative character-level editing of long documents is the job of the Pages module in section 12, which uses a text CRDT (Yjs) over the same websocket with updates persisted in Postgres. Binder's data model keeps structured show data and long-form text separate so each gets the right merge semantics.

### 3.10 AI-first: the service layer and the MCP server

**Service layer.** Every operation on a binder is a function in `apps/api/src/services/` with the shape `operation(ctx: Actor, input): Promise<Result>`, where `Actor` is `{ userId, via: 'web' | 'sync' | 'mcp', agent: string | null }`. The function checks permissions, performs the change inside a transaction, writes the change log, and returns typed data. HTTP routes, the sync upload path, and MCP tools are thin adapters over these functions and contain no logic of their own. A test asserts that every service operation is registered as an MCP tool (or deliberately listed as UI-only, with a reason), so the parity rule is enforced rather than remembered.

**MCP server.** Lives in the API at `POST /mcp` using the Streamable HTTP transport, so remote agents (Claude Desktop, Claude Code, Hermes, anything MCP-capable) connect over the network; local stdio clients use the standard `mcp-remote` bridge. Authentication in version one is a personal access token (section 4.1) sent as a bearer token, scoped to all of the user's shows or to a list of shows, created from the user's settings page. OAuth 2.1 as a provider is a follow-up once the token path is proven.

**Attribution.** Every change made through the MCP is logged as the token's user with `via = 'mcp'` and `agent` set to the client's declared name and version, so history reads "Jayden via Claude Code" and the activity feed can filter agent edits.

**Tool design.** Few, strong tools grouped by domain, each with a Zod input schema, a one-paragraph description written for an agent, pagination on list tools, and results that return ids the agent can use in the next call. Reads of a page return the rendered page as an image (JPEG, at most 1600 px on the long side) alongside its word layer, so an agent can both see and read a page. The AI-native placement tool `place_cue_at_text` takes a quote and a department and anchors a cue where that text occurs, with disambiguation when the quote appears more than once; it is how an agent marks up a script without pixel coordinates. Operations that are hard to reverse (restore a snapshot, delete a document, delete more than ten rows in one call) return `CONFIRMATION_REQUIRED` with a plain-language summary unless called with `confirm: true`, the same gate RVLT Flow uses.

**Resources and prompts.** Pages, word layers, exports, and snapshots are also exposed as MCP resources with `binder://` URIs for clients that prefer reading to calling. Prompts ship with the workflows Jayden already runs by hand: "mark up this script for TheatreMix", "build the mic plot from the breakdown", "review cues against the score".

**Agent workflows.** The theatremix-script-building skill in `/Users/jayden/theatremix-skills/` is the first consumer of the MCP. Its procedure maps onto tools step by step: upload the script and evidence, read pages, build the beat ledger as script items and appearances, model performers and mics as people, characters, casting, and assignments, place TM cues with `place_cue_at_text`, run the allocator, validate, and export the `.tmix` with its paperwork as export records. The skill's reference guides (Jayden's cue style, mic and DCA practice, the verified file format) move into the repository under `docs/guides/` and are served as MCP resources at `binder://guides/{slug}`, so the rules travel with the product and every agent, not just one skill, works to them. The skill itself is updated to call Binder instead of writing files, and its validator rules live in packages/core so the skill and the app cannot drift apart.

**By milestone.** M0: shows, documents and versions, pages (image and words), search, upload, tokens, guides as resources. M1: departments and layers, cues including `place_cue_at_text`, annotations, renumbering, history, document versions and re-anchoring review. M2: people, characters, casting, script items, appearances, mics, assignments, mic plot, overrides, snapshots. M3: allocation, TheatreMix export and import, export records. M4: cue sheets, share links, OSC.

## 4. Data model

All show-scoped tables carry `show_id`, `created_at`, `updated_at`, `updated_by`. Soft delete is not used; deletes are real and sync as deletes.

### 4.1 Tenancy

- **User**: id, email, name, avatar blob key.
- **Organisation**: id, name.
- **OrgMembership**: user, organisation, role (`owner`, `member`).
- **Show**: id, organisation, title, status (`prep`, `rehearsal`, `running`, `archived`), settings JSON.
- **ShowMembership**: user, show, role (`owner`, `editor`, `viewer`), departments (array of department ids, or the literal `*`).
- **PersonalAccessToken**: id, user, name, token hash (SHA-256 of a random 32-byte token shown once at creation), show scope (`*` or a list of show ids), created at, last used at, expires at (nullable), revoked at (nullable). Used by the MCP server (3.10) and by scripts. A token never grants more than its user has.

A user belongs to any number of shows across any number of organisations, and works in several at once. The home screen lists every show the user is a member of, active shows first and archived shows in their own section, with search. Switching shows is instant because each active show is already in the local database. An archived show stays fully readable and exportable, and its history, snapshots, and export records stay intact; it is read-only for everyone until an owner unarchives it. Archived shows are not synced to the local database by default to keep it small; opening one fetches it, and "make available offline" works on it like any other show.

Permissions:

| Action | owner | editor | viewer |
|---|---|---|---|
| Read everything in the show | yes | yes | yes |
| Personal layer annotations | yes | yes | yes |
| Cues and annotations in a department layer | yes | only departments in scope | no |
| Show graph (people, characters, casting, script items, mics, assignments) | yes | yes | no |
| Documents (upload, rename, delete) | yes | yes | no |
| Show settings, console config, memberships | yes | no | no |

### 4.2 Departments

- **Department**: id, show, code (`LX`, `SND`, `TM`, `VID`, `SM`, `STG`, `FLY`, user-defined), name, colour, number format (`decimal` shows 10.5, `point` shows 10.50), sort order.

A new show is seeded with LX, SND, TM, VID, SM, STG, FLY. Departments can be added, renamed, and hidden. The `TM` department is special only in that its cues carry a DCA payload and feed the .tmix writer.

### 4.3 Documents and pages

- **Document**: id, show, kind (`libretto`, `score`, `blocking`, `other`), title, current version (DocumentVersion id), sort order, OCR mode (`auto`, `never`, default `auto`), snap to text (boolean, default true for `libretto` and `other`, false for `score` and `blocking`).
- **DocumentVersion**: id, document, version number (1, 2, 3 within the document), label (free text, e.g. "V5 18 Aug rehearsal cuts"), original blob key, searchable blob key (the working PDF with an invisible text layer added, see 5.1), page count, uploaded by, uploaded at, processing status (`queued`, `processing`, `ready`, `failed`).

A document is the stable identity ("the libretto"); a version is one uploaded PDF of it. Uploading a replacement creates a new version and triggers re-anchoring (5.4). Every version stays viewable read-only. The original upload is kept byte-for-byte and never served to the viewer. Everything (viewing, search, snapping, print export) uses the version's searchable PDF, which looks identical to the scan.

OCR on music notation produces mostly junk, so on score documents the word layer is for search and discovery only. Snapping defaults off there and cues anchor by position.
- **Page**: id, document version, index (zero-based), width and height in PDF points, rotation, thumbnail blob key, word layer blob key, OCR applied (boolean), status (`queued`, `ready`, `failed`).

The word layer blob is JSON: `{ words: [{ t, x, y, w, h }], lines: [[wordIndex, ...]] }` with boxes in displayed page space. It is always extracted from the searchable PDF's text layer, so nothing above the pipeline distinguishes scanned pages from text pages.

Coordinate convention for everything in Binder (word boxes, anchors, annotation geometry): **displayed page space**, which is PDF points with the origin at the bottom-left of the page as the viewer shows it, after the page's `/Rotate` has been applied. A page's stored width and height are its displayed dimensions. For an unrotated page this is identical to PDF user space; for a rotated page the print exporter applies the inverse rotation when stamping.

### 4.4 Anchors

An anchor is a value type stored inline on the owning row, not a table.

```
Anchor {
  documentId, documentVersionId, pageIndex,
  x, y,                       // displayed page space (4.3): points, origin bottom-left
  text?: { quote, wordStart, wordEnd },  // optional, captured when snapped to a line
  status: 'ok' | 'approximate' | 'unresolved'   // set by re-anchoring, 'ok' when placed by hand
}
```

An anchor points at a specific document version. When the document's current version changes, re-anchoring (5.4) rewrites anchors to the new version and sets their status. The viewer shows anchors for the version being viewed, so an older version still shows where things were.

Reading order within a document version is `(pageIndex ascending, pageHeight minus y ascending)`. Across documents there is no single order; each document is ordered independently.

### 4.5 Script structure

- **ScriptItem**: id, show, parent (null for acts), kind (`act`, `scene`, `song`), number (text, e.g. "1", "2a"), title, sort order.
- **ScriptItemAnchor**: script item, plus an Anchor value (document, version, page, y, optional text, status). One per document the item appears in. The text field is captured from the heading line when the anchor is placed by snapping, so song and scene starts survive revisions too.

Scenes and songs are the columns of the mic plot and the units of the breakdown. Acts are containers. Resolving a position P in a document to a script item: the scene or song with the greatest start anchor less than or equal to P in that document. If none, P has no item.

### 4.6 People and characters

- **Person**: id, show, name, email, phone, job (free text, e.g. "Cast", "LX Op"), headshot blob key, notes.
- **Character**: id, show, name, short label (up to 12 characters, used on scribble strips), colour, priority (integer, lower is more important, used by the DCA allocator), notes.
- **CastVariant**: id, show, name (e.g. "Principal", "Mo as Ray"), is default.
- **Casting**: character, person, cast variant.
- **Appearance**: character, script item (scene or song). Means the character is on and live during that item.

Every show has exactly one default cast variant. Other variants start as a copy of the default and override individual castings.

### 4.7 Mics

- **Mic**: id, show, console channel (integer), label, pack id, frequency, element, colour, notes, sort order.
- **MicAssignment**: mic, person, from script item, to script item (inclusive, by ScriptItem sort order; null to-item means to the end). A person may hold different mics in different ranges. Two assignments for the same mic may not overlap.
- **MicPlotOverride**: mic, script item, state (`on`, `off`). Forces a cell regardless of derivation.

Derivation. A mic is live in script item S under cast variant V when: there is a MicAssignment of that mic to person P covering S, a Casting of some character C to P in V, and an Appearance of C in S. A MicPlotOverride on (mic, S) replaces the derived state. The mic plot is this function evaluated over every mic and every scene or song.

### 4.8 Cues

- **Cue**: id, show, department, major (integer), minor (integer 0 to 99), label, anchor (nullable), type (`go`, `standby`, `warn`), notes, colour, payload JSON.

Display: `major` alone when minor is zero, otherwise `major.minor` formatted per the department's number format. Sort order within a department is `(major, minor)`. Uniqueness of `(department, major, minor)` is not enforced by the database. Duplicates are a validation warning in the cue list and block .tmix export for the TM department until resolved.

Numbering convention. Jayden's standing preference, which overrides the older per-song point style seen in WAKA and Songs for a New World: each scene or song owns a block of ten (10, 20, 30), cues inside the block take the following integers (11, 12, 13), and points (14.50) are reserved for insertions made after numbering. Line checks live in the number 0 range, conventionally 0.50.

"Renumber from script order" is an explicit operation on one department within one document. It orders cues by anchor reading order, groups them by the scene or song resolved from the anchor, assigns each group's first cue the next multiple of the block size (default 10) and the rest consecutive integers, and resets minors to zero. Cues that would not fit in a block (more than nine inside one song at block size 10) spill into points and are flagged. Unplaced cues are untouched. Importing a file never renumbers; existing numbers are preserved exactly.

A cue with a null anchor is "unplaced". It appears in cue lists and exports but not on any page.

TM cue payload:

```
{
  dca: { [dcaNumber]: { channels: number[], label: string } },   // allocator output, persisted
  overrides: {
    pin:   { [micId]: dcaNumber },      // force a mic onto a DCA
    exclude: micId[],                   // drop a mic even if live
    add: micId[],                       // include a mic even if not live
    groups: [{ dca, micIds, label }]    // force these mics onto one DCA with this label
  },
  warnings: string[]
}
```

Other departments' payloads are empty objects in version one.

### 4.9 Annotations

- **Annotation**: id, show, layer kind (`department`, `personal`), layer id (department id or user id), anchor, type (`note`, `rect`, `ellipse`, `line`, `arrow`, `stamp`, `highlight`), geometry JSON (in PDF points), text, style JSON.

Stamps are chosen from a per-show stamp set (defaults: Enter, Exit, Fly in, Fly out, Blackout, Standby, Go). Highlights reference a word range through the anchor's text field.

### 4.10 Console config

- **ConsoleConfig**: show, target console (`SQ-5`, `SQ-6`, `SQ-7`, `QL1`, `QL5`, `CL`, `TF`, `X32`, `M32`, `Wing`, `Avantis`, `dLive`, `other`), DCA numbers (array), designer, venue, extra config JSON (passed through to .tmix config rows).

The channel list is derived from the Mic table, not stored.

### 4.11 Layers

Everyone works on the same script. Each department is a layer, and every user also has a personal layer. A cue belongs to its department's layer. An annotation belongs to either a department layer or the author's personal layer. There is no shared "everyone" layer; a note the whole team should see goes on the author's department layer.

- **Ownership and editing**: an editor can create, move, and delete cues and annotations only on layers for departments in their membership scope. Everyone can edit their own personal layer. Owners can edit every layer.
- **Visibility**: every member can see every department layer. Visibility toggles per layer are per user and per device, remembered locally. Personal layers are visible only to their owner.
- **Active layer**: the toolbar has one active layer at a time, which is where new cues and annotations go. Keyboard shortcuts switch it. The active layer is always one the user can edit.
- **Lock**: a user can lock any visible layer for their session so they cannot accidentally drag someone else's cue. Locking is local and does not affect others.
- **Appearance**: a layer's colour comes from its department. Cue markers, labels, highlights, and presence outlines all use it, so a page with sound, lighting, and SM work on it reads at a glance.
- **Print and export**: every export takes a layer selection. The SM prints all layers as the calling script; a lighting designer prints only LX; a clean copy prints none.
- **Numbering**: numbers are unique per department, never across layers. LX 10 and TM 10 coexist.

### 4.12 Version control

Version control is four features on one foundation. The foundation is the change log; the others read from it or mark points in it.

**ChangeLog**: sequence (per show, monotonic), show, user, via (`web`, `sync`, `mcp`), agent (the MCP client name and version, null otherwise), client timestamp (when the edit was made, which may be offline), server timestamp (when it arrived), batch id (one sync upload or one MCP call), table, row id, op (`insert`, `update`, `delete`), before (JSON of the touched columns), after (JSON of the touched columns). Append-only, written only by the API write path, never synced to clients. Read through `GET /shows/:id/history` with filters for row, table, layer, user, and time range. Offline, history is unavailable and the UI says so.

Views on the change log:

- **Row history**: on any cue, annotation, person, mic, or assignment, the list of changes with who, when, and the before and after values. "Revert this change" issues an ordinary write restoring the before values, so the revert is itself logged and revertable. Reverting requires edit rights on that row's layer or table.
- **Activity feed**: the show's change log newest first, grouped by batch and user ("Jayden moved 3 TM cues and relabelled 1, 14:02", "Jayden via Claude Code placed 42 TM cues, 09:15"), filterable by layer and by human or agent. This is how an SM sees what every department did since they last looked.
- **Personal undo** is separate: an in-session stack of the user's own edits, applied as new writes. It never undoes someone else's change.

**Snapshot**: id, show, binder version (monotonic integer per show, shown as "Binder v12"), name (null for automatic), kind (`manual`, `auto`, `pre-export`, `pre-reanchor`, `pre-restore`), created by, created at, change log sequence at capture, state blob key. The state blob is a JSON materialisation of every show-scoped row at that moment, which is small (a few thousand rows) and makes compare and restore independent of replaying the log.

- **Capture**: manual from the binder menu with a name; automatic once a day when anything changed, before every export, before every re-anchoring, and before every restore. Automatic snapshots older than ninety days are thinned to one per week, except `pre-export`, which are kept while their export record exists.
- **Compare**: any two snapshots, or a snapshot and now. The diff is by row id across every table: added, removed, changed (with the changed columns). Presented per layer and per table, with cues shown as a cue list diff ("TM 14.50 added", "LX 23 moved p.9 to p.10", "Mic 4 reassigned Mo to Kattie from Song 6").
- **Restore**: owner only. Computes the writes that turn the current state into the snapshot and applies them through the normal write path in one batch, after taking a `pre-restore` snapshot. Nothing is deleted from history; restore is a forward change. Documents and their versions are not part of a snapshot; only the anchors are, so a restore can point anchors at an older document version that still exists.

**ExportRecord**: id, show, kind (`tmix`, `pdf-script`, `pdf-sheet`, `csv`), filename, cast variant (nullable), layer selection (JSON), snapshot id (the `pre-export` snapshot taken for it), binder version, created by, created at, file blob key, changelog (JSON summary of the snapshot diff against the previous export record of the same kind and variant). Exports are generated on the client; the record and the file upload when online, queued like any other write. The exports panel lists records newest first with "download again" and "what changed since this". The footer of every PDF export and the `designer` field of every `.tmix` carry the binder version and date, so paper and console both say which version they are.

**Script revisions** are in 5.4.

## 5. Script engine

### 5.1 Upload and processing

1. `POST /shows/:id/documents` creates a Document and its first DocumentVersion; `POST /shows/:id/documents/:docId/versions` adds a version to an existing document. Both accept a PDF up to 200 MB, checked by magic bytes, store the original, and create the version row as `queued`.
2. A document job produces the searchable PDF. With OCR mode `auto` it runs OCRmyPDF with `--redo-ocr --output-type pdf --optimize 0`, which leaves existing vector text untouched, OCRs only image regions, and writes an invisible text layer positioned over the scan. The result looks identical to the upload and is searchable in any PDF reader. With OCR mode `never`, or when the document has no images at all, the searchable PDF is a copy of the original. The job runs with a per-document timeout of thirty minutes and a concurrency of one per container.
3. Page rows are created from the searchable PDF with dimensions from pdfjs-dist. One page job each then extracts words with pdfjs-dist `getTextContent`, converts items to word boxes in user space, groups lines by vertical overlap sorted left to right, and renders the thumbnail at 160 px wide with poppler.
4. Processing status rolls up to the Document. Failure on a page sets that page to `failed`; the document still becomes `ready`. Failure of the OCRmyPDF step falls back to a plain copy as the searchable PDF, marks every page OCR applied false, and surfaces a retry action.

Cuelist-printed scans (an image per page plus Cuelist's header, footer, and cue labels as embedded text) are the reason for `--redo-ocr` over `--skip-text`: the latter would skip those pages entirely because they contain a little text. With `--redo-ocr` the header text is kept and the body is OCR'd.

Scores go through the same path. Their text layer will be noisy around notation and useful around lyrics and titles, which is what search needs.

### 5.2 Viewer

- Pages render client-side with PDF.js from the cached searchable PDF, in a virtualised vertical list, with zoom from 50 to 400 percent and a thumbnail rail. Collaborators' avatars sit on the thumbnails of pages they are viewing.
- Cues and annotations render as one SVG overlay per page in PDF user space, with a single transform per page. Hit testing and dragging happen in user space.
- When snapping is on for the document, dropping a cue within 12 points of a text line snaps its y to the line and captures the text anchor (the nearest word and a quote of up to eight words). A toolbar toggle overrides the document default for the session. The quote doubles as the cue's trigger text on cue sheets.
- Layer panel: visibility toggle, lock, and active-layer selection per department and personal layer, remembered per user in local storage (see 4.11).
- Search runs over the cached word layers for every document in the show and jumps to the hit.
- Keyboard: next and previous cue, place cue in the active department, jump to page.

### 5.3 Print export

pdf-lib in the browser loads the cached searchable PDF and stamps markers, labels, and annotations for the chosen departments onto each page, then downloads. Page size is unchanged and the invisible text layer survives, so the printed script is searchable in Preview or Acrobat. Every page gets a footer with the show title, document and version label, layer selection, binder version, and date. The same path produces a "clean" copy with no markup, which is how a scanned script becomes a searchable PDF for use anywhere. Each export creates an ExportRecord (4.12).

### 5.4 Script revisions and re-anchoring

Uploading a new version of a document runs, after processing finishes:

1. Take a `pre-reanchor` snapshot.
2. For every anchor on the old version (cues, annotations, script item anchors), find its place in the new version:
   - With a text anchor: search the new version's word layers for the quote, exact match first, then a normalised match (case, whitespace, punctuation, hyphenation at line ends ignored). One match: anchor there, status `ok` for exact, `approximate` for normalised. Several matches: pick the one closest in relative document position to the old anchor, status `approximate`. None: step 3.
   - Without a text anchor, or when text matching found nothing: if the page counts are equal, keep page and position, status `approximate`. Otherwise keep the old page and position on the new version if the page exists, status `unresolved`; if it does not exist, place on the last page, status `unresolved`.
   - x is preserved relative to the matched line's left edge for text matches, and unchanged otherwise.
3. Write the new anchors through the normal write path, so the change log holds the old anchors and the whole run can be reverted as one batch.
4. Switch the document's current version. Open the review list.

The review list shows every anchor whose status is not `ok`, grouped by layer, with the old page thumbnail and the new one side by side and the old quote highlighted where it was found or where it was expected. Each item has "accept", "move" (drag on the page), and "revert to old version". Accepting sets status `ok`. The list stays until empty and the document header shows a count of unreviewed anchors.

The version switcher in the viewer shows any version read-only with its anchors as they were. "Compare versions" shows the two versions' pages side by side with a line-level text diff computed from the word layers, so cut and added lines are visible without reading the whole script. Re-anchoring never deletes a cue; a cue that cannot be placed is `unresolved`, not lost.

## 6. Mic plot, DCA allocation, and TheatreMix

### 6.1 Mic plot view

A grid with mics as rows and scenes or songs as columns. Cells show the live character short label under the selected cast variant, with override state marked. Clicking a cell toggles an override. Changing any casting, appearance, or assignment re-derives the grid and every TM cue's allocation.

The swap and handover sheet is derived from MicAssignment boundaries: for each mic whose assignment changes, one row with the outgoing person, their last live item, the incoming person, their first live item, and a free-text window note. Its purpose is to make every physical pack change explicit before anyone approves sharing a pack. Timing feasibility is a human judgement; the sheet records it, it does not compute it.

### 6.2 Live set at a cue

For a TM cue with an anchor, the live mic set is the derivation of 4.7 evaluated at the script item resolved from the anchor, then modified by the cue's `add` and `exclude` overrides. For an unplaced TM cue the live set is empty before overrides, so imported cues keep exactly their pinned assignments.

### 6.3 Allocator

Inputs: the ordered list of TM cues, each with its live mic set; the DCA numbers from console config; the previous cue's allocation; the cue's overrides; characters' priorities.

For each cue in `(major, minor)` order:

1. Apply `groups`: each group occupies its DCA with its label.
2. Apply `pin`: each pinned mic occupies its DCA, labelled with the character short label.
3. For each remaining live mic, if it held a DCA in the previous cue and that DCA is still free, keep it there.
4. Sort the remaining live mics by character priority, then console channel. Assign each to the lowest free DCA.
5. If live mics remain with no free DCA, place them together on the highest-numbered DCA that was assigned in step 4, relabel it from the first matching ensemble definition or `ENS`, and add a warning. If step 4 assigned nothing, they remain unassigned and the warning says so. Unassigned controlled channels are muted by TheatreMix.
6. Labels for single-mic DCAs are the character short label of the character the mic's person plays at that script item; if the person plays several, the highest-priority one.

Rules the allocator must satisfy, taken from the observed corpus: a mic is never on two DCAs in one cue (disjoint allocation); solo voices are never merged into a group unless capacity forces it; groups go to the rightmost DCAs; continuity is local, not a permanent DCA per person.

Warnings: capacity overflow; a cue with no live mics and no overrides ("mutes every controlled channel", suppressed for cues labelled as pre show, post show, or interval); a live mic with no console channel.

Label suggestion: when a TM cue has no label, the UI proposes one from the diff against the previous cue in the style of the corpus ("Add Bonnie, Lilli", "Remove Nick", "Bonnie solo"). The user can accept or type their own.

The output is written into the cue's payload `dca` and `warnings`. The allocator is a pure function in packages/core and is deterministic for a given input.

### 6.4 .tmix writer

Runs in the browser with sql.js, and in Node for tests and a CLI. Produces one file per selected cast variant, named `{show title} - {variant} - v{binder version}.tmix`, and creates an ExportRecord per file (4.12). The `designer` config value is suffixed with the binder version and date so the console shows which version it is running.

Schema. The DDL is not hand-written. It is captured verbatim from an app-generated TheatreMix 3.4.1 file into a constant in packages/core, including the `skip` column, the twelve DCA column pairs, the two unique indexes, and the malformed-looking `ensembles` column type (`TEXT\`channelProfiles\` TEXT`) that the app itself writes. A test asserts the generated file's `sqlite_master.sql` rows equal the captured strings.

Rows:

- `config`: a minimal conservative key set, not the full set found in saved shows. TheatreMix inserts any missing key with its own default on open, which is safer than copying another show's console settings. Written keys: `targetConsole`, `designer`, `venue`, `channels` (mic console channels ascending), `dcas` (from console config), `minVersion` `3.0`, `profileSchemaVersion` `2`, `autoConnect` `0`, `consoleIP` `""`, `consoleMAC` `""`, `consoleModel` `""`, `consoleVersion` `""`, `qLabPasscode` `""`, `backupChannels` `""`, `spareBackup` `0`, `fxAssigns` `0`, `fxMutes` `0`, `defaultFX` `-1`, `qLabCues` `0`, `snippetRecall` `0`, `sceneRecall` `0`, `channelLevels` `0`, `gangLR` `0`, `enableChannelMonitoring` `1`, `consoleMuteDCAUnassign` `1`, `suppressDCAMuteBackupSwitch` `0`. Network credentials, passcodes, and auto-connect are never carried into a generated file, including on re-export of an imported show. Extra config JSON from console config overlays last and cannot set those keys.
- `profiles`: one row per mic: `channel`, `name` set to the assigned person's name under the variant (first assignment in script order), `label` set to the character short labels joined with `/` and truncated to 12 characters, `default` 1, `data` empty. `profiles.id` is an autoincrement and never the console channel.
- `positions`: exactly one row, id 0, Centre Stage, CS, delay 0, pan 0, buses empty. This row is mandatory: a file without position id 0 crashed TheatreMix 3.4.1 on open, and adding it was the confirmed fix.
- `ensembles`: ids 2 and 3, Male and Female, empty channels.
- `cues`: one row per TM cue with `number` = major, `point` = minor, `name` = label, `dcaNNChannels` as comma-joined channels and `dcaNNLabel` from the payload, `colour` null, `skip` 0, every other column empty string. Preamble cues, on by default in export options: 0.50 Line checks (every mic on its own DCA in channel order up to the DCA count, label from the profile), 1 Pre show (nothing assigned), and a Post show cue at the next multiple of the block size after the last cue. A show that already has cues in the 0 range keeps them and no line-check cue is added.
- Remaining tables are created empty.

Validation before writing, ported from tmix_tool.py and run again on the produced file:

- Controlled channels and DCAs are non-empty; DCAs are within 1 to 12.
- Every controlled channel has exactly one default profile; no profile is on an uncontrolled channel.
- Position id 0 exists.
- Cue identities are valid (`number` at least 0, `point` 0 to 99) and unique.
- Assignments reference only enabled DCAs and controlled channels; memberships are positive integers with no duplicates.
- At least one cue exists, and at least one cue is in the number 0 range.
- Warning, not error: a channel on more than one DCA in a cue; a cue with no assignments outside pre show, post show, and interval.

Export is blocked, with a list linking to each offending cue or mic, when any error rule fails. The browser download uses `application/octet-stream` with the `.tmix` filename; no ZIP wrapper.

### 6.5 .tmix reader

Imports an existing file into a new or empty show: `config` to console config (target console, DCAs, designer, venue only; credentials are dropped), `profiles` to mics keyed by the `channel` column (name as a Person, label split on `/` into Characters, cast under the default variant), `cues` to unplaced TM cues with every assignment written as `pin` and `groups` overrides so the re-exported file matches the import. Numbers are preserved exactly, including the older per-song point style. Both observed schema variants (with and without `skip`) are readable. Cue columns the writer does not produce (positions, profiles, FX, snippets, QLab, levels, scenes, colour) are kept in the cue payload's `imported` field so nothing is silently lost, and re-export writes them back unchanged. A round-trip test asserts that import followed by export reproduces the cue and profile rows of each private fixture.

## 7. Native documents and exports

The script and score are PDFs because that is how they arrive. Everything else in the binder is built in the app as a view over the show graph, so it is never out of date and never retyped. Each native document has a screen for working in it and exports to paper and spreadsheet formats.

| Document | Built from | Screen | Exports |
|---|---|---|---|
| Mic plot | Mics, assignments, casting, appearances, overrides | Grid, mics by script items, editable cells | PDF (landscape grid), XLSX |
| Swap and handover sheet | MicAssignment boundaries | List in script order | PDF, XLSX |
| Book of faces | People with headshots, casting | Photo grid with name and roles, filter by cast or crew | PDF |
| Contact sheet | People | Table | PDF, XLSX, CSV |
| Scene and song breakdown | Script items, appearances, casting | Grid, characters by script items | PDF, XLSX |
| Cue sheet (per department) | Cues, anchors, payloads | Table in cue order with page and trigger text | PDF, XLSX, CSV |
| Run sheet (per department) | Cues of type standby and go, script items | Running order with page references | PDF |
| Cast list | Characters, casting, cast variants | Table per variant | PDF, XLSX, CSV |
| Export history | ExportRecords | List with download and changelog | none |

Rules that apply to all of them:

- PDF exports are laid out for A4 and Letter, chosen per show, and carry the footer from 5.3 with the binder version.
- XLSX is generated with one sheet per table and real cell types (numbers as numbers), so it opens cleanly in Excel and Google Sheets. CSV is UTF-8 with a byte order mark so Excel reads it.
- Every export creates an ExportRecord (4.12) and runs on the client, so it works offline.
- A native document shows the cast variant it is rendering for, where that matters, and the export filename includes it.

## 8. Error handling

- **Sync rejection**: the API returns rejected operations with a reason code; the client reverts the local row and shows a notice naming the row. Never a blocked queue.
- **Conflicts**: last write wins per row by server arrival. Cue number collisions are a warning, not an error.
- **Processing failure**: the document is still usable; failed pages show a badge and anchor by position only. A retry action re-queues the page.
- **Offline**: the UI shows a persistent sync state (synced, pending with a count, offline). Exports work offline because they run on local data.
- **Blob miss offline**: a page whose original is not cached shows a placeholder with a "needs connection" message rather than an error.
- **Export validation**: blocked exports list every problem with a link to the offending cue or mic.
- **Re-anchoring**: never fails as a whole. Each anchor ends `ok`, `approximate`, or `unresolved`, and the run is one revertable batch.
- **Restore**: refused with a message if the snapshot references a document version that has since been deleted; everything else restores.
- **History offline**: the panel says history needs a connection; personal undo still works.

## 9. Testing

- **packages/core** (Vitest): numbering, display formatting, and block renumbering; anchor ordering; script item resolution; mic plot derivation with overrides; the allocator (stickiness, priority, overflow grouping, pins, exclusions, disjointness, label suggestion); .tmix DDL equality against the captured schema; the validator against the malformed cases in test_tmix_tool.py (missing position 0, duplicate cues, point out of range, uncontrolled channel, bad membership text, missing line check); reader on both schema variants; reader and writer round-trips on private fixtures when present and on synthetic fixtures always.
- **packages/core, version control**: the re-anchoring matcher on the public libretto against an edited copy (lines cut, lines added, a page inserted, a page removed, a scan with different margins); snapshot diff and restore-write computation; export changelog summaries.
- **apps/api** (Vitest with a throwaway Postgres in Docker): auth, membership and department scope on the sync write path, change log completeness (every accepted op produces exactly one row with correct before and after), upload validation, page processing on the public fixtures, blob access control, snapshot capture and thinning.
- **MCP** (Vitest with the SDK's in-memory transport): every tool called through a real client against the service layer; the parity test that every service operation has a tool or a listed exemption; token scope enforcement; the confirmation gate; attribution in the change log.
- **apps/web** (Vitest and Testing Library for components; Playwright end to end): upload a fixture, wait for ready, search a word, place a cue snapped to text, export the marked PDF, generate a .tmix and assert its rows with sql.js.
- **Manual gate per milestone**: Jayden opens a generated .tmix in TheatreMix 3.4.1 and runs cues.

Fixtures: `fixtures/public/` holds a Gilbert and Sullivan libretto rendered to a text PDF from Project Gutenberg and a scanned vocal score from IMSLP, committed. `fixtures/private/` is gitignored and populated by a script that copies the WAKA, 35MM, Spring Chicken, and Songs for a New World materials from their known paths.

## 10. Milestones

Each milestone gets its own implementation plan and is usable on its own.

- **M0 Foundation**: monorepo, CI, Coolify deploy, auth, organisations, shows, memberships, personal access tokens, the service layer, the sync spike and its go or no-go, the write path with change log, document and version upload and processing, viewer with search and thumbnails, the MCP server with the M0 tools, public fixtures.
- **M1 Script markup**: departments, layers, cues, annotations, overlay editing, snapping and text anchors, cue list views, renumbering, print export with export records, offline prefetch, presence, row history and activity feed with revert, document versions with re-anchoring, review list, and compare.
- **M2 Show graph**: script items and anchors, people, characters, cast variants, casting, appearances, mics, assignments, mic plot with overrides, swap and handover sheet, book of faces, contact sheet, breakdown, CSV exports, snapshots with compare and restore.
- **M3 TheatreMix**: allocator, TM cue payload editing, .tmix writer with console presets, per-variant export with export records and changelogs, .tmix reader, private fixture round-trips, manual gate in TheatreMix.
- **M4 Polish and exports**: cue sheets and run sheets per department, share links, duplicate show, OSC go, Eos and QLab export as scope allows.

## 11. Open items resolved during design

- Name: Binder, by RVLT. Decided after the first draft of this spec.

- Freehand ink: out of v1 by Jayden's choice.
- Live TheatreMix control: secondary; file generation is primary.
- Beats and enter or exit anchors inside a song: dropped. Mid-song mic changes are TM cue overrides, which matches current practice (WAKA cues 1.00 to 1.04 are add and remove steps within one song).
- Positions, FX, snippets in .tmix: deferred; the writer leaves them at defaults and the reader preserves imported values.
- Numbering: blocks of ten per song with integer cues inside, from Jayden's standing preference in theatremix-skills. Older point-style files are imported as-is.
- Position id 0 and the minimal config set: required by the confirmed 3.4.1 crash and the verified-opening builder in theatremix-skills.
- ZIP delivery of .tmix files: a workaround for a different delivery channel, not needed in a browser download.
- Music recognition (OMR) on scores: out of scope. Scores get OCR for search only and position-only cue anchoring.
- Searchable scans: the OCR output is embedded in the working PDF as an invisible text layer (OCRmyPDF) rather than kept only as a sidecar, so the scan stays visually identical and the text travels with the file.

## 12. Beyond version one: the documentation hub

Version one makes Binder the home of the script, the cues, and the structured show graph. The longer goal is that every piece of production documentation lives in the binder and draws on that graph: not only show-running paperwork but production plans, floorplans, CAD and rigging plans, equipment lists, and design documents. The division of labour with RVLT Flow is: **you build the whole show out in Binder, then Flow does the crewing and the equipment logistics.** In rough order:

- **Pages**: rich-text documents inside a binder (rehearsal reports, production meeting notes, design briefs, risk assessments, production plans) with Google Docs-style simultaneous editing on a Yjs CRDT, named versions from the CRDT history, and live blocks that embed show graph views (the cast list, a scene's mic plot column, a department's cue list, the equipment list) so a document never goes stale.
- **Files**: any attachment, not only PDFs (ground plans, lighting plots, CAD exports, Vectorworks and AutoCAD files, costume renders, audio, spreadsheets), stored and shared with the same roles, with PDF and image previews, and the same Document and DocumentVersion model as scripts so every plan has a version history and annotations re-anchor across revisions. Plans get the same annotation overlay as scripts, so a floorplan can carry notes and stamps.
- **Equipment list and patch**: a per-department list of what the show needs (mics, packs, consoles, fixtures, playback, comms), built from the show graph where possible (the Mic table already is one) and by hand otherwise, plus the sound department's input patch, output patch, and cable list as native documents replacing the Project Book spreadsheet. This is the handoff artefact to Flow.
- **RVLT Flow link**: a show references a Flow job. Binder pushes the equipment list to Flow as the job's line items and reads back availability, conflicts, and confirmed crew. Dates, venue, and client live in Flow and are read into Binder. The boundary is deliberate: Binder never holds stock, prices, or invoices, and Flow never holds cues, scripts, or the show graph.
- **Schedule**: rehearsal and performance calendar, calls, and which cast variant plays each performance, which also selects the `.tmix` to use that night. Crew calls come from Flow when linked.
- **Reports**: rehearsal and performance report templates generated from the schedule and filled in as Pages.
- **Native iPad client** on the same backend, with pencil annotation.
- **Templates**: a show template (departments, stamp set, console config, page templates, standard equipment list) so a new binder starts populated.
- **In-app assistant**: a chat panel inside the binder that uses the same MCP tools as external agents, so "place standbys for every LX go in act one" or "who is unmiked in the finale" is answerable without leaving the page.
- **Show build from evidence**: the assistant's headline workflow and the in-app version of the theatremix-script-building skill. Given a script, a score, track sheets, and any other evidence uploaded to the binder, it proposes the script structure, characters, appearances, mic allocation, TM cue points with triggers, and the DCA plan. Every proposed row carries its evidence (document, page, quote, confidence) and conflicts between sources are listed rather than resolved silently, matching the skill's evidence standard. Nothing is written until Jayden reviews the proposal; applying it is one batch in history attributed to the assistant, so it can be reverted as a whole. The output is the same `.tmix` and paperwork the skill produces today, generated from the binder instead of from files.
- **OAuth provider** for the MCP server so third-party agents connect with a consent screen instead of a pasted token.
