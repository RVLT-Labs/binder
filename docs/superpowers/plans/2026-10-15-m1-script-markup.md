# Binder M1 Script Markup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the M0 viewer into the markup tool: departments as layers with department-scoped editing, cues and annotations placed on the script with text snapping, cue lists with renumbering and PDF/CSV export, the marked script printed to PDF with export records, history with row history, activity feed, revert and personal undo, script revisions with automatic re-anchoring, a review list and compare, and live presence, every operation reachable through the MCP server, deployed to binder.rvlt.app.

**Architecture:** Three new synced, show-scoped tables (`departments`, `cues`, `annotations`) plus `export_records` follow the M0 pattern: Drizzle schema, publication and grants, a Sync Streams query, the client schema, and the parity test. Cues and annotations are written locally in SQLite and uploaded through the sync write path, which gains create-or-update PUT and idempotent DELETE as a client of the same services the MCP tools call. Pure logic (numbering, renumbering, snapping, quote matching, re-anchoring, line diff, print stamping, cue sheets, change summaries) lives in `packages/core` so the browser and the API run the same code. Re-anchoring is a pg-boss job that runs after a new version's pages are ready and switches the current version afterwards. Presence is an in-memory hub behind a websocket on the API.

**Tech Stack:** The M0 stack, plus: `pdf-lib` 1.17 in `packages/core` (print and sheet export, runs in browser and Node), `fflate` 0.8 in `packages/core` (the zip container of the XLSX cue sheet; pure JavaScript, no Node or DOM dependency, small and maintained), `diff` 8 in `packages/core` (line diff), `@hono/node-ws` 1 (presence websocket), `idb-keyval` 6 (web export outbox), and as dev dependencies `ws` 8 (websocket test client) and `yaml` 2 (parses `sync-config.yaml` in a test). Pin exact versions at least as old as pnpm's minimum release age requires, as M0 did for Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-binder-platform-design.md`

**State of M0 this plan builds on.** Drafted on 2026-10-15 while M0 Tasks 14 to 17 were in progress. Interfaces confirmed in code: the service layer (`apps/api/src/services/*`, `Executor` from `services/executor.ts`, `requireShowRole`, `assertShowWritable`, `logChange`), the sync write path (`sync/apply.ts`, `sync/policy.ts`, `SyncCrudEntry` and friends in `@binder/shared`), processing (`processing/pageJob.ts` `finishVersionIfDone`, `processing/types.ts` `JobQueue`), blob keys (`blob/keys.ts`), the MCP conventions of M0 Task 14 as committed so far (`mcp/registry.ts` `TOOL_NAMES`, `OPERATION_TO_TOOL`, `UI_ONLY_OPERATIONS`; `mcp/context.ts` `McpContext` with `actor(ctx)`; `mcp/results.ts` `guarded`, `jsonResult`, `pageArgs`, `paginate`; tools registered by `register<Domain>Tools(server, mcp)` in `mcp/tools/*.ts`; `services/pages.ts` `readWordLayer`, `readableVersion`), the client schema and its parity test (`apps/web/src/powersync/schema.ts`, `schema.test.ts`), and the e2e harness (`apps/web/e2e/env.ts` `RunData`, `global-setup.ts`). Not yet present, so this plan uses the interfaces the M0 plan specifies as amended by the ledger: the viewer files of M0 Task 15 (`viewer/PageList.tsx`, `PageCanvas.tsx`, `ThumbnailRail.tsx`, `ViewerToolbar.tsx`, `coords.ts` `displayedToCss`/`cssToDisplayed`, `blobs/fetchBlob.ts`, `documents/UploadDialog.tsx`, route `shows.$showId.docs.$docId.tsx`), the search and offline files of M0 Task 16 (`viewer/PageOverlay.tsx`, `search/useDocumentSearch.ts`, `offline/prefetch.ts` `blobUrlsForShow`/`prefetchShow`, the PWA config, R19's preview-build offline specs), and the deployment of M0 Task 17 (Dockerfiles, Caddyfile, `deploy/docker-compose.yml`, and the Coolify Docker Compose application). M1 starts only after M0 is complete and deployed; where M0 Task 14 to 17 code differs in a name from what is written here, the code wins and the implementer notes it in the ledger.

**Checkpoint:** after Task 10 the build is a usable markup tool (cues, annotations, layers, undo, cue lists, renumbering). The controller may deploy it with Task 23's procedure using the reduced smoke `m1-smoke.ts --stage checkpoint`, which Task 10 creates (the full stage needs history, exports, and revisions, which come later); later tasks add history, exports, revisions, and presence on top.

## Global Constraints

Carried forward from M0 (all still bind):

- Node engines `>=22.22`; `.nvmrc` says `24`; Docker base `node:24-bookworm-slim`. pnpm pinned via `"packageManager": "pnpm@12.11.2"`. TypeScript stays on 5.x.
- `packages/core` must remain free of Node-only and browser-only dependencies so it runs in both.
- Identifiers are UUIDv7 generated on the client (`newId()` from `@binder/shared`). Every row's primary key column is `id text`.
- All show-scoped tables carry `show_id`, `created_at`, `updated_at`, `updated_by`. No soft delete.
- Coordinates everywhere are displayed page space: PDF points, origin bottom-left, after `/Rotate`. A page's stored width and height are displayed dimensions.
- Permissions table (spec 4.1): owner everything; editor show graph, documents, cues in scoped departments; viewer read plus personal layer. Show settings and memberships are owner-only.
- Sync: PowerSync upload responses are 200 with a `rejected` list for validation and permission failures; 5xx only for transient server failure. Updates are column-level patches. Every accepted change writes exactly one change log row with before and after values of the touched columns, `via`, and `agent`; a no-op writes none (R33).
- MCP: every service operation is an MCP tool or has a listed exemption with a reason. Bearer personal access tokens.
- Real show materials never enter git. `fixtures/private/` and `*.tmix` are gitignored.
- Commit after every task with a conventional-commit message, unsigned if the signer is unavailable: `git -c commit.gpgsign=false commit`.

Ledger rulings that bind M1: archived shows are read-only for every write (R7); each migration that adds a synced table extends the `powersync` publication and the `powersync_role` grant (R9); sync wire keys are Postgres column names, jsonb arrives as JSON text, booleans as 0/1, and every value Postgres would reject is rejected `invalid` up front, including NUL in text and jsonb and `clientTs` outside 2000 to 2100 (R11, R34); token show scope is enforced only in `requireShowRole` (R27), whose non-member answer is `not_found` (R41); `GET /api/sync/token` and `POST /api/sync/upload` are session-only (R28, R32); the sync apply path is a client of the service layer and services accept `batchId` and `clientTs` (R31); processing writes as `system` without change-log rows (R43) and exhausted jobs dead-letter to a terminal state (R45); e2e data is unique per run (R13); offline e2e runs against `vite build && vite preview` (R19); R20 (deploy waits for a go) is superseded for M1: Jayden asked for the deploy and set the goal "Get M1 live after M0", so Task 23 deploys without a separate go; docs and fixtures never carry real performer names (R48). Deployment facts from the ledger: the app is served at `https://binder.rvlt.app` and PowerSync at `https://binder-sync.rvlt.app`, both through a Cloudflare tunnel that terminates TLS.

From the spec, binding on M1 (verbatim):

- "**Department**: id, show, code (`LX`, `SND`, `TM`, `VID`, `SM`, `STG`, `FLY`, user-defined), name, colour, number format (`decimal` shows 10.5, `point` shows 10.50), sort order." "A new show is seeded with LX, SND, TM, VID, SM, STG, FLY. Departments can be added, renamed, and hidden."
- "**Cue**: id, show, department, major (integer), minor (integer 0 to 99), label, anchor (nullable), type (`go`, `standby`, `warn`), notes, colour, payload JSON."
- "Display: `major` alone when minor is zero, otherwise `major.minor` formatted per the department's number format. Sort order within a department is `(major, minor)`. Uniqueness of `(department, major, minor)` is not enforced by the database. Duplicates are a validation warning in the cue list and block .tmix export for the TM department until resolved."
- "Numbering convention. Jayden's standing preference, which overrides the older per-song point style seen in WAKA and Songs for a New World: each scene or song owns a block of ten (10, 20, 30), cues inside the block take the following integers (11, 12, 13), and points (14.50) are reserved for insertions made after numbering. Line checks live in the number 0 range, conventionally 0.50."
- "\"Renumber from script order\" is an explicit operation on one department within one document. It orders cues by anchor reading order, groups them by the scene or song resolved from the anchor, assigns each group's first cue the next multiple of the block size (default 10) and the rest consecutive integers, and resets minors to zero. Cues that would not fit in a block (more than nine inside one song at block size 10) spill into points and are flagged. Unplaced cues are untouched. Importing a file never renumbers; existing numbers are preserved exactly."
- "A cue with a null anchor is \"unplaced\". It appears in cue lists and exports but not on any page." "Other departments' payloads are empty objects in version one."
- Anchor: `{ documentId, documentVersionId, pageIndex, x, y, text?: { quote, wordStart, wordEnd }, status: 'ok' | 'approximate' | 'unresolved' }`, "set by re-anchoring, 'ok' when placed by hand". "Reading order within a document version is `(pageIndex ascending, pageHeight minus y ascending)`."
- "**Annotation**: id, show, layer kind (`department`, `personal`), layer id (department id or user id), anchor, type (`note`, `rect`, `ellipse`, `line`, `arrow`, `stamp`, `highlight`), geometry JSON (in PDF points), text, style JSON." "Stamps are chosen from a per-show stamp set (defaults: Enter, Exit, Fly in, Fly out, Blackout, Standby, Go). Highlights reference a word range through the anchor's text field."
- Layers (4.11): "There is no shared \"everyone\" layer." "an editor can create, move, and delete cues and annotations only on layers for departments in their membership scope. Everyone can edit their own personal layer. Owners can edit every layer." "every member can see every department layer. Visibility toggles per layer are per user and per device, remembered locally. Personal layers are visible only to their owner." "The active layer is always one the user can edit." "Locking is local and does not affect others." "Cue markers, labels, highlights, and presence outlines all use [the department colour]." "every export takes a layer selection." "numbers are unique per department, never across layers."
- Snapping (5.2): "dropping a cue within 12 points of a text line snaps its y to the line and captures the text anchor (the nearest word and a quote of up to eight words). A toolbar toggle overrides the document default for the session. The quote doubles as the cue's trigger text on cue sheets." "Keyboard: next and previous cue, place cue in the active department, jump to page."
- Print (5.3): "Page size is unchanged and the invisible text layer survives" "Every page gets a footer with the show title, document and version label, layer selection, binder version, and date." "Each export creates an ExportRecord."
- Sheets (7): cue sheet exports are "PDF, XLSX, CSV". "PDF exports are laid out for A4 and Letter, chosen per show" "XLSX is generated with one sheet per table and real cell types (numbers as numbers), so it opens cleanly in Excel and Google Sheets. CSV is UTF-8 with a byte order mark so Excel reads it." "Every export creates an ExportRecord (4.12) and runs on the client, so it works offline."
- Change log (4.12): "Append-only, written only by the API write path, never synced to clients." "Offline, history is unavailable and the UI says so." "\"Revert this change\" issues an ordinary write restoring the before values, so the revert is itself logged and revertable. Reverting requires edit rights on that row's layer or table." "Personal undo is separate: an in-session stack of the user's own edits, applied as new writes. It never undoes someone else's change."
- Revisions (5.4, 8): "Re-anchoring never deletes a cue; a cue that cannot be placed is `unresolved`, not lost." "Re-anchoring: never fails as a whole. Each anchor ends `ok`, `approximate`, or `unresolved`, and the run is one revertable batch."
- Presence (3.9): "Clients send on change and every five seconds; the server fans out to the show and drops a user after fifteen seconds of silence." "Presence is best-effort and silently absent offline." Presence carries "a colour" per user (3.9) while 4.11 lists "presence outlines" among the things that use the department colour; this plan reads 3.9 as governing presence: avatars and selection outlines use the peer's per-user colour, and cue markers, labels, and highlights keep the department colour. Real-time target: "under two seconds from one client's edit to another's screen when both are online."
- MCP (3.10): "Operations that are hard to reverse (restore a snapshot, delete a document, delete more than ten rows in one call) return `CONFIRMATION_REQUIRED` with a plain-language summary unless called with `confirm: true`". "The AI-native placement tool `place_cue_at_text` takes a quote and a department and anchors a cue where that text occurs, with disambiguation when the quote appears more than once".
- Errors (8): "Sync rejection: the API returns rejected operations with a reason code; the client reverts the local row and shows a notice naming the row. Never a blocked queue." "Cue number collisions are a warning, not an error."

## Suggested models per task

Default Sonnet, medium effort. Sonnet high where a rule set must be exactly right but the mechanics are ordinary: Task 1 (layer permission matrix), Task 4 (personal-layer privacy), Task 9 (personal undo), Task 11 (history and revert), Task 13 (print stamping with rotation), Task 14 (export privacy), Task 19 (revisions services), Task 20 (revisions screens), Task 22 (presence client). Opus high for the genuinely subtle ones: Task 3 (sync of client-created rows, chunking, batch ids), Task 7 (cue overlay interaction), Task 8 (annotation tools, move and resize), Task 17 (re-anchoring matcher), Task 18 (re-anchoring job), Task 21 (presence server). Never Fable. Reviewers Sonnet medium, Sonnet high for the Opus tasks; final whole-branch review Opus high.

## MCP parity rule for M1

A task that adds an exported service operation registers its MCP tool in the same task (adding the tool name to `TOOL_NAMES` and the operation to `OPERATION_TO_TOOL`), or lists the operation in `UI_ONLY_OPERATIONS` with a reason. There are no temporary exemptions: `apps/api/test/mcpParity.test.ts` passes at every task boundary. Internal helpers (permission guards, loaders, unchecked writers) are imported from their module and never exported from `services/index.ts`, so the parity test does not see them.

## Review Focus

Failure modes the spec implies that a casual implementation would miss, most likely first. Each has a pinned test, with its key assertion written out as code, in the owning task.

1. **Replayed, reordered, and oversized uploads of client-created rows.** PowerSync replays a batch whose response was lost, uploads a PATCH or DELETE for a row whose PUT was rejected, races two PUTs of one id, and a renumber or grouped undo can produce a transaction of hundreds of entries. The queue must never wedge (no 4xx or 503 for a deterministic failure, no request over the route's entry cap), never duplicate a row, never log a change twice, and a stale PUT replay must not overwrite a collaborator's newer edit. Pinned in Task 3 (`a replayed batch after a lost response applies once and logs once`, `concurrent PUTs of one id yield one row`, `PATCH after a rejected PUT is not_found and the batch is still 200`, `a replayed PUT does not overwrite a collaborator's newer label`, `uploads 1,200 entries as three ordered chunks`) and Task 10 (`600 renumbered cues upload cleanly`).
2. **A personal-layer annotation reaches nobody but its author**, through any channel: the sync stream, the list and get services and MCP tools, history and the activity feed, the re-anchoring review list, version anchors, and export records and their blobs. Pinned in Task 4 (services and MCP), Task 8 (sync, e2e), Task 11 (history and activity), Task 14 (export list, blob, and MCP resource), and Task 19 (review list).
3. **A revision lands while someone is offline.** Cues an offline editor places on the superseded version must not vanish: they keep their anchor, show on the cue list, and appear in the review list under "On an older version", from which "Re-anchor" places them on the current version. Pinned in Task 19.
4. **Print export of a rotated or offset page and of labels outside WinAnsi.** A cue at the displayed top-left of a `/Rotate 90` page, or of a page whose crop box does not start at the origin, prints at the top-left; a label with "✓" or "東京" prints "?" instead of throwing; the invisible text layer survives. Pinned in Task 13.
5. **Undo and revert after a collaborator's edit, and reverting someone else's batch.** Personal undo of a cue someone else has since relabelled must not overwrite their label (JSON columns compared as values, not text); reverting an old change whose field has since changed must refuse unless forced; two users whose clients reuse a batch id must never be reverted together. Pinned in Task 9 and Task 11.

## File structure

```
packages/shared/src/{markup.ts, layers.ts, markupSchemas.ts, presence.ts}        # anchor and layer types, the permission matrix, Zod schemas, presence protocol
packages/core/src/cues/{numbering.ts, renumber.ts}                                 # format, parse, suggest, renumber by blocks
packages/core/src/anchors/{order.ts, types.ts, snap.ts, quote.ts, reanchor.ts, lineDiff.ts}
packages/core/src/markup/markers.ts                                                # marker text and style shared by screen and print
packages/core/src/history/summarise.ts                                             # activity feed sentences
packages/core/src/json/jsonEqual.ts                                                # key-order-insensitive JSON equality (undo, revert, sync)
packages/core/src/print/{winAnsi.ts, footer.ts, stampItems.ts, stampScript.ts}
packages/core/src/cues/cueList.ts  packages/core/src/sheets/{cueSheet.ts, xlsx.ts}  # cue list rows; cue sheet CSV, PDF, XLSX
packages/core/test/textLayers.ts                                                   # synthetic word layers from text (tests only)
packages/db/src/schema/{markup.ts, exports.ts}  packages/db/src/synced.ts          # departments, cues, annotations, export_records; SYNCED_TABLES
apps/api/src/services/{departments.ts, layers.ts, cues.ts, annotations.ts, wordLayers.ts, placement.ts, renumber.ts, history.ts, revert.ts, exports.ts, anchorWrites.ts, revisions.ts}
apps/api/src/routes/{departments.ts, history.ts, exports.ts, revisions.ts, presence.ts}
apps/api/src/processing/reanchorJob.ts  apps/api/src/presence/hub.ts
apps/api/src/mcp/confirm.ts  apps/api/src/mcp/tools/{departments.ts, cues.ts, annotations.ts, history.ts, exports.ts, revisions.ts}  apps/api/src/mcp/resources/exports.ts
apps/api/test/mcpHelpers.ts  apps/api/test/processingHelpers.ts  apps/api/test/markupHelpers.ts
apps/web/src/markup/*          # departments and membership hooks, mutations, overlay, markers, layer panel, tools, cue and annotation editors, shortcuts
apps/web/src/powersync/{uploadChunks.ts, deviceId.ts, rowLabel.ts, devHooks.ts}
apps/web/src/undo/undoStack.ts
apps/web/src/cuelist/*  apps/web/src/history/*  apps/web/src/exports/*  apps/web/src/revisions/*  apps/web/src/presence/*
apps/web/src/routes/{shows.$showId.settings.tsx, shows.$showId.cues.tsx, shows.$showId.activity.tsx, shows.$showId.exports.tsx, shows.$showId.docs.$docId.compare.tsx}
apps/web/e2e/{markupSync, markup, annotations, cuelist, history, export, revisions, presence}.spec.ts
fixtures/scripts/revisions.ts  deploy/scripts/m1-smoke.ts
```

Migrations are generated with `pnpm --filter @binder/db drizzle-kit generate`; publication, grant, and backfill SQL goes in a custom migration created with `drizzle-kit generate --custom --name=<name>`, following `0003_publication.sql` (conditional `DO` blocks). After changing `deploy/powersync/sync-config.yaml` in development, restart the service: `docker compose -f deploy/docker-compose.dev.yml restart powersync`.

---

### Task 1: Departments, the layer permission matrix, and membership scope

**Files:**
- Create: `packages/shared/src/markup.ts`, `packages/shared/src/layers.ts`, `packages/db/src/schema/markup.ts`, `packages/db/src/synced.ts`, the generated migration, custom migration `departments_sync`, `apps/api/src/services/departments.ts`, `apps/api/src/services/layers.ts`, `apps/api/src/routes/departments.ts`, `apps/api/src/mcp/tools/departments.ts`, `apps/api/test/mcpHelpers.ts`, `apps/web/src/markup/useDepartments.ts`, `apps/web/src/markup/useMembership.ts`, `apps/web/src/routes/shows.$showId.settings.tsx`
- Modify: `packages/shared/src/index.ts`, `packages/db/package.json` (dev dependency `yaml`), `packages/db/src/schema/{changeLog.ts,index.ts}`, `packages/db/src/index.ts` (export `SYNCED_TABLES`), `apps/api/src/services/{changeLog.ts,tenancy.ts,index.ts}`, `apps/api/src/app.ts`, `apps/api/src/mcp/{registry.ts,server.ts,tools/shows.ts}`, `apps/api/test/mcp.test.ts` (use `mcpHelpers`), `deploy/powersync/sync-config.yaml`, `apps/web/src/powersync/{schema.ts,schema.test.ts}`
- Test: `packages/shared/src/layers.test.ts`, `packages/db/test/publication.test.ts`, `apps/api/test/departments.test.ts`, `apps/api/test/mcpDepartments.test.ts`

**Interfaces:**
- Consumes: `requireShowRole`, `assertShowWritable`, `logChange`, `createShow`, `addShowMember` (M0).
- Produces, `@binder/shared` `markup.ts`: `type NumberFormat = 'decimal' | 'point'`; `type CueType = 'go' | 'standby' | 'warn'`; `type AnchorStatus = 'ok' | 'approximate' | 'unresolved'`; `interface TextAnchor { quote: string; wordStart: number; wordEnd: number }` (word indices into the page's `words`, inclusive; `-1` for both means "unbound", see Task 17); `interface Anchor { documentId: string; documentVersionId: string; pageIndex: number; x: number; y: number; text?: TextAnchor; status: AnchorStatus }`; `interface CueNumber { major: number; minor: number }`; `type LayerKind = 'department' | 'personal'`; `interface LayerRef { kind: LayerKind; id: string }` (department id or user id); `layerKey(l: LayerRef): string` (`'department:<id>'`, `'personal:<userId>'`); `parseLayerKey(k: string): LayerRef | null`; `type AnnotationType = 'note' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'stamp' | 'highlight'`; constants `SNAP_DISTANCE_PT = 12`, `QUOTE_MAX_WORDS = 8`, `DEFAULT_BLOCK_SIZE = 10`, `PERSONAL_LAYER_COLOUR = '#6B7280'`, `DEFAULT_STAMPS = ['Enter', 'Exit', 'Fly in', 'Fly out', 'Blackout', 'Standby', 'Go']`, and `DEFAULT_DEPARTMENTS` (code, name, colour, numberFormat, in this order, sort order = index × 10): LX Lighting `#F5A623` decimal; SND Sound `#4A90E2` decimal; TM TheatreMix `#9B51E0` point; VID Video `#2BB0A6` decimal; SM Stage management `#D0021B` decimal; STG Stage `#8B572A` decimal; FLY Flys `#417505` decimal.
- Produces, `layers.ts`: `interface MembershipScope { role: Role; departments: string[] }` (`['*']` or department ids); `canSeeLayer(userId: string, layer: LayerRef): boolean`; `canEditLayer(m: MembershipScope, userId: string, layer: LayerRef): boolean`. The matrix (archived shows are refused separately, server side):

  | layer | owner | editor, department in scope or `*` | editor, out of scope | viewer |
  |---|---|---|---|---|
  | department | edit | edit | read | read |
  | own personal | edit | edit | edit | edit |
  | another user's personal | invisible | invisible | invisible | invisible |

- Produces, db: `departments(id, show_id → shows cascade, code text, name text, colour text, number_format text default 'decimal', sort_order integer default 0, hidden boolean default false, created_at, updated_at, updated_by)` unique `(show_id, code)`, index `show_id`; `change_log.layer text` nullable (a `layerKey`, or null for rows outside layers) and index `(show_id, row_id, seq)`; `SYNCED_TABLES: readonly string[]` = `['shows', 'show_memberships', 'documents', 'document_versions', 'pages', 'departments']`, appended to by later tasks. The custom migration adds `departments` to the publication and grant (each in a `DO` block that skips when already present or when `powersync_role` is absent) and backfills `DEFAULT_DEPARTMENTS` for every show that has no departments (`gen_random_uuid()::text` ids, `updated_by 'system'`, guarded by `WHERE NOT EXISTS`, so re-running it is a no-op).
- Produces, services: `logChange` entries gain `layer?: string | null`. `createShow` seeds `DEFAULT_DEPARTMENTS` in its transaction, each logged as an insert with layer `department:<id>`. `addShowMember` rejects department ids not in the show (`invalid`). New in `tenancy.ts`: `listShowMembers(db: Executor, actor: Actor, input: { showId: string }): Promise<Array<{ membershipId: string; userId: string; name: string; email: string | null; role: Role; departments: string[] }>>` (viewer; `email` only when the actor is an owner, `null` otherwise); `updateShowMember(db: Executor, actor: Actor, input: { membershipId: string; role?: Role; departments?: string[]; batchId?: string }): Promise<ShowMembership>` (owner; refused on archived shows through `assertShowWritable`; departments `['*']` or a non-empty list of this show's department ids, else `invalid`; demoting the last owner is `conflict`; logged on `show_memberships`). Departments are never deleted (hiding is the supported route), and Task 2 makes `cues.department_id` `ON DELETE RESTRICT` so a stray delete cannot cascade away cues.
- Produces, `departments.ts`: `type Department = InferSelectModel<typeof departments>`; `listDepartments(db: Executor, actor: Actor, input: { showId: string }): Promise<Department[]>` (viewer; by `sort_order`, then `code`); `createDepartment(db: Executor, actor: Actor, input: { showId: string; code: string; name: string; colour: string; numberFormat?: NumberFormat; sortOrder?: number; batchId?: string }): Promise<Department>` (owner; code trimmed, upper-cased, must match `/^[A-Z][A-Z0-9]{0,7}$/`; duplicate code `conflict`; name 1 to 60 characters; colour `/^#[0-9A-Fa-f]{6}$/`; default sort order is max + 10); `updateDepartment(db: Executor, actor: Actor, input: { departmentId: string; patch: { code?: string; name?: string; colour?: string; numberFormat?: NumberFormat; sortOrder?: number; hidden?: boolean }; batchId?: string; clientTs?: Date }): Promise<Department>` (owner). Department rows log with layer `department:<id>`.
- Produces, internal `layers.ts` (not in the barrel): `getMembershipScope(db: Executor, actor: Actor, showId: string): Promise<MembershipScope>` (calls `requireShowRole(viewer)` first, so scope and existence-hiding apply); `requireLayerEdit(db: Executor, actor: Actor, showId: string, layer: LayerRef): Promise<void>` (loads the show and calls `assertShowWritable`; a department layer whose department is not in the show is `invalid`; another user's personal layer is `not_found`; otherwise `forbidden` when `canEditLayer` is false).
- Routes (behind `requireUser`): `GET /api/shows/:showId/departments`, `POST /api/shows/:showId/departments`, `PATCH /api/departments/:departmentId`, `GET /api/shows/:showId/members`, `PATCH /api/memberships/:membershipId`. Departments are edited online through these routes and the MCP; they sync to clients read-only (no sync write policy in M1).
- MCP (`tools/departments.ts`, `registerDepartmentTools(server, mcp)`): `list_departments {showId}` (read), `create_department {showId, code, name, colour, numberFormat?}`, `update_department {departmentId, code?, name?, colour?, numberFormat?, sortOrder?, hidden?}`, `list_show_members {showId}` (read), `update_show_member {membershipId, role?, departments?}` where `departments` accepts codes or ids (resolved through `listDepartments`; `'*'` allowed). `add_show_member` in `tools/shows.ts` gains the same code resolution.
- Test helpers, `apps/api/test/mcpHelpers.ts`: `connectMcp(app: Hono<AppEnv>, token: string, client?: { name: string; version: string }): Promise<Client>` and `callTool(client, name, args): Promise<{ isError?: boolean; content: Json[]; structuredContent?: Json }>`, extracted from the `connect`/`call` functions in `mcp.test.ts` (which then imports them).
- Web: `type DepartmentRow = Database['departments']` (the client schema row); `useDepartments(showId): DepartmentRow[]` (`SELECT * FROM departments WHERE show_id = ? ORDER BY sort_order, code`); `useMembership(showId): (MembershipScope & { userId: string }) | null` from the local `show_memberships` row (departments parsed from JSON text); `/shows/$showId/settings` lists departments (owner: add, rename, recolour, number format, hide) and members (owner: role and departments), read-only for everyone else, nested under the show route the way `shows.$showId.docs.$docId.tsx` is.

- [ ] **Step 1: Write the failing shared tests**

```ts
// packages/shared/src/layers.test.ts
const LX = { kind: 'department', id: 'lx' } as const, SND = { kind: 'department', id: 'snd' } as const
const mine = { kind: 'personal', id: 'u1' } as const, theirs = { kind: 'personal', id: 'u2' } as const
test.each([
  ['owner', ['*'], LX, true], ['owner', ['*'], mine, true], ['owner', ['*'], theirs, false],
  ['editor', ['*'], SND, true], ['editor', ['lx'], LX, true], ['editor', ['lx'], SND, false],
  ['editor', ['lx'], mine, true], ['editor', ['lx'], theirs, false],
  ['viewer', ['*'], LX, false], ['viewer', ['*'], mine, true], ['viewer', ['*'], theirs, false],
] as const)('%s scoped %j editing %j is %s', (role, departments, layer, ok) =>
  expect(canEditLayer({ role, departments: [...departments] }, 'u1', layer)).toBe(ok))
test('department layers are visible to everyone, personal layers only to their owner', () => {
  expect(canSeeLayer('u2', LX)).toBe(true); expect(canSeeLayer('u1', mine)).toBe(true); expect(canSeeLayer('u1', theirs)).toBe(false)
})
test('layer keys round-trip and reject unknown kinds', () => {
  expect(layerKey(LX)).toBe('department:lx'); expect(parseLayerKey('personal:u1')).toEqual(mine); expect(parseLayerKey('team:x')).toBeNull()
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run packages/shared`
Expected: FAIL, `./layers` not found.

- [ ] **Step 3: Implement `markup.ts`, `layers.ts`, export both from the index; run until PASS**

- [ ] **Step 4: Write the failing API, db, and MCP tests**

```ts
// apps/api/test/departments.test.ts (setupShow from documentHelpers)
test('a new show is seeded with LX, SND, TM, VID, SM, STG, FLY', async () => {
  const depts = await listDepartments(db, ownerActor, { showId })
  expect(depts.map((d) => d.code)).toEqual(['LX', 'SND', 'TM', 'VID', 'SM', 'STG', 'FLY'])
  expect(depts.find((d) => d.code === 'TM')!.numberFormat).toBe('point')
  expect(depts.filter((d) => d.code !== 'TM').every((d) => d.numberFormat === 'decimal')).toBe(true)
})
test('the backfill seeds shows created before departments existed and is idempotent', ...)   // insert a bare shows row, execute the custom migration SQL twice, expect 7 departments
test('owner creates and renames a department; editor and viewer are forbidden', ...)
test('code is upper-cased, must match /^[A-Z][A-Z0-9]{0,7}$/, and is unique per show (conflict)', ...)   // ' pyro ' -> 'PYRO'; 'LX' again -> conflict; '9X' -> invalid
test('colour must be #RRGGBB', ...)                                                              // 'red' -> invalid
test('department changes are logged with layer department:<id>', ...)
test('updateShowMember scopes an editor; ids from another show are invalid; the last owner cannot be demoted; an archived show refuses it', ...)
test('addShowMember rejects department ids from another show', ...)
test('requireLayerEdit enforces the matrix, hides other personal layers, and refuses archived shows', async () => {
  // editor scoped to [LX]: LX ok, SND forbidden, own personal ok, owner's personal not_found
  // viewer: LX forbidden, own personal ok; after archiving: owner on LX forbidden
})
test('HTTP: PATCH /api/departments/:id as editor is 403; GET members as viewer lists names and departments with email null; as owner with emails', ...)
// packages/db/test/publication.test.ts
test('the publication and grant cover exactly SYNCED_TABLES and sync-config streams each of them', ...)  // pg_publication_tables; parse deploy/powersync/sync-config.yaml with `yaml`; every table has a `FROM <table>` query
// apps/api/test/mcpDepartments.test.ts
test('list_departments returns the seeded codes; create_department by an editor token is an isError forbidden', ...)
test('update_show_member accepts department codes and stores department ids', ...)
```

The web parity test's `SYNCED` list gains `departments`.

- [ ] **Step 5: Run to verify they fail**

Run: `pnpm vitest run packages/db apps/api/test/departments.test.ts apps/api/test/mcpDepartments.test.ts apps/api/test/mcpParity.test.ts apps/web/src/powersync`
Expected: FAIL.

- [ ] **Step 6: Implement schema, migrations, services, routes, MCP tools, sync config, and client schema**

`sync-config.yaml` `show_data` gains `SELECT * FROM departments WHERE show_id IN user_shows`. Client schema `departments` table: text columns plus `sort_order` and `hidden` integer, index `show: ['show_id']`. Restart PowerSync in dev.

- [ ] **Step 7: Run the tests to verify they pass**

Run: the Step 5 command, then `pnpm vitest run apps/api` (the seeding touches every test that creates a show).
Expected: PASS.

- [ ] **Step 8: Build the settings screen and check it by hand**

Run: `pnpm --filter @binder/web dev`; as an owner open `/shows/<id>/settings`, add `PYRO`, hide `VID`, scope an editor to SND. As the editor the page is read-only.

- [ ] **Step 9: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(markup): departments, layer permissions, and membership scope"
```

---

### Task 2: Cue numbering and the cue model

**Files:**
- Create: `packages/core/src/cues/numbering.ts`, `packages/core/src/anchors/order.ts`, `packages/core/src/json/jsonEqual.ts`, `packages/shared/src/markupSchemas.ts`, the generated migration, custom migration `cues_sync`, `apps/api/src/services/cues.ts`, `apps/api/src/mcp/tools/cues.ts`, `apps/api/src/mcp/confirm.ts`, `apps/api/test/markupHelpers.ts`
- Modify: `packages/core/src/index.ts`, `packages/shared/{package.json,src/index.ts,src/markup.ts}` (add `zod`), `packages/db/src/schema/markup.ts`, `packages/db/src/synced.ts`, `apps/api/src/services/index.ts`, `apps/api/src/mcp/{registry.ts,server.ts}`, `deploy/powersync/sync-config.yaml`, `apps/web/src/powersync/{schema.ts,schema.test.ts}`
- Test: `packages/core/src/cues/numbering.test.ts`, `packages/core/src/anchors/order.test.ts`, `packages/core/src/json/jsonEqual.test.ts`, `apps/api/test/cues.test.ts`, `apps/api/test/mcpCues.test.ts`

**Interfaces:**
- Consumes: Task 1's `Anchor`, `CueType`, `NumberFormat`, `requireLayerEdit`, `listDepartments`.
- Produces, core: `formatCueNumber(major: number, minor: number, format: NumberFormat): string`; `parseCueNumber(text: string): CueNumber | null` (a decimal with at most two decimal places read as hundredths; major 0 to 9999); `compareCueNumbers(a: CueNumber, b: CueNumber): number`; `findDuplicateNumbers(cues: Array<{ id: string; departmentId: string; major: number; minor: number }>): Set<string>`; `suggestCueNumber(prev: CueNumber | null, next: CueNumber | null, blockSize = DEFAULT_BLOCK_SIZE): CueNumber`; `compareReadingOrder(a: { pageIndex: number; y: number }, b: { pageIndex: number; y: number }): number` (page ascending, then y descending, which is the spec's `pageHeight − y` ascending within a page); `jsonEqual(a: unknown, b: unknown): boolean` (deep equality of JSON values, object key order ignored, arrays ordered) and `columnEqual(a: unknown, b: unknown): boolean` (parses either side first when it is a string that parses as a JSON object or array, then `jsonEqual`), used by the services' no-op checks on `anchor`, `geometry`, and `style`, by undo (Task 9), and by revert (Task 11).
- `suggestCueNumber` works in hundredths (`v = major × 100 + minor`), `p` from `prev` (0 when null), `n` from `next` (ignored when null or `n <= p`):

```
no prev and no next      -> { blockSize, 0 }
no usable next           -> { floor(p / 100) + 1, 0 }
c = (floor(p / 100) + 1) * 100;  if c < n -> c          (the next integer fits)
else the multiple of 50 strictly between p and n nearest (p + n) / 2, lower on a tie;
else the multiple of 10 likewise; else floor((p + n) / 2) if p < it < n;
else prev unchanged (a duplicate, which the cue list flags)
```

- Produces, shared `markup.ts`: `interface CueFields { departmentId: string; major: number; minor: number; label: string; type: CueType; notes: string; colour: string | null; anchor: Anchor | null }` (the web mutations, print, and services all use it).
- Produces, shared `markupSchemas.ts` (Zod 4, every string refuses NUL): `anchorSchema` (ids 1 to 200 characters; `pageIndex` integer 0 to 100000; `x`, `y` finite 0 to 14400; optional `text` with `quote` 1 to 400 characters, `wordStart` integer `>= -1`, `wordEnd >= wordStart`; `status` enum); `cueFieldsSchema` = `{ departmentId, major: int 0..9999, minor: int 0..99, label: max 200, type: CueType, notes: max 10000, colour: /^#[0-9A-Fa-f]{6}$/ or null, anchor: anchorSchema or null }`.
- Produces, db: `cues(id, show_id → shows cascade, department_id → departments ON DELETE RESTRICT, major integer not null, minor integer not null default 0, label text not null default '', anchor jsonb, type text not null default 'go', notes text not null default '', colour text, payload jsonb not null default '{}', created_at, updated_at, updated_by)`, check `minor between 0 and 99 and major >= 0`, indexes `show_id`, `department_id`, and the expression `(anchor->>'documentVersionId')`. `SYNCED_TABLES` gains `cues`; the custom migration publishes and grants it.
- Produces, services `cues.ts`: `type Cue = InferSelectModel<typeof cues>`; `type CueView = Cue & { departmentCode: string; display: string; duplicate: boolean }`;
  - `createCue(db: Executor, actor: Actor, input: { showId: string; id?: string; departmentId: string; number?: CueNumber; label?: string; type?: CueType; notes?: string; colour?: string | null; anchor?: Anchor | null; batchId?: string; clientTs?: Date }): Promise<Cue>`: `id` must be a UUID when given (`invalid`) and unused (`conflict`); without `number` it uses `suggestCueNumber` with the same department's cues on the same document version as neighbours in reading order (unplaced: `prev` = the department's highest number);
  - `updateCue(db: Executor, actor: Actor, input: { cueId: string; patch: Partial<CueFields>; batchId?: string; clientTs?: Date }): Promise<Cue>` (changing department needs edit rights on both layers);
  - `deleteCues(db: Executor, actor: Actor, input: { cueIds: string[]; batchId?: string; clientTs?: Date }): Promise<{ deleted: string[] }>` (all or nothing: one refused cue refuses the call);
  - `getCue(db: Executor, actor: Actor, input: { cueId: string }): Promise<CueView>`; `listCues(db: Executor, actor: Actor, input: { showId: string; departmentId?: string; documentId?: string; placed?: boolean }): Promise<CueView[]>` sorted by department sort order then `(major, minor)`.
  - Every write: validates with `cueFieldsSchema`; checks the department belongs to the show and the anchor target with an internal `assertAnchorTarget(tx, showId, anchor)` (the version exists, belongs to `anchor.documentId`, the document belongs to the show, and `pageIndex < page_count` once the version is ready; else `invalid`); calls `requireLayerEdit`; logs layer `department:<departmentId>`. Inserts log every `CueFields` key in `after`; deletes log every `CueFields` key in `before`; updates log only changed keys (camelCase, like M0). `payload` is not writable in M1 and stays `{}`.
  - Internal (not in the barrel): `loadCueRow(db: Executor, id: string): Promise<Cue | null>` for the sync policy.
- Produces, `mcp/confirm.ts`: `CONFIRM_THRESHOLD = 10`; `confirmationRequired(summary: string): CallToolResult` returning `isError: true`, `structuredContent: { code: 'CONFIRMATION_REQUIRED', summary }`, and the text `CONFIRMATION_REQUIRED: <summary> Call again with confirm: true to proceed.`
- Produces, MCP `tools/cues.ts` (`registerCueTools(server, mcp)`): `list_cues {showId, department?, documentId?, placed?, cursor?, limit?}` (read, paginated with `paginate`); `get_cue {cueId}` (read); `create_cue {showId, department, number?: string, label?, type?, notes?, colour?, anchor?: { documentId, pageIndex, x, y }}` (the version is the document's current version and status `ok`); `update_cue {cueId, number?, label?, type?, notes?, colour?, department?, anchor?}`; `delete_cues {cueIds, confirm?}` (more than `CONFIRM_THRESHOLD` ids without `confirm: true` returns `confirmationRequired` naming the count and departments, and deletes nothing). `department` accepts a code or an id; `number` goes through `parseCueNumber` (`invalid` when null). Every cue in a result carries `display` and `departmentCode`.
- Test helpers, `apps/api/test/markupHelpers.ts`: `setupMarkupShow(): Promise<Setup & { depts: Record<string, Department>; docId: string; versionId: string; editorLx: { id, cookie }; actors: { owner: Actor; editor: Actor; editorLx: Actor; viewer: Actor } }>`, extending `setupShow` with a libretto document whose version row is marked `ready` with `page_count = 20` and twenty page rows (612 × 792), and an editor scoped to LX. No processing runs.

- [ ] **Step 1: Write the failing core tests**

```ts
test.each([[10, 0, 'decimal', '10'], [10, 50, 'decimal', '10.5'], [10, 50, 'point', '10.50'], [10, 5, 'decimal', '10.05'],
  [10, 5, 'point', '10.05'], [0, 50, 'point', '0.50'], [14, 10, 'decimal', '14.1']] as const)('formats %i.%i %s as %s', (M, m, f, s) => expect(formatCueNumber(M, m, f)).toBe(s))
test.each([['14', [14, 0]], ['14.5', [14, 50]], ['14.50', [14, 50]], ['14.05', [14, 5]], ['0.5', [0, 50]], [' 12 ', [12, 0]]] as const)(
  'parses %j', (s, [major, minor]) => expect(parseCueNumber(s)).toEqual({ major, minor }))
test.each(['', '-1', '14.123', '1e3', '14.', '.5', 'abc', '10000', '1.2.3'])('rejects %j', (s) => expect(parseCueNumber(s)).toBeNull())
test.each([
  [null, null, [10, 0]], [[12, 0], null, [13, 0]], [[12, 0], [20, 0], [13, 0]], [[12, 0], [13, 0], [12, 50]],
  [[12, 50], [13, 0], [12, 70]], [[12, 98], [12, 99], [12, 98]], [null, [10, 0], [1, 0]], [[13, 0], [12, 0], [14, 0]],
] as const)('suggests between %j and %j: %j', (p, n, [major, minor]) =>
  expect(suggestCueNumber(p && { major: p[0], minor: p[1] }, n && { major: n[0], minor: n[1] })).toEqual({ major, minor }))
test('duplicates are per department, major and minor', ...)   // LX 10, LX 10, TM 10 -> the two LX ids only
test('reading order is page ascending then y descending', ...)
test('jsonEqual ignores key order and columnEqual parses JSON text', () => {
  expect(jsonEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true)
  expect(columnEqual('{"x": 1, "y":2}', { y: 2, x: 1 })).toBe(true)
  expect(columnEqual('{"x":1}', '{"x":2}')).toBe(false)
})
```

- [ ] **Step 2: Run to verify they fail**, then **Step 3: Implement**, then **Step 4: Run to verify they pass**

Run: `pnpm vitest run packages/core`

- [ ] **Step 5: Write the failing API and MCP tests**

```ts
// apps/api/test/cues.test.ts (setupMarkupShow)
test('an LX editor creates an LX cue; the change log insert has layer department:<LX> and every field', ...)
test('the LX editor cannot create, move into, or delete SND cues (forbidden); a viewer cannot create cues', ...)
test('an anchor on another show\'s version, or pageIndex 20 on a 20-page version, is invalid', ...)
test('minor 100, major -1, colour "red", and NUL in the label are invalid', ...)
test('without a number the cue takes suggestCueNumber from reading-order neighbours', async () => {
  // LX 10 at page 0 y 700, LX 11 at page 1 y 700; new LX cue at page 0 y 300 -> { major: 10, minor: 50 }
})
test('a client id is used as given; reusing it is conflict; a non-UUID id is invalid', ...)
test('listCues sorts by (major, minor), flags duplicates, and formats per number format', async () => {
  // TM 14.50 -> display '14.50'; LX 14.50 -> '14.5'; two LX 12 -> duplicate true on both
})
test('updateCue logs only changed columns and a no-op writes no row', ...)
test('an archived show refuses cue writes', ...)
test('deleting a department that still has cues fails at the database (RESTRICT)', ...)
test('a token scoped to another show cannot read these cues (forbidden)', ...)
// apps/api/test/mcpCues.test.ts
test('create_cue by department code and number "14.5" returns display and id; list_cues paginates', ...)
test('delete_cues with eleven ids returns CONFIRMATION_REQUIRED and deletes nothing; with confirm it deletes all', ...)
test('cue writes through MCP log via mcp with the client name as agent', ...)
```

- [ ] **Step 6: Run to verify they fail**

Run: `pnpm vitest run apps/api/test/cues.test.ts apps/api/test/mcpCues.test.ts apps/api/test/mcpParity.test.ts packages/db apps/web/src/powersync`

- [ ] **Step 7: Implement schema, migrations, services, MCP tools, sync stream, client schema**

`sync-config.yaml` gains `SELECT * FROM cues WHERE show_id IN user_shows`. Client schema `cues`: `anchor` and `payload` text, `major`/`minor` integer, indexes `show: ['show_id']`, `department: ['department_id']`.

- [ ] **Step 8: Run the tests to verify they pass**, then **Step 9: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(markup): cue numbering, cue model, services, and MCP tools"
```

---

### Task 3: Sync writes for client-created rows

**Files:**
- Create: `apps/web/src/powersync/{uploadChunks.ts,deviceId.ts,rowLabel.ts,devHooks.ts}`, `apps/web/e2e/markupSync.spec.ts`
- Modify: `packages/shared/src/sync.ts` (reason `'conflict'`; optional `chunk` on `SyncUploadRequest`), `packages/db/src/schema/sync.ts` (new: `syncAppliedChunks`, not published to PowerSync) plus a generated migration, `apps/api/src/processing/queue.ts` (daily `sync-chunk-gc` schedule), `apps/api/src/routes/sync.ts` (batch id grammar and prefix), `apps/api/src/sync/{policy.ts,apply.ts}`, `apps/web/package.json` (`@binder/core`, if M0 Task 16 has not added it), `apps/web/src/powersync/{connector.ts,provider.tsx,ownership.ts}`, `apps/web/e2e/{global-setup.ts,env.ts}`
- Test: `apps/api/test/syncMarkup.test.ts`, `apps/web/src/powersync/{connector,rowLabel}.test.ts`, `apps/web/e2e/markupSync.spec.ts`

**Interfaces:**
- Consumes: Task 2's `createCue`, `updateCue`, `deleteCues`, `loadCueRow`, `cueFieldsSchema`.
- Produces, `policy.ts`:

```ts
interface WriteInput { id: string; data: Record<string, unknown>; batchId: string; clientTs?: Date }
interface SyncTablePolicy {
  ops: readonly SyncCrudOp[]
  writable: readonly string[]
  patch?(db: Executor, actor: Actor, input: WriteInput): Promise<void>
  put?(db: Executor, actor: Actor, input: WriteInput): Promise<void>
  remove?(db: Executor, actor: Actor, input: Omit<WriteInput, 'data'>): Promise<void>
}
rowPolicy<S extends z.ZodRawShape>(def: {
  table: string                                              // change_log table name, for the foreign-change lookup
  ops: readonly SyncCrudOp[]
  shape: S                                                   // writable wire columns with coercion
  load(db: Executor, id: string): Promise<{ showId: string } | null>
  create(db: Executor, actor: Actor, id: string, showId: string, data: z.output<z.ZodObject<S>>, meta: { batchId: string; clientTs?: Date }): Promise<unknown>
  update(db: Executor, actor: Actor, id: string, data: Partial<z.output<z.ZodObject<S>>>, meta: { batchId: string; clientTs?: Date }): Promise<unknown>
  remove(db: Executor, actor: Actor, id: string, meta: { batchId: string; clientTs?: Date }): Promise<unknown>
}): SyncTablePolicy
foreignColumnsSince(db: Executor, table: string, rowId: string, actorUserId: string, since: Date | null): Promise<Set<string>>   // internal
```

- The `cues` entry: ops `PUT`, `PATCH`, `DELETE`; wire columns `department_id`, `major`, `minor`, `label`, `anchor` (JSON text, object, or null, parsed then checked by `anchorSchema`), `type`, `notes`, `colour`; `show_id` is read on PUT only and never patchable; everything else in `data` is ignored. `apply.ts` dispatches PUT to `put`, PATCH to `patch`, DELETE to `remove`, and rejects `unsupported_op` when the policy lacks the op. `REJECTABLE` gains `conflict: 'conflict'`.
- The semantics, which the tests pin:

```
PUT(id, data):
  id not a UUID                         -> invalid
  existing = load(id)
  existing null:
    data.show_id missing                -> invalid
    create(id, data.show_id, parse(full shape))      # service checks role, layer, show writable
    a Postgres 23505 on the insert      -> retry this entry once as the existing-row branch, in a fresh savepoint
  existing present:                     # a replay of a create, never a new row
    requireShowRole(existing.showId, viewer)          # non-member -> not_found (hides the row)
    data.show_id differs from existing.showId -> invalid ('id belongs to another show')
    skip = foreignColumnsSince(table, id, actor, clientTs ?? null)
    update(id, writable columns from data whose camelCase key is not in skip)   # identical values -> applied, no log row (R33)
PATCH(id, data): existing null -> not_found; else update(id, writable columns present in data)   # last writer wins by arrival (spec 8)
DELETE(id):     existing null -> applied, no log row (already gone); else remove(id)

foreignColumnsSince(table, id, actor, since):
  the keys of `after` in change_log rows for (table, id) with user_id <> actor and
    since given:  coalesce(client_ts, server_ts) > since
    since null:   seq > (the actor's newest seq for this row, or 0)
```

- Batch ids (spec 4.12 "batch id (one sync upload or one MCP call)"). The route accepts a client `batchId` only if it matches `/^[A-Za-z0-9_-]{1,100}$/` (so it can never contain `:` or start with `reanchor:`; anything else is 400, which a well-behaved client never sends) and passes `${actor.userId}:${batchId}` to `applyCrudBatch`, so the logged batch id is unique per user and trustworthy. Services called from the web routes and MCP keep generating `newId()` batch ids and expose no batch-id argument to clients. `clientTs` per entry comes from the row's `updated_at` (the client writes it on every mutation) when the entry carries no `clientTs` of its own.
- Produces, web:
  - `deviceId(): string`, a UUIDv7 minted when the local database is claimed (R36's ownership marker, stored beside it) and reused until the next claim; the connector's batch id is `${deviceId()}-${tx.transactionId ?? newId()}`.
  - `UPLOAD_CHUNK_MAX = 400` and `toUploadChunks(entries: SyncCrudEntry[], max = UPLOAD_CHUNK_MAX): SyncCrudEntry[][]` (order kept). `uploadData` posts the chunks of one PowerSync transaction in order, all with the same batch id, each carrying `chunk: { index, count }`, waiting for each 200; it collects rejections across chunks, pushes the notices, and calls `tx.complete()` once, after the last chunk. Any non-2xx throws before `complete()`, so PowerSync retries the whole transaction. `toCrudEntries` copies `opData.updated_at` into `clientTs`.
  - Chunk idempotency (controller ruling, closes the PATCH-replay hole a chunk retry would open): a new table `sync_applied_chunks (batch_key text, chunk_index integer, applied_at timestamptz default now(), primary key (batch_key, chunk_index))`, not synced, created by this task's migration. `SyncUploadRequest` gains optional `chunk?: { index: number; count: number }` (absent means a single chunk, index 0). In the same transaction as the chunk's writes, apply.ts inserts `(${userId}:${batchId}, index)`; on a primary-key conflict the chunk is a replay, nothing is applied, and the response is 200 `{ applied: 0, rejected: [], replay: true }`. Rows older than 7 days are deleted by the existing pg-boss maintenance (a `cron` job `sync-chunk-gc` daily). Tests: `a replayed chunk is applied once: a collaborator's PATCH between the first apply and the retry survives` (A uploads a 2-chunk batch whose second chunk fails, B PATCHes a label A's first chunk set, A retries the whole batch, B's label stands and change_log has exactly one row per entry of the first chunk), and `a single-chunk request without chunk metadata is still deduplicated by batch id`.
  - `rowLabel(db: AbstractPowerSyncDatabase, table: string, id: string): Promise<string>` (cues: `'LX cue 12'` from the local row and its department; annotations: `'note'`, `'highlight'`, …; anything else or a missing row: the M0 noun); the rejection notice becomes `Your change to <rowLabel> was not saved: <message>`, resolved before `tx.complete()`.
  - `devHooks.ts`: when `import.meta.env.DEV`, `window.__binder = { db }` for e2e only.
- e2e: `global-setup.ts` scopes user B to the SND department through `PATCH /api/memberships/:id` and records `RunData.departments: Record<string, string>` (code to id).

- [ ] **Step 1: Write the failing API tests**

```ts
// apps/api/test/syncMarkup.test.ts (setupMarkupShow; put/patch/del build entries; editorSync = { ...actors.editor, via: 'sync' })
test('PUT creates a cue with the client id and logs one insert', ...)
test('a replayed batch after a lost response applies once and logs once', async () => {   // Review Focus 1
  const req = { batchId: `${editor.id}:dev-7`, entries: [put('cues', id, cueRow({ label: 'A' }))] }
  await applyCrudBatch(db, editorSync, req)
  expect(await applyCrudBatch(db, editorSync, req)).toEqual({ applied: 1, rejected: [] })
  expect(await rowCount(cues, id)).toBe(1)
  expect(await logRows(id)).toHaveLength(1)
})
test('concurrent PUTs of one id yield one row', async () => {   // Review Focus 1
  await Promise.all([applyCrudBatch(db, editorSync, reqA), applyCrudBatch(db, editorSync, reqB)])   // same id
  expect(await rowCount(cues, id)).toBe(1)
  expect((await logRows(id)).filter((r) => r.op === 'insert')).toHaveLength(1)
})
test('a replayed PUT does not overwrite a collaborator\'s newer label', async () => {   // Review Focus 1
  const first = put('cues', id, cueRow({ label: 'A', notes: '' }), '2026-10-15T10:00:00Z')
  await applyCrudBatch(db, editorSync, { batchId: 'b-1', entries: [first] })
  await applyCrudBatch(db, ownerSync, { batchId: 'b-2', entries: [patch('cues', id, { label: 'B' }, '2026-10-15T10:01:00Z')] })
  await applyCrudBatch(db, editorSync, { batchId: 'b-1', entries: [first] })
  expect((await getCue(db, actors.owner, { cueId: id })).label).toBe('B')
})
test('PATCH after a rejected PUT is not_found and the batch is still 200', async () => {   // Review Focus 1
  const r = await applyCrudBatch(db, editorLxSync, { batchId: 'b-3', entries: [put('cues', id, cueRow({ department_id: depts.SND.id })), patch('cues', id, { label: 'x' })] })
  expect(r.rejected.map((x) => x.reason)).toEqual(['forbidden', 'not_found'])
})
test('PUT for an existing id with changed columns is an update logging only the changes', ...)
test('PUT of an id from a show the user is not in is not_found; from another of their shows it is invalid', ...)
test('PUT without show_id, or with a non-UUID id, is invalid', ...)
test('PUT then PATCH then DELETE of one id in one batch apply in order', ...)
test('DELETE of a missing row is applied with no log row; DELETE of a cue logs every field as before', ...)
test('anchor text that is not JSON, minor 120, or NUL in the label is rejected invalid, never 503', ...)
test('the LX editor PUTting an SND cue is forbidden; a service conflict becomes a conflict rejection', ...)
test('HTTP: two users sending the same client batch id are logged under different batch ids; a batch id with ":" is 400', async () => {
  // both post batchId 'dev-1' -> change_log batch_id values `${owner.id}:dev-1` and `${editor.id}:dev-1`
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run apps/api/test/syncMarkup.test.ts apps/api/test/syncUpload.test.ts`
Expected: FAIL (PUT is `unsupported_op`).

- [ ] **Step 3: Implement `rowPolicy`, the cue policy, `foreignColumnsSince`, the apply dispatch, and the route's batch id rule**

The existing `tablePolicy` for `shows` and `documents` keeps working (it becomes a `patch`-only policy). The 23505 retry runs inside `applyEntry` around a nested savepoint so the outer entry savepoint stays usable. M0's `syncUpload.test.ts` updates its expected `batch_id` values to the prefixed form.

- [ ] **Step 4: Run the API tests to verify they pass** (same command).

- [ ] **Step 5: Write the failing web unit tests and e2e**

```ts
// connector.test.ts (fake db whose getNextCrudTransaction returns 1,200 PUT entries; fake api.post)
test('uploads 1,200 entries as three ordered chunks of 400 under one batch id and completes once', async () => {   // Review Focus 1
  await new ApiConnector().uploadData(fakeDb)
  expect(posts.map((p) => p.entries.length)).toEqual([400, 400, 400])
  expect(new Set(posts.map((p) => p.batchId)).size).toBe(1)
  expect(posts.flatMap((p) => p.entries.map((e) => e.id))).toEqual(ids)
  expect(tx.complete).toHaveBeenCalledTimes(1)
})
test('a failed second chunk throws and never completes the transaction', ...)
test('clientTs comes from opData.updated_at', ...)
// rowLabel.test.ts
test('labels a cue with its department code and display number', ...)   // 'LX cue 12.5'
test('falls back to the table noun for a row that is gone', ...)
// e2e/markupSync.spec.ts
test('a cue created offline uploads on reconnect and reaches the other user', async ({ browser }) => {
  // A: context.setOffline(true); page.evaluate inserts an LX cue through window.__binder.db.execute
  // header shows 'Offline · 1 pending'; B's local count for the id is 0
  // A online: B sees the row within 10s (poll window.__binder.db in B's page)
})
test('an out-of-scope create is rejected, named, and disappears locally', async ({ browser }) => {
  // B (SND only) inserts an LX cue -> notice contains 'LX cue' and 'was not saved'; the row is gone from B within 10s; A never has it
})
```

- [ ] **Step 6: Run to verify they fail, implement, run until they pass**

Run: `pnpm vitest run apps/web && docker compose -f deploy/docker-compose.dev.yml up -d && pnpm --filter @binder/web e2e --grep "offline uploads|out-of-scope"`
Expected: PASS. Record in the ledger that offline create (spec 3.8, "Not yet covered") is now exercised.

- [ ] **Step 7: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(sync): create-or-update PUT, idempotent DELETE, chunked uploads, user-scoped batch ids"
```

---
### Task 4: Annotations and personal-layer privacy

**Files:**
- Create: the generated migration, custom migration `annotations_sync`, `apps/api/src/services/annotations.ts`, `apps/api/src/mcp/tools/annotations.ts`
- Modify: `packages/shared/src/{markup.ts,markupSchemas.ts}`, `packages/db/src/schema/markup.ts`, `packages/db/src/synced.ts`, `apps/api/src/sync/policy.ts`, `apps/api/src/services/index.ts`, `apps/api/src/mcp/{registry.ts,server.ts}`, `deploy/powersync/sync-config.yaml`, `apps/web/src/powersync/{schema.ts,schema.test.ts}`
- Test: `apps/api/test/annotations.test.ts`, `apps/api/test/mcpAnnotations.test.ts`, additions to `apps/api/test/syncMarkup.test.ts` and `packages/db/test/publication.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3 (`requireLayerEdit`, `canSeeLayer`, `anchorSchema`, `rowPolicy`, `assertAnchorTarget`).
- Produces, shared schemas: `geometrySchema(type: AnnotationType)`; geometry is relative to the anchor, in points: `note`, `stamp`, `highlight` → `{}`; `rect`, `ellipse` → `{ w, h }`, each greater than 0 and at most 14400, the anchor being the bottom-left corner; `line`, `arrow` → `{ dx, dy }`, each within ±14400 and not both 0, the anchor being the start. `styleSchema = { colour?: /^#[0-9A-Fa-f]{6}$/, strokeWidth?: 0.5..12, fontSize?: 6..72 }`. `annotationFieldsSchema = { layerKind, layerId, anchor: anchorSchema, type, geometry, text: max 2000, style }` with cross-field rules: `note` needs non-empty text; `stamp` needs text of 1 to 40 characters; `highlight` needs `anchor.text`; `wordStart >= 0` is enforced on create only, because re-anchoring can leave a highlight unbound (`wordStart = wordEnd = -1`) and accepting or moving it must still validate. The schema is built as `annotationFieldsSchema(mode: 'create' | 'update')`.
- Produces, db: `annotations(id, show_id → shows cascade, layer_kind text not null, layer_id text not null, anchor jsonb not null, type text not null, geometry jsonb not null default '{}', text text not null default '', style jsonb not null default '{}', created_at, updated_at, updated_by)`, indexes `show_id`, `(layer_kind, layer_id)`, expression `(anchor->>'documentVersionId')`. `SYNCED_TABLES` gains `annotations`.
- Produces, shared `markup.ts`: `interface AnnotationFields { layerKind: LayerKind; layerId: string; anchor: Anchor; type: AnnotationType; geometry: Record<string, number>; text: string; style: Record<string, unknown> }`.
- Produces, `annotations.ts`: `type Annotation = InferSelectModel<typeof annotations>`; `createAnnotation(db: Executor, actor: Actor, input: { showId: string; id?: string } & AnnotationFields & { batchId?: string; clientTs?: Date }): Promise<Annotation>`; `updateAnnotation(db, actor, { annotationId, patch: Partial<AnnotationFields>, batchId?, clientTs? }): Promise<Annotation>`; `deleteAnnotations(db, actor, { annotationIds: string[], batchId?, clientTs? }): Promise<{ deleted: string[] }>`; `getAnnotation(db, actor, { annotationId }): Promise<Annotation>` (MCP `get_annotation`); `listAnnotations(db, actor, { showId, layer?: LayerRef, documentId?: string }): Promise<Annotation[]>`. Rules: a personal annotation's `layerId` must be the actor's own id on create (`forbidden` otherwise); every read and write of another user's personal annotation is `not_found`, for owners too; moving between layers needs edit rights on both. Logged with the row's layer key; `geometry` and `style` are compared as JSON for no-op detection. Internal: `loadAnnotationRow(db, id)`.
- Stamp set: `stampSet(settings: Record<string, unknown>): string[]` in `@binder/shared` returns `settings.stampSet` when it is a non-empty string array, else `DEFAULT_STAMPS`; the owner edits it on the settings page (Task 1's screen) through `updateShow` settings.
- Sync: the `annotations` policy (PUT, PATCH, DELETE; wire columns `layer_kind`, `layer_id`, `anchor`, `type`, `geometry`, `text`, `style`, JSON columns as text or objects). Streams:

```yaml
      - SELECT * FROM annotations WHERE show_id IN user_shows AND layer_kind = 'department'
      - SELECT * FROM annotations WHERE show_id IN user_shows AND layer_kind = 'personal' AND layer_id = auth.user_id()
```

  If the service refuses the second form, move it to its own stream `personal_annotations` with `WHERE layer_kind = 'personal' AND layer_id = auth.user_id()` and record that in the ledger.
- MCP `tools/annotations.ts`: `list_annotations {showId, layer?: string (layer key, or 'personal' for your own), documentId?, cursor?, limit?}` (read); `get_annotation {annotationId}` (read); `create_annotation {showId, layer: 'personal' | department code or id, type, anchor: { documentId, pageIndex, x, y }, geometry?, text?, style?}`; `update_annotation {annotationId, …}`; `delete_annotations {annotationIds, confirm?}` (confirmation gate over ten).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/annotations.test.ts (setupMarkupShow)
test('a viewer adds a personal note; nobody else can list, get, update, or delete it (not_found), owners included', async () => {   // Review Focus 2
  const note = await createAnnotation(db, actors.viewer, { showId, layerKind: 'personal', layerId: viewer.id, type: 'note', text: 'mine', anchor: anchorOn(versionId, 0), geometry: {}, style: {} })
  expect((await listAnnotations(db, actors.owner, { showId })).map((a) => a.id)).not.toContain(note.id)
  for (const p of [getAnnotation(db, actors.owner, { annotationId: note.id }),
    updateAnnotation(db, actors.owner, { annotationId: note.id, patch: { text: 'x' } }),
    deleteAnnotations(db, actors.owner, { annotationIds: [note.id] })]) expect(await code(p)).toBe('not_found')
})
test('creating a personal annotation on someone else\'s layer id is forbidden', ...)
test('geometry is checked per type', ...)   // rect {w:0,h:5} invalid; arrow {dx:0,dy:0} invalid; highlight without anchor text invalid; highlight created with wordStart -1 invalid; note with empty text invalid
test('an unbound highlight (wordStart -1) can be accepted (status ok) and moved by update', ...)
test('the LX editor draws on LX, not SND; moving an LX annotation to SND is forbidden', ...)
test('personal rows log layer personal:<userId>; department rows department:<id>', ...)
test('stampSet falls back to the defaults', ...)
// syncMarkup.test.ts additions
test('a viewer PUTs a personal highlight; another member\'s DELETE of it is not_found', ...)
test('geometry as JSON text is parsed; geometry that is not an object is invalid', ...)
// mcpAnnotations.test.ts
test('create_annotation on layer "personal"; list_annotations and get_annotation with another member\'s token never show it', ...)   // get_annotation result isError with 'not_found'
test('delete_annotations over ten needs confirm', ...)
// publication.test.ts: the sync config streams personal annotations only where layer_id = auth.user_id()
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run apps/api/test/annotations.test.ts apps/api/test/mcpAnnotations.test.ts apps/api/test/syncMarkup.test.ts apps/api/test/mcpParity.test.ts packages/db apps/web/src/powersync`

- [ ] **Step 3: Implement**, **Step 4: Run to verify they pass** (same command)

- [ ] **Step 5: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(markup): annotations with private personal layers"
```

---

### Task 5: Snapping, quote matching, and `place_cue_at_text`

**Files:**
- Create: `packages/core/src/anchors/{types.ts,snap.ts,quote.ts}`, `apps/api/src/services/wordLayers.ts`, `apps/api/src/services/placement.ts`, `apps/api/test/processingHelpers.ts`
- Modify: `packages/core/src/index.ts`, `apps/api/src/services/index.ts`, `apps/api/src/mcp/{registry.ts,tools/cues.ts}`, `apps/api/test/mcp.test.ts` (use `processVersion`)
- Test: `packages/core/src/anchors/snap.test.ts`, `packages/core/src/anchors/quote.test.ts`, `apps/api/test/placement.test.ts`

**Interfaces:**
- Consumes: `normaliseToken` (M0 core), `readWordLayer` and `readableVersion` (M0 `services/pages.ts`), `createCue` (Task 2).
- Produces, core `types.ts`: `interface VersionText { versionId: string; documentId: string; pageCount: number; pages: Array<{ width: number | null; height: number | null }>; layers: ReadonlyMap<number, WordLayer> }`.
- Produces, `snap.ts`: `lineCentreY(layer: WordLayer, lineIndex: number): number` (mean of `y + h / 2` over the line's words); `snapToLine(layer: WordLayer, point: { x: number; y: number }, maxDistance = SNAP_DISTANCE_PT): { y: number; text: TextAnchor } | null`: the line whose centre is nearest `point.y` within `maxDistance` (lines without words skipped); in it, the word with the smallest horizontal distance to `point.x` (0 inside the box, leftmost on a tie); the quote is that word and up to seven following words of the same line joined by single spaces; `y` is the line centre; `x` is not snapped.
- Produces, `quote.ts`: `interface StreamWord { pageIndex: number; wordIndex: number; lineIndex: number; t: string }`; `interface QuoteMatch { start: number; end: number }` (inclusive stream indices); `buildWordStream(layers: ReadonlyMap<number, WordLayer>): StreamWord[]` (pages ascending; within a page lines by descending `lineCentreY`, ties by the first word's x; words in line order); `normaliseForMatch(t: string): string` (`normaliseToken`, then every character outside `\p{L}\p{N}` removed); `findQuote(stream: StreamWord[], quote: string, mode: 'exact' | 'normalised'): QuoteMatch[]` in stream order. Exact compares the quote's whitespace-separated tokens to `t` verbatim across line and page boundaries. Normalised compares `normaliseForMatch` forms with empty tokens dropped on both sides, joins a word that ends in `-` and is the last word of its line with the next stream word into one token, and lets a quote's final token that ended in `-` match as a prefix. `anchorAtMatch(stream: StreamWord[], m: QuoteMatch, to: VersionText): { pageIndex: number; x: number; y: number; lineLeft: number; text: TextAnchor }` (page of the first word; `x` = that word's x; `y` = its line centre; `lineLeft` = x of its line's first word; `text.quote` = the matched words' `t` joined by spaces, at most `QUOTE_MAX_WORDS`; `wordEnd` clipped to the start page).
- Produces, API internal `wordLayers.ts`: `loadVersionText(db: Executor, blobs: BlobStore, versionId: string): Promise<VersionText>` reading every page's layer with `readWordLayer`, cached in-process for the eight most recent versions (word-layer blobs never change under a key).
- Produces, `placement.ts`: `placeCueAtText(db: Executor, blobs: BlobStore, actor: Actor, input: { showId: string; department: string; quote: string; documentId?: string; occurrence?: number; nearPageIndex?: number; number?: CueNumber; label?: string; type?: CueType; notes?: string; batchId?: string }): Promise<{ status: 'placed'; cue: CueView; match: { pageIndex: number; snippet: string } } | { status: 'ambiguous'; matches: Array<{ occurrence: number; pageIndex: number; snippet: string }> }>`. `department` is a code or id. `documentId` defaults to the show's first `libretto` by sort order, else its first document (`invalid` when the show has none). Uses the document's current version (`invalid` unless `ready`). Exact matches first, normalised when there are none; none at all is `not_found` naming the document. Several matches: `occurrence` (1-based, stream order) picks one; else `nearPageIndex` picks the nearest page (earlier on a tie); else `ambiguous` with up to 20 matches and nothing written. The cue gets `anchorAtMatch`'s position and text with status `ok`, then goes through `createCue`. Snippets are the match with up to four words of context each side.
- MCP: `place_cue_at_text` in `tools/cues.ts`, description written for an agent marking up a script ("quote a line as it appears; if the result is ambiguous, call again with occurrence or nearPageIndex").
- Test helper `processingHelpers.ts`: `processVersion(deps: ProcessingDeps, versionId: string): Promise<void>` (runs `processDocumentVersion`, then `processPage` for each enqueued page id; the logic `mcp.test.ts` inlines) and `missingTools: string[]` (the same detection), used with `describe.skipIf(missingTools.length > 0)`.

- [ ] **Step 1: Write the failing core tests**

```ts
const layer: WordLayer = { words: [
  { t: 'THE', x: 72, y: 700, w: 28, h: 12 }, { t: 'PIRATES', x: 104, y: 700, w: 36, h: 12 },
  { t: 'OF', x: 144, y: 700, w: 14, h: 12 }, { t: 'PENZANCE', x: 162, y: 700, w: 60, h: 12 },
  { t: 'ACT', x: 72, y: 680, w: 24, h: 12 } ], lines: [[0, 1, 2, 3], [4]] }
test('line centre is the mean word centre', () => expect(lineCentreY(layer, 0)).toBe(706))
test('snaps within 12 points and quotes from the nearest word', () =>
  expect(snapToLine(layer, { x: 110, y: 712 })).toEqual({ y: 706, text: { quote: 'PIRATES OF PENZANCE', wordStart: 1, wordEnd: 3 } }))
test('does not snap beyond 12 points', () => expect(snapToLine(layer, { x: 110, y: 718.5 })).toBeNull())
test('the nearer of two lines wins', () => expect(snapToLine(layer, { x: 80, y: 690 })?.text.wordStart).toBe(4))
test('the quote stops at eight words and at the line end', ...)
// quote.test.ts
test('exact matching crosses a line break and a page break', ...)
test('normalised matching ignores case and punctuation: "Frederic, ahoy!" finds "frederic ahoy"', ...)
test('normalised matching joins a hyphenated line end: "pi-" then "rate" matches "pirate"', ...)
test('exact mode is case-sensitive', ...)
test('every occurrence is returned in stream order', ...)
test('the stream orders pages ascending and lines top to bottom', ...)
```

- [ ] **Step 2: Run to verify they fail**, **Step 3: Implement**, **Step 4: Run to verify they pass** (`pnpm vitest run packages/core`)

- [ ] **Step 5: Write the failing API tests** (process the libretto once in `beforeAll`; skip when tools are missing)

```ts
test('places a TM cue at a unique quote: page and line y of the match, a quote of at most eight words, status ok', ...)
  // choose the quote at test time: the first line of page index 3 of the processed libretto, confirmed unique with findQuote
test('"Pirate King" is ambiguous: matches listed, nothing written; occurrence 2 places at the second match', ...)
test('nearPageIndex picks the nearest occurrence', ...)
test('an unknown quote is not_found; a document whose current version is not ready is invalid', ...)
test('the LX editor cannot place a TM cue (forbidden)', ...)
test('MCP place_cue_at_text places the cue and logs via mcp with the agent', ...)
```

- [ ] **Step 6: Run to verify they fail, implement, run until they pass**

Run: `pnpm vitest run apps/api/test/placement.test.ts apps/api/test/mcp.test.ts apps/api/test/mcpParity.test.ts`

- [ ] **Step 7: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(markup): text snapping, quote matching, place_cue_at_text"
```

---

### Task 6: Markup client core: mutations, the local edit stream, and the pure viewer modules

**Files:**
- Create: `packages/core/src/markup/markers.ts`, `apps/web/src/markup/{mutations.ts,layerPrefs.ts,shortcuts.ts,geometry.ts,selection.ts,tools.ts,activeDepartment.ts}`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/markup/markers.test.ts`, `apps/web/src/markup/{mutations,layerPrefs,shortcuts,geometry,activeDepartment}.test.ts`

**Interfaces:**
- Consumes: `CueFields`, `LayerRef`, `MembershipScope`, `canEditLayer`, `columnEqual` (Tasks 1, 2).
- Produces, core `markers.ts`: `markerText(type: CueType, code: string, display: string): string` (`go` → `'LX 10'`, `standby` → `'SB LX 10'`, `warn` → `'W LX 10'`); `markerStyle(type: CueType): { fill: 'solid' | 'none'; stroke: 'none' | 'solid' | 'dashed' }` (`go` solid fill, `standby` dashed outline, `warn` solid outline). Print (Task 13) uses the same two functions.
- Produces, `mutations.ts`:

```ts
type MarkupTable = 'cues' | 'annotations'
interface LocalEdit { table: MarkupTable; id: string; op: 'insert' | 'update' | 'delete'; before: Record<string, unknown> | null; after: Record<string, unknown> | null }  // snake_case wire columns
interface EditContext { showId: string; userId: string }
const JSON_COLUMNS: Record<MarkupTable, readonly string[]> = { cues: ['anchor', 'payload'], annotations: ['anchor', 'geometry', 'style'] }
insertCue(db: AbstractPowerSyncDatabase, ctx: EditContext, fields: CueFields): Promise<string>
updateCue(db, ctx, id: string, patch: Partial<CueFields>): Promise<void>
updateCues(db, ctx, patches: Array<{ id: string; patch: Partial<CueFields> }>): Promise<void>   // one writeTransaction, one LocalEdit[] group
deleteCue(db, ctx, id: string): Promise<void>
subscribeLocalEdits(fn: (edits: LocalEdit[], source: 'user' | 'undo' | 'redo') => void): () => void
toCueRow(fields: CueFields): Record<string, string | number | null>; fromCueRow(row: Record<string, unknown>): CueFields
```

  Every mutation is one `db.writeTransaction` that writes the snake_case columns (anchor as JSON text, `updated_by` the user, `created_at` on insert and `updated_at` always set to now, which the connector forwards as `clientTs`) and then emits its `LocalEdit[]` with the row values read inside the transaction. Mutations take an optional last argument `{ source?: 'user' | 'undo' | 'redo' }` (default `'user'`).
- Produces, `layerPrefs.ts`: `interface LayerPrefs { hidden: string[]; active: string | null }` (layer keys); `loadLayerPrefs(userId: string, showId: string): LayerPrefs` and `saveLayerPrefs(userId, showId, prefs): void` under `localStorage` key `binder.layers.<userId>.<showId>` (every access in try/catch, defaults `{ hidden: [], active: null }`); `loadLocks(showId): string[]`/`saveLocks(showId, keys)` under `sessionStorage` `binder.locks.<showId>`; `editableLayers(scope: MembershipScope, userId: string, departments: Array<{ id: string; hidden: boolean }>): LayerRef[]` (non-hidden departments the matrix allows, in the order given, then the personal layer); `resolveActiveLayer(prefs: LayerPrefs, editable: LayerRef[]): LayerRef` (the stored layer if still editable, else the first editable department, else personal).
- Produces, `activeDepartment.ts`: `cueTargetDepartment(active: LayerRef, lastActiveDepartment: string | null, editable: LayerRef[]): { departmentId: string } | { disabled: string }`. The cue tool places into the active layer when it is a department; when the active layer is personal it uses the most recently active editable department, else the first editable department; with no editable department the tool is disabled with the hint `Cues go on a department layer, and you can't edit any in this show.`
- Produces, `shortcuts.ts`: `type ShortcutAction = { kind: 'nextCue' } | { kind: 'prevCue' } | { kind: 'placeCue' } | { kind: 'jumpToPage' } | { kind: 'activeLayer'; index: number } | { kind: 'delete' } | { kind: 'deselect' } | { kind: 'undo' } | { kind: 'redo' }`; `resolveShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; editableTarget: boolean }): ShortcutAction | null` with `]` next cue, `[` previous cue, `c` place a cue, `g` focus the page input, `1` to `9` active layer by index into `editableLayers`, `Delete`/`Backspace` delete the selection, `Escape` deselect, Mod+`z` undo, Mod+Shift+`z` redo (Mod is meta or ctrl; Task 9 wires the last two); only `Escape` works when the target is editable.
- Produces, `geometry.ts`: `type Box = { x: number; y: number; w: number; h: number }`; `cueMarkerBox(x: number, y: number, textWidth: number): Box` (displayed space: height 14, width `textWidth + 8`, left edge at `x`, vertically centred on `y`); `hitTest(items: Array<{ table: MarkupTable; id: string; box: Box }>, p: { x: number; y: number }, tolerance = 4): { table: MarkupTable; id: string } | null` (the last-drawn item containing the point within the tolerance).
- Produces, `selection.ts` and `tools.ts`: `useSyncExternalStore` stores: `useSelection(): { table: MarkupTable; id: string } | null` with `select`/`clearSelection`; `useTool(): { tool: 'select' | 'cue' | AnnotationType; cueType: CueType }` with `setTool`.

- [ ] **Step 1: Write the failing tests**

```ts
test.each([['go', 'LX 10'], ['standby', 'SB LX 10'], ['warn', 'W LX 10']] as const)('marker text for %s', (t, s) => expect(markerText(t, 'LX', '10')).toBe(s))
test.each([[']', { kind: 'nextCue' }], ['[', { kind: 'prevCue' }], ['c', { kind: 'placeCue' }], ['g', { kind: 'jumpToPage' }],
  ['3', { kind: 'activeLayer', index: 2 }], ['Delete', { kind: 'delete' }], ['Backspace', { kind: 'delete' }], ['Escape', { kind: 'deselect' }]])(
  '%s maps to its action', (key, action) => expect(resolveShortcut(keyEvent(key))).toEqual(action))
test('mod+z undoes and mod+shift+z redoes with meta or ctrl', ...)
test('in an input only Escape works', ...)
test('layer prefs round-trip per user and show; a throwing storage gives defaults', ...)
test('the active layer falls back to the first editable department, then personal', ...)
test('editableLayers for an SND-scoped editor is [SND, personal]; for a viewer [personal]', ...)
test('the cue tool targets the active department, the last active department when personal is active, and is disabled with the hint when none is editable', ...)
test('cueMarkerBox is 14 high, centred on y, left edge at x', () => expect(cueMarkerBox(100, 500, 30)).toEqual({ x: 100, y: 493, w: 38, h: 14 }))
test('hitTest picks the last-drawn item within 4 points', ...)
test('toCueRow and fromCueRow round-trip with the anchor as JSON text', ...)
test('updateCues emits one group with one edit per cue', ...)   // fake db with writeTransaction over an in-memory table
```

- [ ] **Step 2: Run to verify they fail**, **Step 3: Implement**, **Step 4: Run to verify they pass**

Run: `pnpm vitest run packages/core apps/web`

- [ ] **Step 5: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(web): markup mutations, local edit stream, and viewer helpers"
```

---

### Task 7: Cue overlay, layer panel, and cue editor

**Files:**
- Create: `apps/web/src/markup/{useMarkup.ts,LayerPanel.tsx,CueMarker.tsx,MarkupOverlay.tsx,CueEditor.tsx,SvgText.tsx}`, `apps/web/e2e/markup.spec.ts`
- Modify: `apps/web/src/viewer/{PageList.tsx,ViewerToolbar.tsx}`, `apps/web/src/routes/shows.$showId.docs.$docId.tsx`, `apps/web/e2e/{global-setup.ts,env.ts}`
- Test: `apps/web/e2e/markup.spec.ts`

**Interfaces:**
- Consumes: Task 6's modules; `snapToLine`, `suggestCueNumber`, `compareReadingOrder`, `formatCueNumber`, `parseCueNumber` (core); M0 Task 15/16 `PageList`, `PageOverlay`, `cssToDisplayed`, the word-layer cache of `useDocumentSearch` (or `fetchBlob` of `words.json`).
- Produces: `useMarkup(showId: string, versionId: string): { cuesByPage: Map<number, CueRowWithDept[]>; annotationsByPage: Map<number, AnnotationRow[]> }` from local SQLite (`json_extract(anchor, '$.documentVersionId') = ?`), filtered to visible layers; `PageList` gains `renderOverlay?: (page: PageRow) => ReactNode`; `MarkupOverlay({ page, words, zoom })`; `CueEditor({ cueId })` (number through `parseCueNumber`, label, type, notes, department among editable ones, delete; an empty slot `historySlot` that Task 12 fills); `LayerPanel({ showId })` (every non-hidden department and the personal layer with visibility, lock, and active controls).
- SVG notes: `MarkupOverlay` draws inside `PageOverlay`'s `<g transform="translate(0 H) scale(1 -1)">`, so every `<text>` is counter-flipped by `SvgText` (`transform="translate(x y) scale(1 -1)"`, drawing at the origin) or it renders upside down; `PageOverlay`'s root has `pointer-events: none`, so interactive children set `pointer-events: auto` (markers, handles, and a transparent full-page `<rect>` that receives tool clicks).
- Behaviour: markers use the department colour (labels to the right of the box in the same colour). The cue tool places on click into `cueTargetDepartment`: snap with the page's word layer when snapping is on (document `snap_to_text`, overridden for the session by a toolbar toggle stored in `sessionStorage` `binder.snap.<documentId>`; pages without words place by position only), number from `suggestCueNumber` with that department's reading-order neighbours on this version, then `insertCue`, select it, and open `CueEditor`. Dragging a selected cue on an editable, unlocked layer moves it; the drop page is the `[data-page-index]` element under the pointer, the drop re-snaps, and the anchor is written with status `ok`. Locked and non-editable layers neither drag nor delete. `]` and `[` walk visible cues in reading order and scroll to them. Archived shows are read-only.
- e2e: `global-setup.ts` uploads the libretto fixture to the shared show as A and waits for `ready` (up to 180 s); `RunData.libretto = { documentId, versionId }`.

- [ ] **Step 1: Write the failing e2e**

```ts
test('A places an LX cue snapped to a line on page 1 and B sees it within 5s', async ({ browser }) => {
  // A: cue tool, click 3pt below the centre of a text line on page 1; editor opens with number 10
  // local row: anchor.text.quote non-empty, anchor.y equals that line's centre, status 'ok'; B: marker 'LX 10' visible and upright within 5s
})
test('dragging the cue to page 2 moves it for both users', ...)
test('B (SND only) cannot drag A\'s LX cue and has SND and personal as the only active layers', ...)
test('a viewer sees the cue tool disabled with the hint', ...)
test('keyboard: c places a cue in the active layer at the pointer, ] selects the next cue, Delete removes it', ...)
test('hiding LX hides its markers and survives a reload', ...)
```

- [ ] **Step 2: Run to verify it fails, implement, run until it passes**

Run: `pnpm --filter @binder/web e2e --grep "places an LX cue|dragging|cannot drag|cue tool disabled|keyboard|hiding LX"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(web): cue overlay with snapping, layer panel, and cue editor"
```

---

### Task 8: Annotation tools and annotation editing

**Files:**
- Create: `apps/web/src/markup/{AnnotationShape.tsx,AnnotationEditor.tsx,Handles.tsx,annotationDraft.ts,annotationEdit.ts,wordRange.ts,StampPicker.tsx}`, `apps/web/e2e/annotations.spec.ts`
- Modify: `apps/web/src/markup/{mutations.ts,MarkupOverlay.tsx,tools.ts,useMarkup.ts}`, `apps/web/src/viewer/ViewerToolbar.tsx`, `apps/web/src/routes/shows.$showId.settings.tsx` (stamp set editor)
- Test: `apps/web/src/markup/{annotationDraft,annotationEdit,wordRange}.test.ts`, `apps/web/e2e/annotations.spec.ts`

**Interfaces:**
- Consumes: Tasks 6 and 7; Task 4's `stampSet`, geometry rules, and `annotationFieldsSchema`; `buildWordStream` (core).
- Produces, mutations: `insertAnnotation(db, ctx, fields: AnnotationFields): Promise<string>`, `updateAnnotation(db, ctx, id, patch: Partial<AnnotationFields>)`, `deleteAnnotation(db, ctx, id)`, emitting `LocalEdit[]` like the cue mutations.
- Produces, `annotationDraft.ts`: `draftToAnnotation(tool: AnnotationType, start: { x: number; y: number }, end: { x: number; y: number }): { anchor: { x: number; y: number }; geometry: Record<string, number> } | null`: `rect`/`ellipse` → anchor at the minimum corner, `w = |dx|`, `h = |dy|`, null when either is under 2; `line`/`arrow` → anchor at `start`, `{ dx, dy }`, null when the length is under 2; `note`/`stamp` → anchor at `start`, `{}`.
- Produces, `annotationEdit.ts`: `type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'start' | 'end'`; `moveBy(anchor: { x; y }, dx: number, dy: number): { x; y }`; `resizeBox(anchor: { x; y }, geometry: { w; h }, handle: 'nw' | 'ne' | 'sw' | 'se', p: { x; y }): { anchor: { x; y }; geometry: { w; h } }` (the opposite corner stays fixed; the result is normalised so `w`, `h` > 0; a box under 2 points keeps its last valid size); `moveEndpoint(anchor, geometry: { dx; dy }, handle: 'start' | 'end', p): { anchor; geometry }` (the other endpoint stays fixed).
- Produces, `wordRange.ts`: `wordRangeFromDrag(layer: WordLayer, from: { x: number; y: number }, to: { x: number; y: number }): TextAnchor | null`: the words between the two points in reading order (`buildWordStream` order within the page, endpoints mapped to their nearest words), quote of the first `QUOTE_MAX_WORDS`; a highlight's anchor x and y are the first word's x and line centre. Highlights render one rectangle per covered line from the page's word boxes; one whose `wordStart` is `-1` renders as a dashed marker at its anchor.
- Produces, `AnnotationEditor({ annotationId })`, opened when an annotation is selected: text (notes; stamps choose from `stampSet`), style (colour swatch defaulting to the layer colour, stroke width 0.5 to 12, font size 6 to 72 for notes), layer (among editable layers), "Re-select words" for highlights (the next word drag replaces `anchor.text`, `x`, `y`, status `ok`), delete, and the `historySlot` Task 12 fills. On the overlay, a selected annotation on an editable, unlocked layer drags to move (status `ok`), rect and ellipse show four corner handles (`resizeBox`), line and arrow show two endpoint handles (`moveEndpoint`); each gesture writes one `updateAnnotation` on pointer up.

- [ ] **Step 1: Write the failing unit tests**

```ts
test('a rect dragged up and left is normalised to its bottom-left corner', () =>
  expect(draftToAnnotation('rect', { x: 200, y: 500 }, { x: 150, y: 450 })).toEqual({ anchor: { x: 150, y: 450 }, geometry: { w: 50, h: 50 } }))
test('tiny drags make nothing', ...)
test('an arrow keeps its start as the anchor', ...)
test('resizing from the nw handle keeps the se corner fixed', () =>
  expect(resizeBox({ x: 100, y: 100 }, { w: 50, h: 40 }, 'nw', { x: 80, y: 160 })).toEqual({ anchor: { x: 80, y: 100 }, geometry: { w: 70, h: 60 } }))
test('dragging a corner past the opposite one flips and stays positive', ...)
test('moving the end of an arrow keeps its start', () =>
  expect(moveEndpoint({ x: 10, y: 10 }, { dx: 20, dy: 0 }, 'end', { x: 40, y: 50 })).toEqual({ anchor: { x: 10, y: 10 }, geometry: { dx: 30, dy: 40 } }))
test('moveBy translates the anchor and leaves geometry to the caller', () =>
  expect(moveBy({ x: 100, y: 200 }, -15, 30)).toEqual({ x: 85, y: 230 }))
test('dragging over words selects the range in reading order with a quote of at most eight words', ...)
```

- [ ] **Step 2: Run to verify they fail, implement, run until they pass** (`pnpm vitest run apps/web`)

- [ ] **Step 3: Write the failing e2e**

```ts
test('dragging a selected rect moves it and B sees the new position', async ({ browser }) => {
  // A draws a rect on LX, selects it, drags its body 50 CSS px right at zoom 1; one updateAnnotation on pointer up
  await expect.poll(() => bQuery('SELECT json_extract(anchor, "$.x") AS x FROM annotations WHERE id = ?', [rectId])).toEqual([{ x: startX + 50 }])
})
test('A draws a rect on LX and a personal note; B sees the rect and never the note', async ({ browser }) => {   // Review Focus 2 (sync)
  // ... A draws both, B waits 10s
  expect(await bQuery('SELECT count(*) AS n FROM annotations WHERE layer_kind = ? AND layer_id = ?', ['personal', run.users.aId])).toEqual([{ n: 0 }])
  expect(await bQuery('SELECT count(*) AS n FROM annotations WHERE id = ?', [rectId])).toEqual([{ n: 1 }])
})
test('editing a note\'s text and colour shows for both users', ...)
test('resizing a rect by its corner and moving an arrow\'s end are saved', ...)
test('dragging across words makes a highlight over exactly those words; "Re-select words" rebinds it', ...)
test('a stamp from the show stamp set lands where clicked', ...)
```

- [ ] **Step 4: Implement the tools, editor, and handles; run until the e2e passes**

Run: `pnpm --filter @binder/web e2e --grep "rect on LX|note's text|resizing|highlight|stamp"`

- [ ] **Step 5: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(web): annotation tools, editor, move and resize"
```

---

### Task 9: Personal undo

**Files:**
- Create: `apps/web/src/undo/{undoStack.ts,useUndo.ts}`
- Modify: `apps/web/src/viewer/ViewerToolbar.tsx` (undo and redo buttons), `apps/web/src/routes/shows.$showId.docs.$docId.tsx` (shortcuts), `apps/web/e2e/annotations.spec.ts`
- Test: `apps/web/src/undo/undoStack.test.ts`, `apps/web/e2e/annotations.spec.ts`

**Interfaces:**
- Consumes: `subscribeLocalEdits`, the mutations, `JSON_COLUMNS` (Task 6); `columnEqual` (core).
- Produces, `undoStack.ts`:

```ts
interface ApplyFns {
  read(table: MarkupTable, id: string): Promise<Record<string, unknown> | null>
  insert(table: MarkupTable, row: Record<string, unknown>): Promise<void>
  update(table: MarkupTable, id: string, cols: Record<string, unknown>): Promise<void>
  remove(table: MarkupTable, id: string): Promise<void>
  transaction(fn: () => Promise<void>): Promise<void>        // one local writeTransaction for a whole group
}
type UndoOutcome = { status: 'done' } | { status: 'blocked'; reason: 'changed-by-someone-else' | 'row-gone' } | { status: 'empty' }
class UndoStack {
  constructor(apply: ApplyFns, limit = 100)
  record(edits: LocalEdit[]): void        // a new user edit clears the redo stack
  undo(): Promise<UndoOutcome>; redo(): Promise<UndoOutcome>; clear(): void
  readonly canUndo: boolean; readonly canRedo: boolean
}
```

  Undo of one edit, comparing the edit's writable columns with `columnEqual` (so JSON text that differs only in spacing or key order after a sync round trip counts as unchanged; `updated_at`, `updated_by`, `created_at` ignored):

```
insert: current null -> blocked row-gone; current differs from after -> blocked changed-by-someone-else; else remove
update: current null -> blocked row-gone; cols = keys of after whose current value still equals after
        cols empty -> blocked changed-by-someone-else; else update those cols to before (others are left alone)
delete: current present -> blocked changed-by-someone-else; else insert before (same id)
```

  A group (one `LocalEdit[]`) is checked first, then applied in reverse order inside one `transaction`, all or nothing: any blocked edit blocks the group and nothing is written. Redo applies the same rules with `before` and `after` swapped. A blocked entry leaves the stack and shows the notice "Can't undo: someone else has changed this since". Large groups (a 600-cue renumber) are one local transaction, which Task 3's connector uploads in chunks. `useUndo(showId)` owns one stack per show for the session, records `source: 'user'` edits from `subscribeLocalEdits`, and wires Mod+z, Mod+Shift+z, and the toolbar buttons.

- [ ] **Step 1: Write the failing unit tests** (in-memory `ApplyFns`)

```ts
test('undo of an insert removes the row nobody changed', ...)
test('undo of an insert is blocked when someone else changed the row', ...)
test('undo of an update restores only the columns still holding our value', ...)   // we set label; B set notes: undo restores label, keeps B's notes
test('undo of an update whose column someone else changed is blocked and writes nothing', async () => {   // Review Focus 5
  stack.record([{ table: 'cues', id, op: 'update', before: { label: 'A' }, after: { label: 'B' } }])
  store.set(id, { ...store.get(id), label: 'C' })
  expect(await stack.undo()).toEqual({ status: 'blocked', reason: 'changed-by-someone-else' })
  expect(store.get(id).label).toBe('C')
})
test('a re-spaced, re-ordered anchor after a sync round trip still counts as ours', async () => {
  stack.record([{ table: 'cues', id, op: 'update', before: { anchor: '{"pageIndex":0,"x":1,"y":2}' }, after: { anchor: '{"pageIndex":1,"x":1,"y":2}' } }])
  store.set(id, { ...store.get(id), anchor: '{"y": 2, "x": 1, "pageIndex": 1}' })
  expect(await stack.undo()).toEqual({ status: 'done' })
})
test('undo of a delete re-inserts the row with the same id', ...)
test('a group undoes all or nothing, in one transaction', ...)
test('a 600-edit group undoes in one transaction', ...)
test('redo re-applies, and a new edit clears redo', ...)
test('the stack keeps the last 100 entries', ...)
```

- [ ] **Step 2: Run to verify they fail, implement, run until they pass** (`pnpm vitest run apps/web`)

- [ ] **Step 3: Add the e2e, wire the stack, run until it passes**

```ts
test('undo restores a deleted cue; undo after B relabels the cue is blocked with a notice', ...)   // Review Focus 5
```

Run: `pnpm --filter @binder/web e2e --grep "undo"`

- [ ] **Step 4: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(web): personal undo and redo"
```

---
### Task 10: Cue lists, renumbering, and the checkpoint smoke

**Files:**
- Create: `packages/core/src/cues/{renumber.ts,cueList.ts}`, `apps/api/src/services/renumber.ts`, `apps/web/src/cuelist/{CueListTable.tsx,RenumberDialog.tsx,renumberLocally.ts}`, `apps/web/src/routes/shows.$showId.cues.tsx`, `apps/web/e2e/cuelist.spec.ts`, `deploy/scripts/m1-smoke.ts`
- Modify: `packages/core/src/index.ts`, `apps/api/src/services/index.ts`, `apps/api/src/mcp/{registry.ts,tools/cues.ts}`, the show page (link per department)
- Test: `packages/core/src/cues/{renumber,cueList}.test.ts`, `apps/api/test/renumber.test.ts`, `apps/web/e2e/cuelist.spec.ts`

**Interfaces:**
- Consumes: `compareReadingOrder`, `findDuplicateNumbers`, `formatCueNumber`, `parseCueNumber` (Task 2); `updateCues` (Task 6); `updateCue` service (Task 2); Task 3's chunked upload.
- Produces, core:

```ts
interface RenumberCue { id: string; major: number; minor: number; anchor: { pageIndex: number; y: number } | null; groupKey: string | null }
interface RenumberResult { changes: Array<{ id: string; major: number; minor: number }>; flagged: Array<{ id: string; reason: 'spilled' | 'overflow' }> }
renumberByBlocks(cues: RenumberCue[], opts?: { blockSize?: number }): RenumberResult   // blockSize integer 2..1000, default DEFAULT_BLOCK_SIZE
```

  `groupKey` is the scene or song resolved from the anchor (spec 4.5), or null when none resolves. Script items arrive in M2, so in M1 every caller passes `null`. The algorithm:

```
placed = cues with an anchor and major > 0 (the 0 range holds line checks and is untouched), in reading order, ties by id
runs   = maximal consecutive runs of equal groupKey
next   = blockSize
for run in runs:
  start = next
  if run.groupKey is null:                         # before the first scene or song, or no script items at all
    cue i gets { start + i, 0 }; last = start + len - 1
  else:
    first min(len, blockSize) cues get { start + i, 0 }
    s = len - blockSize spilled cues (if > 0): major = start + blockSize - 1, minor_i = floor(i * 100 / (s + 1)) for i = 1..s, flagged 'spilled'
    spilled cues beyond the 99th keep their numbers, flagged 'overflow'
    last = start + min(len, blockSize) - 1
  next = the smallest multiple of blockSize greater than last
changes = cues whose (major, minor) changed; unplaced cues never appear
```

- Produces, API `renumber.ts`: `renumberCues(db: Executor, actor: Actor, input: { departmentId: string; documentId: string; blockSize?: number; batchId?: string }): Promise<{ changed: number; flagged: Array<{ cueId: string; reason: 'spilled' | 'overflow' }> }>`: the department's cues whose `anchor.documentId` is the document (any version), `groupKey` null, `requireLayerEdit` on the department, every change written through `updateCue` in one transaction under one batch id. MCP `renumber_cues {departmentId | department+showId, documentId, blockSize?}` in `tools/cues.ts`.
- Produces, core `cueList.ts` (the API's cue sheet export uses it too): `cueListRows(cues: Array<CueFields & { id: string }>, departments: Array<{ id: string; code: string; numberFormat: NumberFormat }>, documents: Array<{ id: string; title: string; currentVersionId: string | null }>): CueListRow[]` with `interface CueListRow { id: string; display: string; type: CueType; label: string; page: string; documentTitle: string; trigger: string; notes: string; flags: Array<'duplicate' | 'approximate' | 'unresolved' | 'older-version'>; placed: boolean; anchor: Anchor | null }`, sorted by `(major, minor)`, placed rows first and unplaced in their own trailing group; `page` is `p.<pageIndex + 1>`, prefixed with the document title when the department has cues in more than one document, `—` when unplaced; `documentTitle` is that title in the multi-document case and `''` otherwise; `trigger` is `anchor.text.quote` when bound; `older-version` means the anchor's version is not its document's current version.
- Produces, web: `renumberLocally(db, ctx, { departmentId, documentId, blockSize }): Promise<RenumberResult>` runs `renumberByBlocks` on local rows and applies the changes with one `updateCues` (one upload batch, one undo entry), so renumbering works offline. Route `/shows/$showId/cues?department=<id>` (default: the first visible department): the table with inline edits of number (invalid input shows an error and writes nothing), label, type, and notes; a "Duplicate" badge per duplicate; a click on a placed row opens the viewer at its page with the cue selected; "Renumber from script order…" (document, block size default 10, a preview of changed and spilled counts, apply).
- Produces, `deploy/scripts/m1-smoke.ts --stage checkpoint|full`, run as `BINDER_URL=<origin> BINDER_TOKEN=<token> pnpm --filter @binder/api exec tsx ../../deploy/scripts/m1-smoke.ts --stage checkpoint`, printing PASS or FAIL per step and exiting non-zero on any failure. The token is a `*`-scoped personal access token Jayden creates on the settings page and passes in the environment, never written to a file. Checkpoint steps over MCP (`@modelcontextprotocol/client`, client name `m1-smoke`) and REST with the bearer token: `create_show` "M1 smoke <ISO time>"; `list_departments` returns the seven seeded codes; upload `FIXTURES.librettoPdf` with `POST /api/shows/:id/documents` (multipart, bearer); poll `list_documents` until ready (up to 5 minutes); `place_cue_at_text` with a quote taken from page index 3 through `get_page` returns `placed`; `update_cue` relabels it; `create_annotation` adds an LX rect; `renumber_cues` answers; `update_show` archives the smoke show. Task 23 adds the `full` stage.

- [ ] **Step 1: Write the failing core tests**

```ts
const at = (id: string, page: number, y: number, groupKey: string | null = null, major = 99, minor = 0) => ({ id, major, minor, anchor: { pageIndex: page, y }, groupKey })
test('no script items: consecutive integers from 10 in reading order', () =>
  expect(renumberByBlocks([at('c', 1, 700), at('a', 0, 300), at('b', 0, 700)]).changes)
    .toEqual([{ id: 'b', major: 10, minor: 0 }, { id: 'a', major: 11, minor: 0 }, { id: 'c', major: 12, minor: 0 }]))
test('groups take the next block: A(3) then B(2) -> 10, 11, 12, 20, 21', ...)
test('a group of twelve spills two cues into points of 19 and flags them', () => {
  // -> 10..19, then 19.33 and 19.66 flagged 'spilled'; the next group starts at 20
})
test('an ungrouped run of twelve then a group: 10..21, then 30', ...)
test('unplaced cues and major 0 cues are untouched; unchanged cues are not in changes', ...)
test('block size 100 gives 100, 101, then 200', ...)
```

- [ ] **Step 2: Run to verify they fail, implement, run until they pass** (`pnpm vitest run packages/core`)

- [ ] **Step 3: Write the failing API and web tests**

```ts
// renumber.test.ts (setupMarkupShow)
test('renumber writes one batch, logs only the changed cues, and leaves unplaced cues and other documents alone', ...)
test('the LX editor renumbering SND is forbidden and nothing changes', ...)
test('MCP renumber_cues returns changed and flagged counts', ...)
// cueList.test.ts
test('rows sort by number, flag duplicates and anchor states, prefix pages with the document only when needed, and trail unplaced', ...)
// e2e/cuelist.spec.ts
test('the LX list shows a duplicate badge; renumbering from script order gives 10, 11, 12 in page order and clears it', ...)
test('editing a number to "12.5" shows 12.5; "abc" shows an error and changes nothing', ...)
test('600 renumbered cues upload cleanly', async ({ browser }) => {   // Review Focus 1
  // A inserts 600 LX cues through window.__binder.db in one transaction, each ANCHORED (documentId, current versionId,
  // pageIndex = i % 40, y descending within the page) so renumberByBlocks orders them; numbers start scrambled; waits for 'Synced'
  await a.getByRole('button', { name: 'Renumber from script order' }).click()
  await expect(a.getByTestId('sync-status')).toHaveText('Synced', { timeout: 60_000 })
  await expect(a.getByRole('alert')).toHaveCount(0)
  const numbersA = await lxNumbers(a)   // read via window.__binder.db, in script order
  expect(numbersA).toEqual(Array.from({ length: 600 }, (_, i) => String(10 + i)))
  await expect.poll(() => lxNumbers(b), { timeout: 30_000 }).toEqual(numbersA)
})
```

- [ ] **Step 4: Run to verify they fail, implement, run until they pass**

Run: `pnpm vitest run apps/api/test/renumber.test.ts apps/api/test/mcpParity.test.ts apps/web && pnpm --filter @binder/web e2e --grep "LX list|editing a number|600 renumbered"`

- [ ] **Step 5: Write the smoke script and run its checkpoint stage locally**

Run: `BINDER_URL=http://localhost:5173 BINDER_TOKEN=<dev token> pnpm --filter @binder/api exec tsx ../../deploy/scripts/m1-smoke.ts --stage checkpoint`
Expected: every step PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(cues): cue lists, renumber from script order, checkpoint smoke"
```

---

### Task 11: History, activity feed, and revert (services and MCP)

**Files:**
- Create: `packages/core/src/history/summarise.ts`, `packages/shared/src/history.ts`, `apps/api/src/services/{history.ts,revert.ts}`, `apps/api/src/routes/history.ts`, `apps/api/src/mcp/tools/history.ts`
- Modify: `packages/core/src/index.ts`, `packages/shared/src/index.ts`, `apps/api/src/services/index.ts`, `apps/api/src/app.ts`, `apps/api/src/mcp/{registry.ts,server.ts}`
- Test: `packages/core/src/history/summarise.test.ts`, `apps/api/test/history.test.ts`, `apps/api/test/revert.test.ts`, `apps/api/test/mcpHistory.test.ts`

**Interfaces:**
- Consumes: `change_log` with `layer` (Task 1) and user-scoped batch ids (Task 3); cue, annotation, department, document, and show services; `columnEqual` (Task 2); `confirmationRequired`, `CONFIRM_THRESHOLD` (Task 2).
- Produces, core: `interface SummaryRow { table: string; op: 'insert' | 'update' | 'delete'; before: Record<string, unknown> | null; after: Record<string, unknown> | null; departmentCode: string | null }`; `summariseBatch(rows: SummaryRow[]): string`; `actorLabel(name: string, agent: string | null): string` (`'Jayden'`, or `'Jayden via Claude Code'` taking the agent up to its first `/`). Verbs: cues: insert with an anchor `placed`, insert without `added`, update of `anchor` `moved`, of `major`/`minor` `renumbered`, of `label` `relabelled`, of anything else `edited`, delete `deleted` (an update counts once per verb it triggers); annotations: `added`, `moved` (anchor or geometry), `edited`, `deleted`; other tables: `added`, `updated`, `deleted`. Nouns: `cue`/`cues`, `annotation`/`annotations`, and otherwise the table name singularised. A clause group is one table and department; its first verb reads `<verb> <n> [<CODE> ]<noun>` and later verbs `<verb> <n>`, joined with `, ` and a final ` and `, verbs ordered placed, added, moved, renumbered, relabelled, edited, updated, deleted; groups join with `; ` in order of first appearance.
- Produces, shared `history.ts` (the web reads the same shapes): `HistoryEntry`, `ActivityGroup`, `RevertResult` below. API `history.ts`:

```ts
interface HistoryEntry { seq: number; serverTs: string; clientTs: string | null; userId: string; userName: string; via: Via; agent: string | null; batchId: string | null; table: string; rowId: string; op: 'insert' | 'update' | 'delete'; before: Record<string, unknown> | null; after: Record<string, unknown> | null; layer: string | null }
listHistory(db: Executor, actor: Actor, input: { showId: string; rowId?: string; table?: string; layer?: string; userId?: string; kind?: 'human' | 'agent' | 'all'; from?: Date; to?: Date; before?: number; limit?: number }): Promise<{ entries: HistoryEntry[]; nextBefore: number | null }>
interface ActivityGroup { batchId: string | null; userId: string; label: string; summary: string; at: string; fromSeq: number; toSeq: number; count: number; via: Via; agent: string | null }
activityFeed(db: Executor, actor: Actor, input: { showId: string; layer?: string; kind?: 'human' | 'agent' | 'all'; before?: number; limit?: number }): Promise<{ groups: ActivityGroup[]; nextBefore: number | null }>
```

  Viewer and above. Newest first; `limit` default 50, max 200 (entries or groups). `kind: 'agent'` means `agent IS NOT NULL`. Every query adds the privacy filter `layer IS NULL OR layer NOT LIKE 'personal:%' OR layer = 'personal:' || <actor id>`. Groups are maximal runs of consecutive rows (by `seq`) sharing `batchId` and `userId`; rows without a batch id stand alone; `summary` is `summariseBatch` with department codes resolved from each row's `layer`; `at` is the group's newest `server_ts`. User names come from the auth `user` table.
- Produces, `revert.ts`: `interface RevertResult { batchId: string; reverted: number; skipped: Array<{ seq: number; reason: 'row-gone' | 'already-reverted' }> }`; `revertChange(db: Executor, actor: Actor, input: { seq: number; force?: boolean }): Promise<RevertResult>`; `revertBatch(db: Executor, actor: Actor, input: { showId: string; batchId: string; userId: string; force?: boolean; dryRun?: boolean }): Promise<RevertResult & { rows: number; deletes: number }>`. `revertBatch` touches only change-log rows whose `show_id`, `batch_id`, and `user_id` all match (an `ActivityGroup` carries both ids), so two users can never be reverted together even if their clients chose the same batch id; `dryRun` computes `rows` (change-log rows it would revert) and `deletes` (rows it would delete) and writes nothing. Both write through the owning services with a new batch id in one transaction, so the revert is logged and revertable and layer rights are checked on the row (both layers when it moves between them). Revertable: every op on `cues` and `annotations`; updates only on `departments`, `documents`, and `shows`; anything else is `invalid`. Rows on another user's personal layer are `not_found`. Every row needs edit rights on its layer (spec 4.12); the one exception, the server-authored re-anchoring batch, is added in Task 18 and recognised by its rows, never by an id prefix. The computation, per change-log row, newest first:

```
update: current = load(row); null -> skipped 'row-gone' (a batch revert continues; a single revert is conflict)
        drift = keys of after where !columnEqual(current[k], after[k])
        drift non-empty and !force -> conflict listing the drifted keys (whole call writes nothing)
        write before (all its keys) through the service's update
insert: current null -> skipped 'already-reverted'
        drift as above against after; !force -> conflict; else delete through the service
delete: current present -> conflict 'row exists again' unless force, which skips it
        else create through the service with id = row_id and fields = before
```

  `columnEqual` is Task 2's (JSON compared as values, key order ignored). Routes: `GET /api/shows/:showId/history`, `GET /api/shows/:showId/activity` (query parameters as the inputs), `POST /api/shows/:showId/revert` `{ seq } | { batchId, userId }` with optional `force`.
- MCP `tools/history.ts`: `get_history`, `get_activity` (read, paginated by `before`), `revert_change {seq, force?}`, `revert_batch {showId, batchId, userId, force?, confirm?}`. Spec 3.10's confirmation gate: `revert_batch` first runs `revertBatch` with `dryRun: true` and, when `rows > CONFIRM_THRESHOLD` or `deletes > CONFIRM_THRESHOLD` and `confirm` is not `true`, returns `confirmationRequired('Reverting this batch changes <rows> rows and deletes <deletes>.')` without writing. `revert_change` reverts one row, so it never deletes more than one and needs no gate.

- [ ] **Step 1: Write the failing core tests**

```ts
test('three moves and one relabel of TM cues', () => expect(summariseBatch([...moves(3, 'TM'), relabel('TM')])).toBe('moved 3 TM cues and relabelled 1'))
test('forty-two TM cues placed', () => expect(summariseBatch(placed(42, 'TM'))).toBe('placed 42 TM cues'))
test('one unplaced LX cue added', () => expect(summariseBatch(added(1, 'LX'))).toBe('added 1 LX cue'))
test('two departments', () => expect(summariseBatch([...moves(2, 'LX'), ...deleted(1, 'SND')])).toBe('moved 2 LX cues; deleted 1 SND cue'))
test('agent label drops the version', () => expect(actorLabel('Jayden', 'Claude Code/2.1.0')).toBe('Jayden via Claude Code'))
```

- [ ] **Step 2: Run to verify they fail, implement, run until they pass** (`pnpm vitest run packages/core`)

- [ ] **Step 3: Write the failing API tests**

```ts
// history.test.ts (setupMarkupShow)
test('listHistory filters by row, table, layer, user, kind, and time, newest first, paginated by before', ...)
test('another user\'s personal-layer rows never appear in history or the activity feed', async () => {   // Review Focus 2
  const note = await createAnnotation(db, actors.viewer, { ...personalNote(viewer.id), batchId: 'note-batch' })
  const { entries } = await listHistory(db, actors.owner, { showId })
  expect(entries.map((e) => e.rowId)).not.toContain(note.id)
  const { groups } = await activityFeed(db, actors.owner, { showId })
  expect(groups.find((g) => g.batchId === 'note-batch')).toBeUndefined()
  expect((await listHistory(db, actors.viewer, { showId, rowId: note.id })).entries).toHaveLength(1)
})
test('the activity feed groups by batch and user: "moved 3 TM cues and relabelled 1"', ...)
test('every accepted sync change produced exactly one change log row with the touched columns', ...)   // spec 9 completeness
// revert.test.ts
test('reverting a relabel restores the old label as a new logged write in a new batch', ...)
test('reverting an insert deletes the cue; reverting that delete re-creates it with the same id and fields', ...)
test('reverting a change whose field has since changed is conflict, and force reverts it', async () => {   // Review Focus 5
  await updateCue(db, actors.owner, { cueId, patch: { label: 'Fly in' } })          // was 'Fly out'
  const seq = await lastSeq(cueId)
  await updateCue(db, actors.editor, { cueId, patch: { label: 'Fly in slowly' } })
  expect(await code(revertChange(db, actors.owner, { seq }))).toBe('conflict')
  expect((await getCue(db, actors.owner, { cueId })).label).toBe('Fly in slowly')
  await revertChange(db, actors.owner, { seq, force: true })
  expect((await getCue(db, actors.owner, { cueId })).label).toBe('Fly out')
})
test('two users whose uploads reused a client batch id are reverted separately', async () => {   // Review Focus 5
  // owner and editor each upload batch 'dev-1' through POST /api/sync/upload, relabelling different cues
  await revertBatch(db, actors.owner, { showId, batchId: `${owner.id}:dev-1`, userId: owner.id })
  expect((await getCue(db, actors.owner, { cueId: ownersCue })).label).toBe('before')
  expect((await getCue(db, actors.owner, { cueId: editorsCue })).label).toBe('editor label')
})
test('revertBatch with the right batch id but another user id touches nothing', ...)
test('reverting the same batch twice is conflict the second time', ...)
test('the LX editor reverting a batch that touched SND is forbidden and nothing changes', ...)
test('reverting a change on someone else\'s personal annotation is not_found', ...)
test('HTTP: POST /api/shows/:id/revert with a batchId returns the new batch id', ...)
// mcpHistory.test.ts
test('get_activity labels MCP batches "<name> via test-client"; revert_change works through MCP', ...)
test('revert_batch over ten rows returns CONFIRMATION_REQUIRED and writes nothing; with confirm it reverts', async () => {
  const r = await callTool(client, 'revert_batch', { showId, batchId, userId })   // a batch that placed 11 cues
  expect(r.structuredContent?.code).toBe('CONFIRMATION_REQUIRED')
  expect(await rowCount(cues, showId)).toBe(11)
  await callTool(client, 'revert_batch', { showId, batchId, userId, confirm: true })
  expect(await rowCount(cues, showId)).toBe(0)
})
```

- [ ] **Step 4: Run to verify they fail, implement, run until they pass**

Run: `pnpm vitest run apps/api/test/history.test.ts apps/api/test/revert.test.ts apps/api/test/mcpHistory.test.ts apps/api/test/mcpParity.test.ts`

- [ ] **Step 5: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(history): change log views, activity feed, and revert"
```

---

### Task 12: History screens

**Files:**
- Create: `apps/web/src/history/{api.ts,formatChange.ts,HistoryPanel.tsx,ActivityFeed.tsx,NeedsConnection.tsx}`, `apps/web/src/routes/shows.$showId.activity.tsx`, `apps/web/e2e/history.spec.ts`
- Modify: `apps/web/src/markup/CueEditor.tsx` and `apps/web/src/markup/AnnotationEditor.tsx` (their `historySlot` gets the History tab), the show page (Activity link)
- Test: `apps/web/src/history/formatChange.test.ts`, `apps/web/e2e/history.spec.ts`

**Interfaces:**
- Consumes: Task 11's routes and shared `HistoryEntry`/`ActivityGroup`; `actorLabel`; `formatCueNumber`; the `historySlot` of Task 7's `CueEditor` and Task 8's `AnnotationEditor`.
- Produces: `useRowHistory(showId, rowId)`, `useActivity(showId, filters)` (TanStack Query, `enabled` only while `navigator.onLine`), `useRevert()` (mutation taking `{ seq }` or `{ batchId, userId }` from an `ActivityGroup`; a `conflict` answer asks "This has changed since. Revert anyway?" and retries with `force: true` on yes). `formatChange(entry: HistoryEntry, ctx: { departmentCode: string | null; numberFormat: NumberFormat }): string[]`: anchor changes `Moved p.9 → p.10` (same page: `Moved on p.9`); number `Renumbered LX 12 → LX 12.5`; label `Label "Fly out" → "Fly in"`; type `Type go → standby`; notes `Notes edited`; insert `Placed on p.3` or `Added (unplaced)`; delete `Deleted`; for annotations, `text` `Text edited`, `geometry` `Resized`, `style` `Restyled`. `NeedsConnection` renders "History needs a connection." whenever offline; personal undo keeps working.
- Screens: the History tab of both the cue editor and the annotation editor lists who (`actorLabel`), when (local time), and `formatChange` lines with "Revert this change"; `/shows/$showId/activity` lists groups as `<label> <summary>, <HH:mm>` with layer and human/agent filters and "Revert" per group, loading more on scroll.

- [ ] **Step 1: Write the failing unit test**

```ts
test.each([
  [{ op: 'update', before: { anchor: { pageIndex: 8 } }, after: { anchor: { pageIndex: 9 } } }, ['Moved p.9 → p.10']],
  [{ op: 'update', before: { major: 12, minor: 0 }, after: { major: 12, minor: 50 } }, ['Renumbered LX 12 → LX 12.5']],
  [{ op: 'update', before: { label: 'Fly out' }, after: { label: 'Fly in' } }, ['Label "Fly out" → "Fly in"']],
  [{ op: 'insert', before: null, after: { anchor: null } }, ['Added (unplaced)']],
])('formats %j', (entry, lines) => expect(formatChange(entryOf(entry), { departmentCode: 'LX', numberFormat: 'decimal' })).toEqual(lines))
```

- [ ] **Step 2: Run to verify it fails, implement, run until it passes** (`pnpm vitest run apps/web`)

- [ ] **Step 3: Write the failing e2e, implement the screens, run until it passes**

```ts
test('the activity feed shows A\'s batch summary and B\'s revert from row history restores the label for both', ...)
test('an annotation\'s History tab lists its text edit and reverts it', ...)
test('offline, the History tab says it needs a connection and undo still works', ...)
```

Run: `pnpm --filter @binder/web e2e --grep "activity feed|History tab"`

- [ ] **Step 4: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(web): row history, activity feed, and revert"
```

---

### Task 13: Print stamping in core

**Files:**
- Create: `packages/core/src/print/{winAnsi.ts,footer.ts,stampItems.ts,stampScript.ts}`, `apps/api/test/printExport.test.ts`
- Modify: `packages/core/{package.json,src/index.ts}` (`pdf-lib`), `fixtures/scripts/{make-fixtures.ts,paths.ts}` (`FIXTURES.offsetPdf`)
- Test: `packages/core/src/print/{winAnsi,footer,stampItems}.test.ts`, `apps/api/test/printExport.test.ts`

**Interfaces:**
- Consumes: `markerText`, `markerStyle`, `cueMarkerBox` geometry rules (Task 6); `CueFields`, `AnnotationFields` (shared); `formatCueNumber`.
- Produces:

```ts
interface FooterInfo { showTitle: string; documentLabel: string; layerLabel: string; binderVersion: number | null; exportId: string; date: Date }
footerText(f: FooterInfo): string      // `${showTitle} · ${documentLabel} · ${layerLabel} · ${binderVersion === null ? 'export ' + exportId.slice(-8) : 'Binder v' + binderVersion} · ${YYYY-MM-DD HH:mm}` (local time)
layerSelectionLabel(sel: LayerRef[], departments: Array<{ id: string; code: string }>): string   // [] -> 'Clean copy'; every department -> 'All layers'; else codes in department order joined ', ', plus ' + personal' when a personal layer is in
toWinAnsi(s: string): string           // per code point: printable ASCII, U+00A0..U+00FF, and the 27 CP1252 extras (€ ‚ ƒ „ … † ‡ ˆ ‰ Š ‹ Œ Ž ‘ ’ “ ” • – — ˜ ™ š › œ ž Ÿ) pass; line breaks become spaces; everything else becomes '?'
type StampItem =
  | { kind: 'cue'; pageIndex: number; x: number; y: number; type: CueType; boxText: string; labelText: string; colour: string }
  | { kind: 'annotation'; pageIndex: number; x: number; y: number; type: AnnotationType; geometry: Record<string, number>; text: string; colour: string; strokeWidth: number; fontSize: number; wordBoxes: Word[] }
buildStampItems(input: { versionId: string; layers: LayerRef[]; cues: Array<CueFields & { id: string }>; annotations: Array<AnnotationFields & { id: string }>; departments: Array<{ id: string; code: string; colour: string; numberFormat: NumberFormat }>; wordLayers: ReadonlyMap<number, WordLayer> }): StampItem[]   // only anchors on versionId and in the selected layers; personal annotations use PERSONAL_LAYER_COLOUR unless styled
stampScript(pdf: Uint8Array, items: StampItem[], footer: FooterInfo): Promise<Uint8Array>
```

  `stampScript` loads with pdf-lib, keeps every page's size, boxes, and content (the text layer survives because pages are only drawn on), draws markers like the screen (Task 6's box geometry and styles, Helvetica, every string through `toWinAnsi`) and annotations, and a 7 pt grey footer 12 pt above the displayed bottom edge, 24 pt from the displayed left. Displayed coordinates are relative to the page's visible box (the crop box, else the media box), as poppler reports them, so with `(bx, by)` that box's lower-left corner, `W`, `H` its unrotated width and height, and `/Rotate` applied, a displayed point `(dx, dy)` maps to user space as below, and text is drawn rotated by the same angle so it reads upright:

  | Rotate | user x | user y |
  |---|---|---|
  | 0 | bx + dx | by + dy |
  | 90 | bx + W − dy | by + dx |
  | 180 | bx + W − dx | by + H − dy |
  | 270 | bx + dy | by + H − dx |

- Fixture: `FIXTURES.offsetPdf`, one A4 page whose media box and crop box start at (50, 50) with "OFFSET" drawn at the visible top-left.

- [ ] **Step 1: Write the failing core tests**

```ts
test('toWinAnsi keeps Latin-1 and CP1252 punctuation and replaces the rest', () =>
  expect(toWinAnsi('Ça va — “ok” ✓ 東京 🎭\nend')).toBe('Ça va — “ok” ? ?? ? end'))
test('footer text', () => expect(footerText({ showTitle: 'Pirates', documentLabel: 'Libretto v2', layerLabel: 'LX, SND', binderVersion: null, exportId: '0190f3a2-0000-7000-8000-00000000abcd', date: new Date(2026, 9, 15, 14, 2) }))
  .toBe('Pirates · Libretto v2 · LX, SND · export 0000abcd · 2026-10-15 14:02'))
test('layer labels: none is Clean copy, every department is All layers', ...)
test('buildStampItems keeps only the version and the selected layers, with marker text and colour', ...)
```

- [ ] **Step 2: Run to verify they fail, implement, run until they pass** (`pnpm vitest run packages/core`)

- [ ] **Step 3: Write the failing poppler-backed tests** (in `apps/api/test` because poppler and the fixtures live there; skip when tools are missing)

```ts
test('a cue stamped at the displayed top-left of the rotated page reads top-left in pdftotext', async () => {   // Review Focus 4
  const out = await stampScript(read(FIXTURES.mixedPdf), [cueAt(1, 72, height - 72, 'LX 10')], footer)
  const word = bboxWords(out, 1).find((w) => w.t === 'LX')!                       // pdftotext -bbox-layout, displayed space, top-left origin
  expect(word.xMin).toBeLessThan(0.25 * width); expect(word.yMin).toBeLessThan(0.25 * height)
})
test('a page whose crop box starts at (50, 50) stamps at the visible top-left', async () => {   // Review Focus 4
  const out = await stampScript(read(FIXTURES.offsetPdf), [cueAt(0, 72, height - 72, 'LX 10')], footer)
  const word = bboxWords(out, 0).find((w) => w.t === 'LX')!
  expect(word.xMin).toBeLessThan(0.25 * width); expect(word.yMin).toBeLessThan(0.25 * height)
})
test('stamping keeps page count, sizes, and the text layer', async () => {
  const out = await stampScript(read(FIXTURES.scanPdf), [cueAt(0, 72, 700, 'LX 10')], footer)
  expect(await pageSizes(out)).toEqual(await pageSizes(read(FIXTURES.scanPdf)))
  expect(pdftotext(out, 0)).toContain('LX 10')
})
test('a label outside WinAnsi stamps with question marks instead of throwing', async () => {   // Review Focus 4
  const out = await stampScript(read(FIXTURES.librettoPdf), [cueAt(0, 72, 700, 'LX 10', 'Ça va ✓ 東京')], footer)
  expect(pdftotext(out, 0)).toContain('Ça va ? ??')
})
test('every page carries the footer', ...)
```

- [ ] **Step 4: Run to verify they fail, implement, run until they pass**

Run: `pnpm vitest run fixtures apps/api/test/printExport.test.ts`

- [ ] **Step 5: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(core): print stamping with rotation, crop box, and WinAnsi safety"
```

---

### Task 14: Export records, export privacy, and server-side export

**Files:**
- Create: `packages/db/src/schema/exports.ts`, the generated migration, custom migration `export_records_sync`, `apps/api/src/services/exports.ts`, `apps/api/src/routes/exports.ts`, `apps/api/src/mcp/tools/exports.ts`, `apps/api/src/mcp/resources/exports.ts`
- Modify: `packages/db/src/{schema/index.ts,synced.ts}`, `apps/api/src/blob/keys.ts`, `apps/api/src/routes/blobs.ts`, `apps/api/src/services/index.ts`, `apps/api/src/app.ts`, `apps/api/src/mcp/{registry.ts,server.ts}`, `deploy/powersync/sync-config.yaml`, `apps/web/src/powersync/{schema.ts,schema.test.ts}`
- Test: `apps/api/test/exports.test.ts`, `apps/api/test/mcpExports.test.ts`, additions to `packages/db/test/publication.test.ts`

**Interfaces:**
- Consumes: Task 13's `buildStampItems`, `stampScript`, `layerSelectionLabel`; `loadVersionText` (Task 5); cue and annotation rows.
- Produces, db: `export_records(id, show_id → shows cascade, kind text ('tmix' | 'pdf-script' | 'pdf-sheet' | 'csv' | 'xlsx'), filename text, cast_variant_id text null, layer_selection jsonb, snapshot_id text null, binder_version integer null, private_to text null, file_key text not null, changelog jsonb null, created_by text, created_at, updated_at, updated_by)`, index `show_id`. `xlsx` extends the spec's kind list for the XLSX cue sheet (section 7). `private_to` is the exporting user's id when the selection includes their personal layer. `SYNCED_TABLES` gains `export_records`; streams: `... WHERE show_id IN user_shows AND private_to IS NULL` and `... WHERE show_id IN user_shows AND private_to = auth.user_id()` (same fallback rule as Task 4).
- Produces, keys: `exportBlobKey(showId: string, exportId: string, nonce: string, ext: 'pdf' | 'csv' | 'xlsx'): string` = `shows/{showId}/exports/{exportId}/{nonce}.{ext}` with a server-generated `nonce` (`newId()`), so two uploads racing on one export id never write the same key; `parseExportKey(key: string): { showId: string; exportId: string } | null`.
- Produces, `exports.ts`:
  - `type ExportRecord = InferSelectModel<typeof exportRecords>`;
  - `readableExport(db: Executor, actor: Actor, input: { exportId: string }): Promise<ExportRecord>` (internal, imported from the module, not in the barrel): the single guard for every read of an export: `requireShowRole(viewer)` on its show, then `not_found` when the row does not exist or is private to someone else;
  - `createExportRecord(db: Executor, blobs: BlobStore, actor: Actor, input: { id: string; showId: string; kind: 'pdf-script' | 'pdf-sheet' | 'csv' | 'xlsx'; filename: string; layerSelection: LayerRef[]; file: Readable; declaredSize?: number; createdAt?: Date }): Promise<ExportRecord>`: viewer and above; a personal layer in the selection must be the actor's own (`forbidden`); filename 1 to 200 characters; the existing-id check runs before anything is stored: an id already created by the same user returns that record and drains the stream without storing, by another user is `conflict`; otherwise the blob goes to a fresh nonce key, the row is inserted, and a 23505 on the insert deletes the new blob and returns or refuses as above;
  - `listExportRecords(db, actor, { showId }): Promise<ExportRecord[]>` (newest first, others' private records hidden);
  - `exportMarkedScript(db: Executor, blobs: BlobStore, actor: Actor, input: { documentId: string; versionId?: string; layers: 'all' | 'none' | LayerRef[] }): Promise<{ record: ExportRecord; uri: string }>` (server-side `buildStampItems` and `stampScript` over the version's searchable PDF; `'all'` means every non-hidden department and no personal layer; filename `<show> - <document> v<n> - <layer label>.pdf` with `/\:*?"<>|` replaced by `-`; `uri` = `binder://shows/{showId}/exports/{exportId}`). In M1 `snapshot_id`, `binder_version`, and `changelog` stay null (snapshots are M2).
- `GET /blobs/*` for any key under `shows/{showId}/exports/` calls `readableExport` and also requires the key to equal the record's `file_key`; a key with no record row (yet) or a private one is 404. The MCP resource template `binder://shows/{showId}/exports/{exportId}` uses the same guard and returns the file as a blob.
- Route `POST /api/shows/:showId/exports` (multipart: field `meta` = JSON `{ id, kind, filename, layerSelection, createdAt }`, then `file`; PDF kinds pass M0's `%PDF-` check) → 201; `GET /api/shows/:showId/exports`. MCP: `list_exports {showId}` (read), `export_marked_script {documentId, versionId?, layers}` returning the record and a `resource_link` to the URI. `createExportRecord` goes in `UI_ONLY_OPERATIONS`: "client-generated exports upload their file over REST; agents export with export_marked_script and export_cue_list, which create the record server side".

- [ ] **Step 1: Write the failing tests**

```ts
// exports.test.ts (setupMarkupShow)
test('a viewer uploads an export; a replay with the same id returns the record and stores one blob', async () => {
  const a = await post(viewer, meta(id), pdf); const b = await post(viewer, meta(id), pdf)
  expect(b.status).toBe(201); expect((await b.json()).id).toBe((await a.json()).id)
  expect((await blobFiles(deps)).filter((f) => f.includes(`/exports/${id}/`))).toHaveLength(1)
})
test('the same export id from another user is conflict and stores nothing', ...)
test('an export with my personal layer is invisible to others in the list and its blob is 404 for them', async () => {   // Review Focus 2
  const rec = await createExportRecord(db, blobs, actors.viewer, { ...pdfExport, layerSelection: [{ kind: 'personal', id: viewer.id }] })
  expect((await listExportRecords(db, actors.owner, { showId })).map((r) => r.id)).not.toContain(rec.id)
  expect((await app.request(`/blobs/${rec.fileKey}`, { headers: { cookie: owner.cookie } })).status).toBe(404)
  expect((await app.request(`/blobs/${rec.fileKey}`, { headers: { cookie: viewer.cookie } })).status).toBe(200)
})
test('an export key with no record row is 404, even for an owner', async () => {   // Review Focus 2
  expect((await app.request(`/blobs/${exportBlobKey(showId, newId(), newId(), 'pdf')}`, { headers: { cookie: owner.cookie } })).status).toBe(404)
})
test('including another user\'s personal layer is forbidden', ...)
// mcpExports.test.ts
test('export_marked_script stores a PDF and returns a resource link that reads back as application/pdf', ...)
test('another member\'s token cannot read a private export through the resource', async () => {   // Review Focus 2
  await expect(ownerClient.readResource({ uri: `binder://shows/${showId}/exports/${privateId}` })).rejects.toThrow(/not found/i)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run apps/api/test/exports.test.ts apps/api/test/mcpExports.test.ts apps/api/test/blobs.test.ts apps/api/test/mcpParity.test.ts packages/db apps/web/src/powersync`

- [ ] **Step 3: Implement**, **Step 4: Run to verify they pass** (same command)

- [ ] **Step 5: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(exports): export records with private exports and server-side marked script"
```

---

### Task 15: Print dialog, export outbox, and the exports screen

**Files:**
- Create: `apps/web/src/exports/{PrintDialog.tsx,runPrintExport.ts,outbox.ts,useExports.ts}`, `apps/web/src/routes/shows.$showId.exports.tsx`, `apps/web/e2e/export.spec.ts`
- Modify: `apps/web/package.json` (`idb-keyval`), `apps/web/src/main.tsx` (flush the outbox on start and on `online`), `apps/web/src/auth/signOut.ts` (clear the user's outbox), the viewer toolbar (Print)
- Test: `apps/web/src/exports/outbox.test.ts`, `apps/web/e2e/export.spec.ts`

**Interfaces:**
- Consumes: Task 13's core print functions; Task 14's upload route and synced `export_records`; `fetchBlob` and the cached searchable PDF and word layers (M0).
- Produces: `runPrintExport(db, ctx: EditContext, input: { documentId: string; versionId: string; layers: LayerRef[] }): Promise<{ id: string; filename: string; bytes: Uint8Array }>` (local rows, the cached PDF and word layers, `buildStampItems`, `stampScript`, then a browser download); `outbox.ts`: `interface PendingExport { id: string; showId: string; userId: string; meta: { id: string; kind: string; filename: string; layerSelection: LayerRef[]; createdAt: string }; bytes: Uint8Array; contentType: string }`, `enqueueExport(p: PendingExport, store?: OutboxStore): Promise<void>`, `flushOutbox(userId: string, opts?: { store?: OutboxStore; post?: (p: PendingExport) => Promise<Response> }): Promise<{ sent: number; kept: number; dropped: number }>` (2xx removes, 4xx removes with a notice, network errors and 5xx keep), `clearOutbox(userId: string, store?: OutboxStore): Promise<void>`. `OutboxStore` defaults to an `idb-keyval` store named `binder-exports-<userId>`, so entries belong to one user: sign-out clears it, and a different user signing in (R36's ownership marker changing) never flushes the previous user's files. `PrintDialog`: presets "Calling script: all layers" and "Clean copy", and per-layer checkboxes including your personal layer. `/shows/$showId/exports` lists records newest first with "Download again" and "What changed since this" (the activity feed from that record's `created_at`; snapshot changelogs are M2).

- [ ] **Step 1: Write the failing unit tests**

```ts
test('2xx removes, 4xx drops with a notice, network failure and 5xx keep for the next flush', ...)
test('flushing as user B never sends user A\'s pending exports; clearOutbox(A) empties A\'s store', ...)
```

- [ ] **Step 2: Run to verify they fail, implement, run until they pass** (`pnpm vitest run apps/web`)

- [ ] **Step 3: Write the failing e2e, implement the dialog, outbox wiring, and screen, run until it passes**

```ts
test('exporting the calling script downloads a PDF with the same page count whose text has the script and "LX 10", and the exports screen lists it', ...)   // pdftotext on the download
test('an export made offline downloads at once and its record appears after reconnecting', ...)
```

Run: `pnpm --filter @binder/web e2e --grep "calling script|made offline"`

- [ ] **Step 4: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(web): print dialog, export outbox, and exports screen"
```

---

### Task 16: Cue sheet PDF, XLSX, and CSV export

**Files:**
- Create: `packages/core/src/sheets/{cueSheet.ts,xlsx.ts}`
- Modify: `packages/core/{package.json,src/index.ts}` (`fflate`), `apps/api/src/services/{exports.ts,index.ts}`, `apps/api/src/upload/multipart.ts` (generalise the magic check), `apps/api/src/routes/exports.ts` (CSV and XLSX uploads), `apps/api/src/mcp/{registry.ts,tools/exports.ts}`, `apps/web/src/cuelist/CueListTable.tsx` (export buttons), `apps/web/src/routes/shows.$showId.settings.tsx` (paper size)
- Test: `packages/core/src/sheets/{cueSheet,xlsx}.test.ts`, `apps/api/test/cueSheetExport.test.ts`

**Interfaces:**
- Consumes: `cueListRows` and `CueListRow` (Task 10, core), `footerText`, `toWinAnsi` (Task 13), `createExportRecord` (Task 14), outbox (Task 15).
- Produces, core `cueSheet.ts`: `interface CueSheetRow { cue: string; type: CueType; label: string; page: number | null; document: string; trigger: string; notes: string; status: string }` (`page` is one-based; `document` is the title only when the department has cues in more than one document; `status` = Task 10's flags as words: `duplicate`, `approximate`, `unresolved`, `on older version`, joined `, `); `toCueSheetRows(rows: CueListRow[]): CueSheetRow[]`; `CUE_SHEET_COLUMNS = ['Cue', 'Type', 'Label', 'Page', 'Document', 'Trigger', 'Notes', 'Status']`; `cueSheetCsv(rows): string` (`﻿`, that header, CRLF line ends, RFC 4180 quoting, an empty cell for a null page, and a cell starting with `=`, `+`, `-`, `@`, tab, or carriage return is prefixed with `'`); `cueSheetPdf(rows, opts: { title: string; paper: 'A4' | 'Letter'; footer: FooterInfo }): Promise<Uint8Array>` (portrait, header row repeated on every page, long cells wrapped, footer on every page).
- Produces, core `xlsx.ts`: `cueSheetXlsx(rows: CueSheetRow[], opts: { sheetName: string }): Uint8Array`: one worksheet, the header row, `Page` written as a number cell (`t="n"`) and blank when null, every other column as an inline string cell (`t="inlineStr"`), so cue numbers keep their format ("10.50"); the package is the minimal SpreadsheetML part set (`[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/worksheets/sheet1.xml`) zipped with `fflate`'s `zipSync`; XML text is escaped and control characters other than tab, line feed, and carriage return are dropped.
- Paper: `paperSize(settings): 'A4' | 'Letter'` in `@binder/shared` (default `'A4'`), set by the owner on the settings page.
- Produces, `exports.ts`: `exportCueList(db: Executor, blobs: BlobStore, actor: Actor, input: { departmentId: string; format: 'pdf' | 'xlsx' | 'csv' }): Promise<{ record: ExportRecord; uri: string }>` (kind `pdf-sheet`, `xlsx`, or `csv`; layer selection the department; filename `<show> - <CODE> cue sheet.pdf|xlsx|csv`). MCP `export_cue_list {department | departmentId, showId?, format}`. `readPdfUpload` becomes `readUpload(c, maxBytes, opts: { magic?: string })`: PDF kinds pass `'%PDF-'`, XLSX `'PK'`, CSV none. The cue list screen gets PDF, XLSX, and CSV buttons that generate on the client and go through the outbox.

- [ ] **Step 1: Write the failing core tests**

```ts
test('CSV has a BOM, CRLF, quoting, and a formula guard', () => {
  const csv = cueSheetCsv([row({ cue: '10', label: 'Lights, up', page: 1, notes: 'He said "go"' }), row({ cue: '10.5', label: '=SUM(A1)', page: 1, notes: 'two\nlines' })])
  expect(csv.startsWith('﻿Cue,Type,Label,Page,Document,Trigger,Notes,Status\r\n')).toBe(true)
  expect(csv).toContain('10,go,"Lights, up",1,,,"He said ""go""",\r\n')
  expect(csv).toContain(`10.5,go,'=SUM(A1),1,,,"two\nlines",\r\n`)
})
test('XLSX unzips to the five parts; page is a number cell and the cue number a string', () => {
  const files = unzipSync(cueSheetXlsx([row({ cue: '10.50', page: 3 }), row({ cue: '11', page: null })], { sheetName: 'LX' }))
  expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'])
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml'])
  expect(sheet).toContain('<c r="D2" t="n"><v>3</v></c>'); expect(sheet).toContain('<t>10.50</t>'); expect(sheet).not.toContain('r="D3" t="n"')
})
test('XLSX escapes markup and drops control characters', ...)   // label '<b>&' -> '&lt;b&gt;&amp;'
test('a 120-row PDF on A4 has more than one page; Letter pages are 612 x 792', ...)
```

- [ ] **Step 2: Run to verify they fail, implement, run until they pass** (`pnpm vitest run packages/core`)

- [ ] **Step 3: Write the failing API test, implement the service, tool, and buttons, run until it passes**

```ts
test('export_cue_list csv stores a record whose blob starts with the BOM and lists LX 10 with its trigger quote', ...)
test('export_cue_list xlsx stores a record whose blob starts with PK and unzips to a sheet listing LX 10', ...)
test('export_cue_list pdf: pdftotext of the blob contains the cue numbers and the footer', ...)
```

Run: `pnpm vitest run apps/api/test/cueSheetExport.test.ts apps/api/test/mcpParity.test.ts apps/web`

- [ ] **Step 4: Check the XLSX by hand**: open one in Excel or Numbers and in Google Sheets; it opens without a repair prompt and Page sorts numerically.

- [ ] **Step 5: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(exports): per-department cue sheet as PDF, XLSX, and CSV"
```

---
### Task 17: Re-anchoring matcher and version line diff

**Files:**
- Create: `packages/core/src/anchors/{reanchor.ts,lineDiff.ts}`, `packages/core/test/textLayers.ts`
- Modify: `packages/core/{package.json,src/index.ts}` (`diff`)
- Test: `packages/core/src/anchors/reanchor.test.ts`, `packages/core/src/anchors/lineDiff.test.ts`

**Interfaces:**
- Consumes: Task 5's `VersionText`, `buildWordStream`, `findQuote`, `anchorAtMatch`, `lineCentreY`.
- Produces: `reanchor(anchor: Anchor, from: VersionText, to: VersionText): Anchor`; `reanchorAll(anchors: Anchor[], from: VersionText, to: VersionText): Anchor[]` (builds the target stream once; output length always equals input length); `interface LineRef { pageIndex: number; lineIndex: number }`; `type LineDiffEntry = { op: 'same' | 'added' | 'removed'; text: string; old?: LineRef; new?: LineRef }`; `diffVersionLines(from: VersionText, to: VersionText): { entries: LineDiffEntry[]; added: number; removed: number }` (lines in stream order, compared by their `normaliseForMatch` tokens joined by spaces, diffed with `diffArrays` from `diff`; `text` is the line's original words).
- The matching order (spec 5.4), which the signature does not determine:

```
reanchor(a, from, to):
  result.documentVersionId = to.versionId
  if a.text and a.text.quote:
    stream = buildWordStream(to.layers)
    for mode in ['exact', 'normalised']:
      ms = findQuote(stream, a.text.quote, mode)
      if ms.length == 1: return place(ms[0], mode == 'exact' ? 'ok' : 'approximate')
      if ms.length > 1:  return place(closest(ms), 'approximate')
  # no text anchor, or the quote was not found
  if to.pageCount == from.pageCount: same pageIndex, x, y (clamped), status 'approximate'
  else if a.pageIndex < to.pageCount: same pageIndex, x, y (clamped), status 'unresolved'
  else: pageIndex = to.pageCount - 1, same x, y (clamped), status 'unresolved'
  text, when present, keeps its quote with wordStart = wordEnd = -1 (unbound)
  a positional result never upgrades a worse earlier status: status = worse(fallback status, a.status), ordering ok < approximate < unresolved
  (an anchor still 'unresolved' or unreviewed 'approximate' from an earlier run stays so)

place(m, status):
  p = anchorAtMatch(stream, m, to)
  oldLineLeft = x of the first word of the old line containing a.text.wordStart (when wordStart >= 0 and the old layer has it)
  x = oldLineLeft == null ? p.x : p.lineLeft + (a.x - oldLineLeft)        # x kept relative to the line's left edge
  return { pageIndex: p.pageIndex, x, y: p.y, text: { quote: a.text.quote, wordStart: p.text.wordStart, wordEnd: p.text.wordEnd }, status }   (clamped)

closest(ms): the match minimising |rel(match) - rel(a)|, earliest on a tie, where
  rel(pageIndex, y, height, pageCount) = (pageIndex + (height - y) / height) / pageCount,
  using the match's start page and line centre on `to`, and the anchor's page and y on `from`
clamp: x into [0, width], y into [0, height] of the target page; a page with null dimensions takes the source page's; both null: no clamp
```

- Test helper `textLayers.ts`: `versionFromLines(lines: string[], opts: { versionId: string; linesPerPage?: number (48); left?: number (72); top?: number (770); lineHeight?: number (14); charWidth?: number (6); width?: number (595); height?: number (842) }): VersionText`, splitting each line on spaces into words with deterministic boxes; `lines` comes from `fixtures/public/pirates.txt` read in the test (core tests may read files; `packages/core/src` may not).

- [ ] **Step 1: Write the failing tests** (old version: pirates.txt; anchors: 50 quotes taken with `snapToLine` at evenly spaced lines, plus three anchors without text)

```ts
test('an identical version keeps every anchor ok at the same position', ...)
test('cutting lines 201-240 keeps the others ok on their new page and line; cut quotes fall back by page count', ...)
test('adding 30 lines shifts later anchors and keeps them ok', ...)
test('inserting a page after page 5 moves later anchors one page on, ok', ...)
test('removing page 10: its quotes are gone, so its anchors stay on page 10 unresolved; a text-less anchor on the old last page lands on the new last page, unresolved', ...)
test('different margins and 44 lines per page: all ok, x keeps its offset from the line\'s left edge', () => {
  // old a.x = oldLineLeft + 15 -> new x = newLineLeft + 15 (left 72 -> 100)
})
test('a quote that now appears twice picks the nearer relative position, approximate', ...)
test('a case change matches normalised, approximate', ...)
test('without text: equal page counts approximate, different unresolved, past the end the last page', ...)
test('a positional match keeps an earlier worse status', () => {
  expect(reanchor({ ...noText, status: 'unresolved' }, from, sameCount).status).toBe('unresolved')
  expect(reanchor({ ...noText, status: 'approximate' }, from, sameCount).status).toBe('approximate')
  expect(reanchor({ ...noText, status: 'ok' }, from, sameCount).status).toBe('approximate')
})
test('reanchorAll never drops an anchor', ...)
// lineDiff.test.ts
test('cut lines are removed with old refs, added lines added with new refs, identical versions all same', ...)
```

- [ ] **Step 2: Run to verify they fail**, **Step 3: Implement**, **Step 4: Run to verify they pass** (`pnpm vitest run packages/core`)

- [ ] **Step 5: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(core): re-anchoring matcher and version line diff"
```

---

### Task 18: Re-anchoring job

**Files:**
- Create: `apps/api/src/processing/{reanchorJob.ts,reanchorSweep.ts}`, `apps/api/src/services/anchorWrites.ts`, `fixtures/scripts/revisions.ts`
- Modify: `apps/api/src/processing/{pageJob.ts,queue.ts,types.ts}`, `apps/api/src/server.ts` (sweep at start and on a timer), `apps/api/test/helpers.ts` (`RecordingJobs.enqueuedReanchors`), `apps/api/src/services/{documents.ts,revert.ts}`, `fixtures/scripts/{paths.ts,make-fixtures.ts,index.ts}`
- Test: `apps/api/test/reanchor.test.ts`, `fixtures/scripts/fixtures.test.ts`

**Interfaces:**
- Consumes: `reanchor` (Task 17); `loadVersionText` (Task 5); `revertBatch` (Task 11); M0 processing.
- Produces, fixtures: `FIXTURES.revisedCutPdf` (pirates.txt without lines 201 to 240, otherwise as the libretto) and `FIXTURES.revisedInsertPdf` (a page of 48 lines `INSERTED LINE <n>` after line 240), generated by `ensureFixtures` with `textToPdf`.
- Produces, processing:
  - `JobQueue.enqueueReanchor(versionId: string): Promise<void>`; queue `document-reanchor` (`localConcurrency: 1`, `retryLimit: 3`, `expireInSeconds: 600`, dead letter `document-reanchor-dead`), sent with `singletonKey: versionId` so repeats coalesce.
  - `finishVersionIfDone(deps: Pick<ProcessingDeps, 'db' | 'jobs'>, versionId: string): Promise<'not-done' | 'ready' | 'needs-reanchor'>`: it marks the version ready as in M0, then sets the document's current version only when the document has none; when the current version is a different version with a lower version number it calls `jobs.enqueueReanchor(versionId)` after its transaction commits and returns `'needs-reanchor'`; when a higher-numbered version is current it does nothing more. `markPageFailed(deps: Pick<ProcessingDeps, 'db' | 'jobs'>, pageId, error)` and `handlePageDeadLetter(deps: Pick<ProcessingDeps, 'db' | 'jobs'>, job)` take `jobs` too, because either can finish a version's last page.
  - `sweepPendingReanchors(deps: Pick<ProcessingDeps, 'db' | 'jobs'>): Promise<string[]>`: enqueues (and returns) every version that is `ready`, is not its document's current version, has a higher version number than the current one, AND has never been re-anchored (no change_log row exists with batch id `reanchor:<versionId>`, whether or not that batch was later reverted). It covers a process that died between the ready commit and the enqueue, and it must never re-run a run a user reverted. `reanchorVersion` applies the same rule at its start (a version with an existing `reanchor:<versionId>` batch is a no-op returning `{ skipped: 'already-run' }`). `server.ts` runs the sweep once after `jobs.start()` and every 5 minutes.
  - `REANCHOR_AGENT = 'Binder re-anchoring'`; `reanchorBatchId(versionId: string): string` = `reanchor:<versionId>` (client batch ids cannot contain `:`, Task 3); `reanchorVersion(deps: ProcessingDeps, versionId: string): Promise<{ moved: number; byStatus: Record<AnchorStatus, number> } | null>`:

```
version must be ready; document = its document
if document.current_version_id == versionId: return null                         # done already (idempotent)
if the current version's number > version.number: return null                    # a later version won
texts = loadVersionText for versionId and for every other version some anchor of this document points at
in one transaction, document row locked FOR UPDATE:
  re-check both conditions above
  actor = { userId: version.uploadedBy, via: 'web', agent: REANCHOR_AGENT }; batchId = reanchorBatchId(versionId)
  for every cue and annotation whose anchor.documentId = document and anchor.documentVersionId <> versionId:
    next = reanchor(anchor, texts[anchor.documentVersionId], texts[versionId])     # any throw -> same page, x, y on the target, 'unresolved'
    writeAnchorUnchecked(tx, actor, table, rowId, next, batchId)                    # logged update of `anchor` with the row's layer
  setCurrentVersion(tx, actor, documentId, versionId, batchId)                      # logged update of documents.currentVersionId
```

  - The dead-letter handler `handleReanchorDeadLetter(deps, job)` applies the same two guards under the same lock (already current: nothing; a higher-numbered version current: nothing), then calls `setCurrentVersion` under the same batch id without moving anchors, so a version never stays ready but not current; anchors left on older versions surface in the review list (Task 19). Spec 5.4 step 1 (the `pre-reanchor` snapshot) waits for snapshots in M2; the run is revertable as one batch through the change log.
- Internal writers (imported by `reanchorJob.ts`, `revisions.ts`, and `revert.ts` only, never in the barrel): `writeAnchorUnchecked(tx: Executor, actor: Actor, table: 'cues' | 'annotations', rowId: string, anchor: Anchor, batchId: string): Promise<void>` in `services/anchorWrites.ts`, and `setCurrentVersion(tx: Executor, actor: Actor, documentId: string, versionId: string, batchId: string): Promise<void>` in `documents.ts`.
- `revert.ts` change: a batch is the server-authored re-anchoring run when every one of its change-log rows has `via = 'web'` and `agent = REANCHOR_AGENT`, a combination no client can produce (session actors carry `agent: null`; MCP actors carry `via: 'mcp'`); the batch id is never consulted for this. Such a batch reverts as a document operation: `editor` on the show is required instead of per-row layer rights, it uses the unchecked writers, and `documents.currentVersionId` is revertable only here. Every other batch keeps per-row layer checks (spec 4.12).

- [ ] **Step 1: Write the failing tests** (processing helpers; skip when tools are missing)

```ts
// reanchor.test.ts
test('a revised libretto (lines cut) is re-anchored after its pages are ready, then becomes current', async () => {
  // v1 processed; cues placed with snapToLine on the first line of page indices 1, 30, 100 and on a line inside pirates.txt 201-240;
  // one cue without text; one personal annotation; addDocumentVersion(revisedCutPdf); processVersion -> enqueuedReanchors = [v2], current still v1
  // reanchorVersion -> current v2; the three outside the cut 'ok'; the cut one 'unresolved' (page counts differ); the personal note moved;
  // every change log row of batch 'reanchor:<v2>' has before.anchor.documentVersionId = v1, via 'web', agent REANCHOR_AGENT
})
test('the run is one revertable batch: an editor scoped to LX reverts it and every anchor and the current version return', ...)
test('a batch that merely claims the agent through MCP gets per-row layer checks', ...)   // an MCP client named 'Binder re-anchoring' writes cues; its rows have via 'mcp'
test('a second run changes nothing', ...)
test('an anchor whose page the target lacks ends unresolved and the run completes', ...)
test('a version that fails processing never re-anchors and never becomes current', ...)
test('a last page finished by markPageFailed enqueues the re-anchor', async () => {
  // v2 with one queued page; markPageFailed({ db, jobs }, pageId, 'boom') -> jobs.enqueuedReanchors = [v2]
})
test('sweepPendingReanchors finds a ready, newer, non-current version and enqueues it once', async () => {
  // v2 marked ready directly (simulating a crash before enqueue); sweep -> [v2]; after reanchorVersion, sweep -> []
})
test('a reverted re-anchoring run is never re-run by the sweep or a replayed job', async () => {
  const run = await reanchorVersion(deps, v2)
  await revertBatch(db, editor, { showId, batchId: `reanchor:${v2}`, userId: uploader.id, confirm: true })
  expect(await currentVersionId(db, documentId)).toBe(v1)
  expect(await sweepPendingReanchors({ db, jobs })).toEqual([])
  expect(await reanchorVersion(deps, v2)).toEqual({ skipped: 'already-run' })
  expect(await currentVersionId(db, documentId)).toBe(v1)
})
test('a last page finished by the page dead-letter handler enqueues the re-anchor', async () => {
  // v2 with one queued page; handlePageDeadLetter({ db, jobs }, { data: { pageId } }) -> jobs.enqueuedReanchors = [v2]
  expect(jobs.enqueuedReanchors).toEqual([v2])
})
test('the dead-letter handler makes the version current without moving anchors', ...)
test('the dead-letter handler does nothing when a higher-numbered version is already current', async () => {
  // v3 current; handleReanchorDeadLetter for v2 -> current still v3
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run fixtures apps/api/test/reanchor.test.ts apps/api/test/processing.test.ts apps/api/test/revert.test.ts`

- [ ] **Step 3: Implement fixtures, the job, sweep, queue and page-job changes, the writers, and the revert path**

- [ ] **Step 4: Run to verify they pass** (same command; M0's `processing.test.ts` must still pass, with its current-version expectation now true only for first versions)

- [ ] **Step 5: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(revisions): re-anchoring job with sweep and server-authored revert"
```

---

### Task 19: Review list, version anchors, and compare (services, routes, MCP)

**Files:**
- Create: `apps/api/src/services/revisions.ts`, `apps/api/src/routes/revisions.ts`, `apps/api/src/mcp/tools/revisions.ts`
- Modify: `packages/shared/src/markup.ts` (`ReviewItem`), `apps/api/src/services/index.ts`, `apps/api/src/app.ts`, `apps/api/src/mcp/{registry.ts,server.ts}`
- Test: `apps/api/test/revisions.test.ts`, `apps/api/test/mcpRevisions.test.ts`

**Interfaces:**
- Consumes: Task 18's job, fixtures, and `reanchorBatchId`; `reanchor`, `diffVersionLines` (Task 17); `loadVersionText` (Task 5); cue and annotation update services.
- Produces:

```ts
interface ReviewItem { table: 'cues' | 'annotations'; rowId: string; layer: string; title: string; anchor: Anchor; previous: Anchor | null }   // in @binder/shared markup.ts; title 'LX 12 · Fly out' or 'note · first words'
listReanchorReview(db: Executor, actor: Actor, input: { documentId: string }): Promise<{ currentVersionId: string; pending: ReviewItem[]; olderVersions: ReviewItem[] }>
resolveReanchorItem(db: Executor, blobs: BlobStore, actor: Actor, input: { table: 'cues' | 'annotations'; rowId: string; action: 'accept' | 'revert' | 'reanchor' }): Promise<Anchor>
listVersionAnchors(db: Executor, actor: Actor, input: { versionId: string }): Promise<Array<{ table: 'cues' | 'annotations'; rowId: string; layer: string; anchor: Anchor }>>
compareDocumentVersions(db: Executor, blobs: BlobStore, actor: Actor, input: { fromVersionId: string; toVersionId: string; limit?: number }): Promise<{ entries: LineDiffEntry[]; added: number; removed: number; truncated: boolean }>
```

  `pending` = anchors on the current version whose status is not `ok`; `olderVersions` = anchors of the document on any other version; both grouped by layer then reading order, both without other users' personal annotations; `previous` is the anchor before the most recent re-anchoring row (agent `REANCHOR_AGENT`) for that row id. `accept` sets status `ok` (an unbound highlight stays unbound and still validates, Task 4); `revert` restores `previous` (`invalid` when there is none), which leaves the row on the older version; `reanchor` runs `reanchor` from the row's version to the current version. All three go through the cue and annotation update services (layer rights apply). `listVersionAnchors` returns, for each visible row of the document, its current anchor when it points at that version, else the newest anchor in its change log (before or after) that did. `compareDocumentVersions` requires both versions in one document, `limit` default 2000 entries. Routes: `GET /api/documents/:documentId/review`, `POST /api/documents/:documentId/review` `{ table, rowId, action }`, `GET /api/versions/:versionId/anchors`, `GET /api/documents/:documentId/compare?from=&to=`. MCP: `get_reanchor_review {documentId}`, `resolve_reanchor_item {table, rowId, action}`, `get_version_anchors {versionId}`, `compare_versions {fromVersionId, toVersionId, limit?}` (all read except `resolve_reanchor_item`).

- [ ] **Step 1: Write the failing tests** (processing helpers; skip when tools are missing; one re-anchored v1 → v2 fixture shared by the file)

```ts
test('a cue placed on v1 by an offline client after the switch is listed under olderVersions and "reanchor" moves it to v2', async () => {   // Review Focus 3
  await applyCrudBatch(db, editorSync, { batchId: `${editor.id}:off-1`, entries: [put('cues', id, cueRow({ anchor: JSON.stringify(v1Anchor) }))] })
  const before = await listReanchorReview(db, actors.editor, { documentId })
  expect(before.olderVersions.map((i) => i.rowId)).toContain(id)
  const a = await resolveReanchorItem(db, blobs, actors.editor, { table: 'cues', rowId: id, action: 'reanchor' })
  expect(a.documentVersionId).toBe(v2)
  expect((await listReanchorReview(db, actors.editor, { documentId })).olderVersions.map((i) => i.rowId)).not.toContain(id)
})
test('the review list never includes another user\'s personal annotation', async () => {   // Review Focus 2
  const r = await listReanchorReview(db, actors.owner, { documentId })
  expect([...r.pending, ...r.olderVersions].map((i) => i.rowId)).not.toContain(viewersNote.id)
})
test('accept sets ok; revert restores the v1 anchor; an unbound highlight can be accepted', ...)
test('listVersionAnchors(v1) returns the anchors as they were on v1, without others\' personal rows', ...)
test('compare reports the cut lines as removed', ...)
// mcpRevisions.test.ts
test('get_reanchor_review, resolve_reanchor_item, get_version_anchors, and compare_versions answer through MCP', ...)
```

- [ ] **Step 2: Run to verify they fail, implement, run until they pass**

Run: `pnpm vitest run apps/api/test/revisions.test.ts apps/api/test/mcpRevisions.test.ts apps/api/test/mcpParity.test.ts`

- [ ] **Step 3: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(revisions): review list, version anchors, compare"
```

---
### Task 20: Revisions screens and offline versions

**Files:**
- Create: `apps/web/src/revisions/{UploadRevisionDialog.tsx,VersionSwitcher.tsx,ReviewPanel.tsx,ReviewThumb.tsx,quoteBoxes.ts,useVersionText.ts,useReviewCount.ts}`, `apps/web/src/routes/shows.$showId.docs.$docId.compare.tsx`, `apps/web/e2e/revisions.spec.ts`
- Modify: `apps/web/src/routes/shows.$showId.docs.$docId.tsx` (header count, switcher, review panel, read-only mode), `apps/web/src/markup/useMarkup.ts` (anchors for a non-current version), `apps/web/src/offline/prefetch.ts`
- Test: `apps/web/src/revisions/quoteBoxes.test.ts`, `apps/web/src/offline/prefetch.test.ts`, `apps/web/e2e/revisions.spec.ts`

**Interfaces:**
- Consumes: Task 19's routes and `ReviewItem`; `diffVersionLines`, `buildWordStream` (core); `fetchBlob`; M0 version upload route.
- Produces: `quoteBoxes(layer: WordLayer, text: TextAnchor | undefined): Word[]` (the boxes of `wordStart..wordEnd`, empty when unbound); `useVersionText(versionId): VersionText | null` (word layers through `fetchBlob`, cached per version); `useReviewCount(documentId): number` (local count of cues and annotations on the current version whose `json_extract(anchor, '$.status') <> 'ok'`). `blobUrlsForShow` includes the searchable PDF, thumbnails, and word layers of every ready version, not only current ones, so the switcher, review list, and compare work offline.
- Screens: "Upload revision" (label and file, through `POST /api/shows/:showId/documents/:docId/versions`) shows processing then "Re-anchoring…" until the document's current version changes, then opens the review panel. The header shows "<n> to review" from `useReviewCount`. `ReviewPanel` groups `pending` by layer (department colour), each item with the old and new thumbnails side by side (`ReviewThumb` scales `quoteBoxes` onto a 160 px thumbnail: the old quote where it was, the new where it was found, or a marker at the new anchor when unbound), and "Accept", "Move" (opens the page with the item selected for dragging; a drop writes status `ok`), "Revert to old version"; a collapsed "On an older version (<n>)" section offers "Re-anchor" and "Move". The version switcher shows any version read-only: the overlay draws `GET /api/versions/:id/anchors` when online and the local rows still pointing at that version when offline (with "Showing local anchors only"). `/shows/$showId/docs/$docId/compare?from=&to=` shows both versions' pages side by side with removed lines tinted on the old side and added lines on the new, from `diffVersionLines` over `useVersionText`, and a list of changes that scrolls both sides.

- [ ] **Step 1: Write the failing unit tests**

```ts
test('quoteBoxes returns the word boxes of the range and nothing when unbound', ...)
test('blobUrlsForShow includes every ready version\'s pdf, thumbnails, and words', ...)
```

- [ ] **Step 2: Run to verify they fail, implement, run until they pass** (`pnpm vitest run apps/web`)

- [ ] **Step 3: Write the failing e2e, implement the screens, run until it passes**

```ts
test('uploading a revision re-anchors, the header counts items to review, accepting one lowers the count for both users', ...)
test('the version switcher shows v1 read-only with its cues where they were', ...)
test('compare shows the cut lines as removed', ...)
```

Run: `pnpm --filter @binder/web e2e --grep "revision|version switcher|compare"` (the cut fixture is generated by `ensureFixtures`)

- [ ] **Step 4: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(web): revision upload, review list, version switcher, compare"
```

---

### Task 21: Presence server

**Files:**
- Create: `packages/shared/src/presence.ts`, `apps/api/src/presence/hub.ts`, `apps/api/src/routes/presence.ts`
- Modify: `packages/shared/src/index.ts`, `apps/api/{package.json,src/app.ts,src/server.ts}`, `apps/api/test/helpers.ts`, `apps/web/vite.config.ts` (`'/api': { target: api, ws: true }`)
- Test: `packages/shared/src/presence.test.ts`, `apps/api/test/presenceHub.test.ts`, `apps/api/test/presenceRoute.test.ts`

**Interfaces:**
- Produces, shared:

```ts
interface PresenceState { documentId: string | null; versionId: string | null; pageIndex: number | null; selection: { table: 'cues' | 'annotations'; id: string } | null }
interface PresencePeer extends PresenceState { connId: string; userId: string; name: string; colour: string }
type ClientMessage = { type: 'state'; state: PresenceState }
type ServerMessage = { type: 'welcome'; connId: string; peers: PresencePeer[] } | { type: 'peer'; peer: PresencePeer } | { type: 'leave'; connId: string }
clientMessageSchema: z.ZodType<ClientMessage>          // ids 1..200 characters, pageIndex integer 0..100000
PRESENCE_HEARTBEAT_MS = 5000; PRESENCE_TIMEOUT_MS = 15000
PRESENCE_PALETTE: readonly string[]                    // 12 colours
presenceColour(userId: string): string                // PRESENCE_PALETTE[fnv1a32(userId) % 12]; a per-user colour (spec 3.9), never the department colour
PRESENCE_MAX_MESSAGES_PER_SECOND = 20; PRESENCE_MAX_CONNECTIONS_PER_USER = 5
```

- Produces, `hub.ts`: `interface PresenceConn { id: string; userId: string; name: string; send(msg: ServerMessage): void; close(code: number, reason: string): void }`; `class PresenceHub { constructor(opts?: { now?: () => number; timeoutMs?: number }); join(showId: string, conn: PresenceConn): void; update(showId: string, connId: string, state: PresenceState): void; leave(showId: string, connId: string): void; sweep(): void; peers(showId: string): PresencePeer[] }`. `join` sends `welcome` with the other peers; `update` stores the state, stamps last-seen, and sends `peer` to the show's other connections; `leave` sends `leave` to them; `sweep` drops connections silent for more than `timeoutMs` (default `PRESENCE_TIMEOUT_MS`), closing them with 4408 and announcing `leave`. Shows are isolated.
- Produces, route: `GET /api/shows/:showId/presence` checks, before upgrading with `upgradeWebSocket` from `@hono/node-ws`: the `Origin` header equals `config.APP_ORIGIN` (403 otherwise, so another site cannot ride the session cookie), `requireSession` (401), `requireShowRole(viewer)` (404; archived shows allowed), and fewer than `PRESENCE_MAX_CONNECTIONS_PER_USER` open connections for this user and show (429). Inbound frames over 2048 bytes close with 1009; frames failing `clientMessageSchema` are ignored; each connection has a token bucket of `PRESENCE_MAX_MESSAGES_PER_SECOND` (excess frames are dropped, and a connection that exceeds it by five times in one second closes with 1008). Every `recheckMs` (default 30000) the route re-reads the membership and closes with 4403 when it is gone. `PresenceHub` gains `connectionCount(showId: string, userId: string): number`. `AppDeps` gains `presence: PresenceHub` and `presenceOptions?: { sweepMs?: number; recheckMs?: number }` (tests shorten them); `createApp` creates the node websocket adapter and returns `Hono<AppEnv> & { injectWebSocket(server: ServerType): void }`; `server.ts` calls it after `serve` and runs `hub.sweep` every 5000 ms. Presence is not a service operation, so it has no MCP tool.

- [ ] **Step 1: Write the failing tests**

```ts
// presence.test.ts
test('presenceColour is stable and from the palette', ...)
test('the client schema accepts a state and rejects junk', ...)
// presenceHub.test.ts (fake clock and recording conns)
test('join welcomes with the other peers; update fans out to the same show only', ...)
test('a peer silent for 15s is dropped on sweep and others get leave; a heartbeat every 5s keeps it', ...)
test('leave is announced once', ...)
// presenceRoute.test.ts (serve on port 0 with injectWebSocket; `ws` client with the cookie header)
test('no session is 401 and a non-member is 404 before any upgrade', ...)
test('two members see each other\'s state', ...)
test('removing the membership closes the socket with 4403 within the recheck interval', ...)   // recheckMs 100
test('an oversized frame closes with 1009', ...)
test('an upgrade from another origin is 403 and opens no socket', async () => {
  expect(await upgradeStatus({ cookie: a.cookie, origin: 'https://evil.example' })).toBe(403)
})
test('a sixth connection for the same user and show is 429', ...)
test('frames beyond 20 a second are dropped and a flood closes with 1008', ...)
```

- [ ] **Step 2: Run to verify they fail, implement, run until they pass**

Run: `pnpm vitest run packages/shared apps/api/test/presenceHub.test.ts apps/api/test/presenceRoute.test.ts apps/api/test/app.test.ts`

- [ ] **Step 3: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(presence): websocket presence hub with heartbeat and timeout"
```

---

### Task 22: Presence in the binder

**Files:**
- Create: `apps/web/src/presence/{client.ts,usePresence.ts,PresenceProvider.tsx,Avatars.tsx,peers.ts}`, `apps/web/e2e/presence.spec.ts`
- Modify: `apps/web/src/viewer/ThumbnailRail.tsx`, `apps/web/src/viewer/PageList.tsx` (avatars per page), `apps/web/src/markup/MarkupOverlay.tsx` (peer selection outlines), `apps/web/src/routes/shows.$showId.tsx` (who is in the binder)
- Test: `apps/web/src/presence/{client,peers}.test.ts`, `apps/web/e2e/presence.spec.ts`

**Interfaces:**
- Consumes: Task 21's protocol and `presenceColour`; `useSelection` (Task 6).
- Produces: `createPresenceClient(opts: { url: string; WebSocketImpl?: typeof WebSocket; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout }): { setState(s: PresenceState): void; subscribe(fn: (peers: PresencePeer[], connected: boolean) => void): () => void; close(): void }` (sends on change, throttled to one message per 250 ms, and every `PRESENCE_HEARTBEAT_MS`; reconnects after 1 s doubling to 30 s; resends its state on reconnect; drops peers on disconnect); `usePresence(showId: string, state: PresenceState): { peers: PresencePeer[]; connected: boolean }` (URL from `location`, `ws:` or `wss:`; nothing while offline); `peersByPage(peers: PresencePeer[], versionId: string): Map<number, PresencePeer[]>` (one entry per user, the most recently updated connection); `presenceSelection(sel, layerKind): PresenceState['selection']` returns null for anything on a personal layer, so personal ids are never broadcast.
- Colour: presence uses the peer's per-user colour from the protocol (spec 3.9); cue markers, labels, and highlights keep their department colour (4.11), and the selection outline is drawn outside the marker so both stay readable.
- Screens: avatars (initials on the peer colour) on thumbnails and at each page's top-right for peers on the same version; a 2 pt outline in the peer's colour on a cue or annotation a peer has selected; the show header lists who is in the binder with document and page. Offline the presence UI is absent, with no error.

- [ ] **Step 1: Write the failing unit tests**

```ts
// client.test.ts (fake WebSocket class, fake timers)
test('sends on change at most every 250ms and a heartbeat every 5s', ...)
test('reconnects with backoff 1s, 2s, 4s up to 30s and resends its state', ...)
test('peers are cleared on disconnect', ...)
// peers.test.ts
test('peersByPage keeps one entry per user on the given version', ...)
test('selecting a personal annotation broadcasts no selection', ...)
```

- [ ] **Step 2: Run to verify they fail, implement, run until they pass** (`pnpm vitest run apps/web`)

- [ ] **Step 3: Write the failing e2e, implement the screens, run until it passes**

```ts
test('B sees A\'s avatar on page 3\'s thumbnail within 3s and an outline on the cue A selects', ...)
test('when A closes the tab, A\'s avatar is gone from B within 20s', ...)
```

Run: `pnpm --filter @binder/web e2e --grep "avatar"`

- [ ] **Step 4: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "feat(web): presence avatars and selection outlines"
```

---

### Task 23: Deploy M1 to Coolify and smoke it

**Files:**
- Modify: `deploy/scripts/m1-smoke.ts` (the `full` stage), `docs/mcp.md` (the M1 tools), `deploy/README.md` (anything M1 changes: the websocket path through the proxy, restarting PowerSync after sync-config changes)

**Interfaces:**
- Consumes: the Coolify Docker Compose application created in M0 Task 17, its env, domains (`https://binder.rvlt.app`, `https://binder-sync.rvlt.app`), and the Caddy proxy, which forwards `/api/*` including websocket upgrades; Task 10's smoke script.
- Produces: `m1-smoke.ts --stage full` runs the checkpoint steps and then, on the same smoke show before archiving it: `get_history` for the cue shows its insert and relabel with `via: 'mcp'` and agent `m1-smoke/…`; `revert_change` restores the label; `get_activity` lists the batch as `<name> via m1-smoke`; `export_marked_script` with `layers: 'all'` returns a record whose `/blobs/` file starts with `%PDF-`; `export_cue_list` csv starts with the BOM and xlsx with `PK`; a second version uploaded from `FIXTURES.revisedCutPdf` reaches `ready`, becomes current within 5 minutes, and `get_reanchor_review` answers; a websocket upgrade to `/api/shows/:id/presence` without a session is refused with 401 (the proxy passes upgrades and the guard runs).

- [ ] **Step 1: Pre-flight**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @binder/web e2e`
Expected: all PASS locally (and in CI once pushed).

- [ ] **Step 2: Build the production images locally and check the new pieces**

Run: `docker compose -f deploy/docker-compose.yml build && docker compose -f deploy/docker-compose.yml up -d`; then against `http://localhost`: log in, place a cue, open a second browser and see it and the first user's avatar, print the calling script.
Expected: migrations apply at API start; PowerSync logs show the publication's new tables (`departments`, `cues`, `annotations`, `export_records`) replicating with no errors; the presence websocket connects through Caddy.

- [ ] **Step 3: Deploy**

Jayden asked for M1 to go live, so this step needs no separate go (the controller's override of R20 for M1). Push the M1 branch, merge per the M0 deploy runbook, and redeploy the Coolify application. Watch the API and PowerSync logs until healthy; PowerSync reprocesses the changed sync config on start, so the first client sync after the deploy can take longer. The presence websocket passes Cloudflare's tunnel and Caddy unchanged.

- [ ] **Step 4: Smoke against production**

Run: `BINDER_URL=https://binder.rvlt.app BINDER_TOKEN=<token from Jayden> pnpm --filter @binder/api exec tsx ../../deploy/scripts/m1-smoke.ts --stage full`
Expected: every step PASS. Then Jayden checks by hand, on a laptop and a phone: a cue placed on one device shows on the other within two seconds; both avatars show in their own colours; a cue placed in flight mode syncs on reconnect; the printed calling script opens in Preview and is searchable; the XLSX cue sheet opens in Excel; a revision upload re-anchors and shows its review count.

- [ ] **Step 5: Commit**

```bash
git add -A && git -c commit.gpgsign=false commit -m "chore(deploy): m1 full smoke and runbook notes"
```

---

## Done when

- `pnpm lint && pnpm typecheck && pnpm test` and every Playwright spec pass locally and in CI.
- binder.rvlt.app runs M1: two people mark up one script with cues and annotations on their own layers, see each other's edits within two seconds and each other's positions, renumber a department, print the calling script and a cue sheet (PDF, XLSX, CSV), revert from history, and upload a revision whose cues follow it with a review list.
- Claude Code connected to `/mcp` can list departments, place cues with `place_cue_at_text`, annotate, renumber, read history and revert, export, and work the review list, and the activity feed shows its batches as "<name> via <client>".

## Spec coverage

| Spec | Task |
|---|---|
| 4.1 department scope on memberships, permissions table rows for cues and annotations | 1, 2, 4 |
| 4.2 departments, seeding, add, rename, hide, number format | 1 |
| 4.4 anchors, reading order | 1, 2 |
| 4.8 cues, display, sort, duplicates as warnings, numbering convention, renumber, unplaced, empty payloads | 2, 10 |
| 4.9 annotations, stamp set, highlights by word range, editing | 4, 8 |
| 4.11 layers: ownership, visibility, active layer, lock, appearance, layer selection on export, per-department numbering | 1, 6, 7, 8, 13 |
| 4.12 change log views, row history, activity feed, revert (layer rights per row), personal undo | 11, 12, 9 |
| 4.12 batch ids per upload or MCP call, unique per user | 3 |
| 4.12 export records (snapshot fields null until M2) | 14, 15, 16 |
| 3.2 client-created rows and deletes through the write path; batches of any size | 3, 4 |
| 3.3 sync of new tables; personal layers to their owner only | 1, 2, 4, 14 |
| 3.9 presence with per-user colour | 21, 22 |
| 3.10 MCP parity, `place_cue_at_text`, confirmation gate (deletes, batch reverts), export resources | 1, 2, 4, 5, 10, 11, 14, 16, 19 |
| 5.2 overlay, snapping and text anchors, session snap toggle, layer panel, keyboard | 5, 6, 7, 8 |
| 5.3 print export with footer, clean copy, rotation and crop box, text layer kept | 13, 14, 15 |
| 5.4 re-anchoring, review list, version switcher, compare | 17, 18, 19, 20 |
| 7 cue sheet per department: screen, PDF, XLSX, CSV (run sheets later) | 10, 16 |
| 8 rejection notice naming the row; collisions as warnings; re-anchoring never fails; history offline | 3, 10, 18, 12 |
| 9 core numbering, renumbering, anchor ordering, re-anchoring matcher; API change log completeness and scope; MCP parity, attribution, confirmation; web e2e place a snapped cue and export the marked PDF | 2, 10, 17, 11, 3, 2, 7, 15 |
| 10 M1 offline prefetch (all versions) | 20 |
| Deploy to Coolify with smoke (checkpoint and full) | 10, 23 |

## Rulings and open questions

The controller accepted items 1 to 23 as rulings, with overrides (a) to (c) applied in the text: (a) Task 23 deploys without a separate go; (b) cue sheets include XLSX (Task 16, written with `fflate`); (c) presence uses a per-user colour (Tasks 21 and 22). Items 24 onward are assumptions made in the revision.


1. **Renumbering before script items exist.** Script items are M2, so no scene or song resolves in M1. Assumed: cues with no resolved item form one run numbered consecutively from the block size (10, 11, 12, …) with no spill; when M2 adds items, the cues before the first item keep this rule and each item's group follows the spec's block rule. Spilled cues take points of the block's last integer, `floor(i × 100 / (s + 1))` (one spill gives .50).
2. **Line checks and renumbering.** Assumed: cues with major 0 are never renumbered.
3. **Pre-reanchor snapshot (5.4 step 1).** Snapshots are M2. Assumed: M1 skips the snapshot; the run is one change-log batch (`reanchor:<versionId>`) that reverts as a whole.
4. **Binder version in footers and export records.** No snapshots in M1. Assumed: `snapshot_id`, `binder_version`, and `changelog` are null; the footer prints `export <last 8 of the export id>` where the binder version will go; "what changed since this" opens the activity feed from the record's time.
5. **Default department names, colours, and number formats.** The spec gives codes only. Assumed: the names and colours in Task 1, and `point` for TM (its corpus uses 0.50 and 14.50), `decimal` for the rest.
6. **A `layer` column on `change_log`.** The spec's column list lacks it, but it requires layer filters and private personal layers. Assumed: add a nullable `layer` holding a layer key.
7. **Personal-layer privacy scope.** Assumed it covers everything derived from a personal annotation (history, activity, review list, version anchors, exports via `private_to`), and that owners cannot see other users' personal layers either.
8. **Anchor storage.** Assumed: one jsonb `anchor` column (an atomic value, so concurrent moves cannot interleave x from one user with y from another), with an expression index on the version id.
9. **Annotation geometry.** "Geometry JSON (in PDF points)" does not say absolute or relative. Assumed relative to the anchor, so re-anchoring moves shapes with their anchor; the per-type shapes in Task 4.
10. **"Revert to old version" and stale anchors.** Assumed: it restores the anchor the item had before re-anchoring, on the old version; such items, and cues an offline client placed on a superseded version, appear in an "On an older version" section with "Re-anchor". No background sweep moves them automatically.
11. **Old versions "with their anchors as they were".** Assumed: reconstructed from the change log online; offline, only rows still anchored there show, with a note.
12. **Re-anchoring actor.** Assumed: logged as the uploader with agent `Binder re-anchoring`, without layer checks (it is a document operation); reverting that batch needs editor rights on the show rather than every layer.
13. **Departments offline.** Assumed: departments and memberships are edited online (REST and MCP) and sync read-only; department codes stay editable by owners; a hidden department disappears from the layer panel, pickers, and default exports but keeps its cues.
14. **Cue number suggestion.** The spec only says points are for insertions. Assumed Task 2's rule: the next integer when it fits, else the multiple of 50, then 10, nearest the midpoint (12 and 13 give 12.50).
15. **Snap quote direction.** Assumed: from the nearest word forward, within its line, up to eight words.
16. **Payloads.** Assumed: `payload` is not writable through sync, REST, or MCP in M1 (TM payload editing is M3).
17. **"All layers" exports.** Assumed: every non-hidden department layer, never personal layers unless chosen explicitly.
18. **Cue sheet scope.** Ruled: PDF, XLSX, and CSV as section 7 says; no run sheets in M1; paper size is an owner setting, default A4.
19. **Redo.** The spec names only personal undo. Assumed: redo is included (Mod+Shift+Z), with the same never-overwrite-others rule.
20. **Sync DELETE of a missing row.** Assumed: accepted as already done (no rejection, no log row), so replays never raise notices.
21. **Sync Streams filter form.** Assumed `IN user_shows AND layer_id = auth.user_id()` is accepted; Task 4 gives the fallback stream if it is not.
22. **Production smoke.** Automated over MCP and REST with a token Jayden supplies (checkpoint and full stages); the browser and phone checks stay manual for Jayden. Ruled: the deploy itself does not wait for a separate go.
23. **Sync host name.** The brief names `sync.binder.rvlt.app`; the ledger's latest deploy entry renamed it `binder-sync.rvlt.app` behind a Cloudflare tunnel. The plan uses the ledger's name.
24. **Stale PUT replays versus last-writer-wins.** Spec 8 says last write wins by arrival. Assumed: that still governs PATCH; a PUT for a row that already exists is treated as a replay of its create and skips columns another user changed after the PUT's `clientTs` (Task 3).
25. **Chunked uploads.** Assumed: each chunk of one PowerSync transaction is applied in its own server transaction under the same logged batch id, so a transaction over 400 entries is not atomic on the server. Controller ruling: a failed chunk makes PowerSync retry the whole transaction, and chunks already applied are recognised by `sync_applied_chunks (batch_key, chunk_index)` and skipped as replays, so a retry can never re-apply a PATCH over a collaborator's newer edit (Task 3).
26. **Batch id format.** Assumed: client ids match `/^[A-Za-z0-9_-]{1,100}$/` and are logged as `<userId>:<clientId>`; server batches use `newId()`; the re-anchoring run's `reanchor:<versionId>` is recognised for revert by its rows (`via 'web'` with agent `Binder re-anchoring`), never by the prefix.
27. **XLSX export kind.** The spec's ExportRecord kinds are `tmix`, `pdf-script`, `pdf-sheet`, `csv`. Assumed: add `xlsx` for the XLSX cue sheet.
28. **Cue tool on a personal layer.** Assumed: it places into the most recently active editable department (else the first one) and is disabled with a hint when the user can edit no department.
29. **Unbound highlights.** Assumed: `wordStart >= 0` is enforced only when a highlight is created, so re-anchored unbound highlights can be accepted and moved.
