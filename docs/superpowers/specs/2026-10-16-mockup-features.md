# Mockup features: show-card pulse, print options, processing controls, keep-offline

Status: approved by Jayden (2026-10-16). He asked for the screens to be "fully compliant with the mockups" and, offered the mockup features the app lacked, chose to build these four now: **who's in on show cards**, **print options**, **processing controls** and the **keep-offline switch**. Not now: show phase/dates, the new-show wizard and department descriptions, Binder as an activity actor (those mockup details stay out). This spec amends the platform spec and the restyle spec; DESIGN.md governs the look.

## Decisions (Jayden's and the controller's)

1. **Cue notes on print — Jayden: a small note under the tag.** Each printed cue with a non-empty note gets one line of 7 pt Helvetica in the department colour directly under its margin tag, left-aligned with the tag's outer edge, truncated with an ellipsis to the tag column's width (the margin between the page edge and the text block, minus 8 pt). When that column is narrower than 40 pt the note is not drawn. In the stacking sweep a tag with a note counts as one block of tag height + 9 pt, so stacked tags never overlap a note. Print only (the screen keeps notes in the cue editor). The Include toggle "Cue notes" defaults on.
2. **Paper A4 / Letter = fit to paper.** Each stamped page is scaled to fit and centred on the chosen paper (per-page orientation), as designed in §2 below; the dialog's default is the paper nearest page 1's own size (within 3%), so an untouched dialog changes nothing.
3. **A scan with no text fails only text-anchored documents** (libretto/other, OCR auto) as `no_text` / `low_resolution`; scores, blocking and OCR-off documents stay ready.
4. **Script export file names use the mockup's slug form** for new exports (`songs-for-a-new-world-libretto-v2-LX-SND-TM.pdf`); existing records unchanged.
5. **Keep-offline Off keeps what is cached** and stops fetching; no "free up space" action now.
6. **The viewer's own avatar shows on show cards** when another device of theirs has the show open (the mockup draws it).
7. Presence and last change fold into the MCP `list_shows` tool (`inNow`, `lastChange`).

The design below was produced by a read-only design pass over the code and reviewed by the controller; file paths and test names are binding starting points for the plan.

---

Read-only pass. Nothing was written. Paths are under `/Users/jayden/cueapp`.

Conventions assumed:
- Migrations are descriptively named files in `packages/db/drizzle/` (for example `0012_export_records.sql`), plus `meta/_journal.json` and a snapshot from `drizzle-kit generate --name`.
- Next free numbers: `0015_export_options.sql` (Feature 2) and `0016_version_processing_controls.sql` (Feature 3).
- Every service is `operation(db, actor, input)`.
- Every exported service must appear in `apps/api/src/mcp/registry.ts` (`OPERATION_TO_TOOL`, or `UI_ONLY_OPERATIONS` with a reason). `apps/api/test/mcpParity.test.ts` enforces this.
- PowerSync streams use `SELECT *` (`deploy/powersync/sync-config.yaml`). New columns on already-synced tables need no sync-config change, only the client `AppSchema` in `apps/web/src/powersync/schema.ts`. `schema.test.ts` fails if the two drift.
- Existing rows get the new columns only when next updated, so every new column is nullable and the UI treats null as "unknown".

---

## Feature 1. Who's in, on the show cards

### (a) What exists today
- `apps/api/src/presence/hub.ts` is in-memory only: `Map<showId, Map<connId, {conn{userId,name}, state, lastSeen}>>`. The sweep drops silent connections after `PRESENCE_TIMEOUT_MS` (15 s). A client can only join a show's socket, `GET /api/shows/:showId/presence` (`routes/presence.ts`), once it has opened that show.
- `apps/web/src/presence/{client,PresenceProvider,Avatars}.tsx` run one socket per open show. `BinderAvatars` is the stacked 24 px chip.
- `apps/web/src/shows/ShowCard.tsx` says in a comment that the card carries no presence, because presence is per show over a socket. Its only recency text is `Updated <timeAgo(show.updated_at)>`, and the show row's `updated_at` only moves when the show itself is edited.
- Activity is `activityFeed` in `apps/api/src/services/history.ts`, behind `GET /api/shows/:id/activity`. Rows are grouped by batch id plus user, using `summariseBatch` and `actorLabel` from `packages/core/src/history/summarise.ts`. The privacy filter is `visibleTo(actor)`. The web side is `apps/web/src/history/api.ts` (`useActivity`, `useInfiniteQuery`, online only).
- `summariseBatch` produces "relabelled 3 LX cues". For `documents` and `document_versions` it falls through to the generic "added 1 document_version", which is ugly. Processing writes are never logged (R43), so the only revision event in the log is the upload insert.
- The home page (`apps/web/src/routes/index.tsx`, `shows/ShowsHome.tsx`, `shows/useShowSummaries.ts`) is fully local PowerSync data.

### (b) Design

**Presence across shows: poll a REST summary, no new socket.**
- Why: the home page does not hold any show socket, and the information changes slowly. Polling every 15 s while the tab is visible is simple, stateless and matches the 5 s heartbeat and 15 s drop.
- A lobby socket that receives deltas would add a second protocol, auth path and flood limits for 3 to 10 cards.
- Known limit: the hub is in-process, which is fine for the single API container in spec 3.7. Say so in the service doc comment.
- `PresenceHub.occupants(showId): {userId, name}[]`, de-duplicated by user (a user with two tabs counts once). It is read-only and needs no extra state.
- Service `presenceSummary(db, hub, actor)` in a new `apps/api/src/services/homePulse.ts`:
  - Take the actor's non-archived member shows, filtered by `actor.showScope` exactly as `listShows` does. Intersect with the hub. Return only shows that have at least one person.
  - Join `show_memberships` and `departments` to turn the person's department scope into codes (`[]` for `*`). This is only for the mockup's "Mikaela, LX" tooltip.
  - Colour comes from `presenceColour(userId)` in shared. Nothing else leaks: no email, no document or page.
- Route `GET /api/me/shows/presence`, namespaced under `/me` to avoid colliding with the `/shows/:showId` routes in `tenancy`. Response:
  `{ shows: { [showId]: { people: { userId, name, colour, departments: string[] }[] } } }`
- Privacy:
  - Membership-gated, so a non-member sees nothing about a show.
  - The caller's own other devices are included. The mockup draws "JN Jayden" on the card, and on the home page this tab is not in any show, so it is not a duplicate.
  - This reveals nothing a co-member cannot already see inside the show.

**Batched last change per show.**
- Service `latestChangePerShow(db, actor)` in `homePulse.ts`.
- Step 1 is one query. For each of the actor's non-archived shows it takes the newest `visibleTo` row, using `unnest($ids) CROSS JOIN LATERAL (… ORDER BY seq DESC LIMIT 1)`. That walks `change_log_show_seq_idx` backwards, so cost is independent of log size.
- Step 2 loads that row's run: same `show_id`, `batch_id` and `user_id`, `visibleTo`, capped at 500. A row with a null batch id stands alone. The runs are fetched in parallel, at most one per active show.
- Step 3 reuses the activity code. Extract the "run to ActivityGroup" mapping that `activityFeed` builds inline (department-code lookup, `summariseBatch`, `actorLabel`) into an exported internal helper `toActivityGroup(run, codes)` and call it from both. Keeping the grouping and wording identical is the point.
- Small divergence to accept: grouping by batch id is not "consecutive rows only", so an interleaved concurrent batch may differ by a row from the feed. Document it.
- Route `GET /api/me/shows/last-changes`. Response:
  `{ shows: { [showId]: { at, userId, label, summary, sentence, count, via, agent, batchId } | null } }`
- Rows by another member's personal layer are never "the last change" because of `visibleTo`.
- Composing the sentence, in `packages/core/src/history/summarise.ts` (pure, so it works anywhere):
  - Extend `summariseBatch` and `verbsOf`:
    - `documents` insert becomes "uploaded 1 document".
    - `document_versions` insert with `versionNumber > 1` becomes "uploaded 1 revision".
    - A version-1 insert in the same batch as its `documents` insert is not counted.
    - Nouns "document" and "revision" replace the table-name singularisation.
    - Feature 3 adds `cancelled`, `retried` and `removed` ("cancelled 1 upload").
  - New `cardSentence(rows): string`, which matches the mockup's grammar:
    - One (table, department) group of cues or annotations gives "LX relabelled 3 cues", or "LX moved 3 cues and relabelled 1".
    - A batch of only revision inserts gives "revision uploaded" (plural: "2 revisions uploaded").
    - Only a document insert gives "document uploaded".
    - Anything else falls back to the existing `summariseBatch` text, for example "moved 12 LX cues; added 2 SND annotations".
  - The card renders `sentence` plus `timeAgo(at)` ("12 min ago", "1 h ago", which `shows/timeAgo.ts` already produces).
  - Tooltip and accessible name use `${label} ${summary}`, so the actor is named without crowding the card ("Jayden via Claude Code placed 42 cues").
  - The response carries `label` and `summary` for that reason.

**MCP.**
- `list_shows` (`apps/api/src/mcp/tools/shows.ts`) gains `lastChange` and `inNow` per show.
- `OPERATION_TO_TOOL` maps `latestChangePerShow` and `presenceSummary` to `list_shows`.
- `McpDeps` (`apps/api/src/mcp/context.ts`) widens from `Pick<AppDeps,'db'|'blobs'|'jobs'>` to also include `'presence'`. `createMcpRoutes` is already called with full `AppDeps`. Update `test/mcpHelpers.ts`.
- This costs one field and lets an agent avoid bulk edits while a human is in the show.
- Fallback if you prefer: mark `presenceSummary` UI-only with the reason "ephemeral socket state". I recommend folding it in.

**Web.**
- `apps/web/src/shows/useShowPulse.ts` has two TanStack queries:
  - `['home','presence']` with `refetchInterval: 15_000`, no background refetch, `enabled: online`.
  - `['home','last-changes']` with `staleTime: 30_000`, `refetchInterval: 60_000`, refetch on window focus.
- Both keys sit under `['home', …]`, so the existing `queryClient.clear()` on sign-out and user switch drops them.
- Extract the 24 px ringed chip from `BinderAvatars` into `AvatarStack({people:{userId,name,colour}[]})` in `presence/Avatars.tsx`, so the card and top bar share it. It shows 3 people then "+n", and has a `role="group"` label "In the show now".
- `ShowCard` gains `inNow?` and `lastChange?`.
  - The foot row is avatars on the left and the sentence on the right, truncating with the full text in `title`.
  - Reserve the foot line's min-height so nothing shifts when data arrives.
  - Archived cards get neither.
- Offline or loading fallback:
  - No presence is drawn (best-effort, as spec 3.9 says).
  - The sentence is replaced by `Updated <timeAgo(max updated_at)>` taken from local rows. Add `useLocalLastActivity()` to `useShowSummaries.ts`: one query of `max(updated_at)` per show over `cues`, `annotations`, `documents` and `document_versions`. This is more truthful than `show.updated_at`.
  - Online-but-slow shows the same fallback until the first response.
- Add a `useNow(60_000)` tick so the "min ago" text stays current.

**Roles.** Any member (viewer or above), via `requireShowRole`/membership. Token scope is respected.

### (c) Edge cases and failure modes
- API restart: the hub empties and clients reconnect within about 1 to 5 s, so avatars flicker once. No special handling.
- A show with no changes: `lastChange` is null, so the card uses the local fallback.
- Deleted user: `Unknown user` label, as the feed already does.
- A batch over 500 rows: counts are "at least". The sentence stays correct for the first 500.
- Clock skew: `timeAgo` maps negative age to "just now".
- Someone removed from a show: next poll omits it. A removed member's open socket is closed by the existing 30 s recheck.
- Multi-container deployment: presence would split. Same limit as in-show presence, so note it.

### (d) Tests
- `packages/core/src/history/summarise.test.ts`
  - `cardSentence one department group leads with the code`: "LX relabelled 3 cues".
  - `cardSentence revision insert`: "revision uploaded".
  - `cardSentence mixed groups falls back to summariseBatch`.
  - `summariseBatch uploads count a first version once with its document`.
- `apps/api/test/presenceHub.test.ts`
  - `occupants dedupes a user with two connections and omits other shows`.
- `apps/api/test/homePulse.test.ts` (new, same helpers as `history.test.ts`)
  - `presence summary lists only shows the caller is a member of`.
  - `presence summary excludes archived shows and shows outside the token scope`.
  - `presence summary carries name and colour and nothing else`.
  - `last change is the newest visible batch per show`.
  - `last change ignores another member's personal-layer edits`.
  - `last change for a null-batch row stands alone`.
  - `show without changes is null`.
  - `sentence for a revision upload is "revision uploaded"`.
- `apps/api/test/mcp.test.ts`: `list_shows includes lastChange and inNow`.
- `apps/web/src/shows/ShowCard.test.tsx`
  - `shows avatars and the sentence with relative time`.
  - `offline falls back to Updated from local rows and shows no avatars`.
  - `archived card has neither`.
- `apps/web/src/shows/useShowPulse.test.tsx`
  - `polls presence every 15 s and stops when offline`.
- `apps/web/e2e/presence.spec.ts` (add)
  - `the shows home card shows B's avatar while B has the show open, and it is gone within 20 s of B closing the tab`.
  - `after A relabels cues the card reads "LX relabelled N cues"`.

### (e) Size: 5 tasks
1. S. Core: `cardSentence` and `summariseBatch` document/revision grammar, plus tests.
2. M. API: `latestChangePerShow` with the `toActivityGroup` extraction from `activityFeed`, route, tests.
3. S. API: `PresenceHub.occupants`, `presenceSummary`, route, tests.
4. S. MCP: fold into `list_shows`, widen `McpDeps`, parity map, tests.
5. M. Web: `useShowPulse`, `AvatarStack` extraction, `ShowCard` foot, local fallback, unit tests, e2e.

Cut candidates: the department code in the avatar tooltip (cheap, but delete it if you want less).

---

## Feature 2. Print options

### (a) What exists today
- Web: `apps/web/src/exports/PrintDialog.tsx` has layer checkboxes and two presets, then `runPrintExport.ts`. That reads local PowerSync rows and the cached searchable PDF, dynamically imports `printCore.ts` (pdf-lib), downloads at once, and queues the file in the IndexedDB outbox (`outbox.ts`, `flusher.ts`). The server later makes the `export_records` row via `POST /api/shows/:id/exports` (`routes/exports.ts`, `services/exports.ts:createExportRecord`).
- Core: `packages/core/src/print/stampItems.ts` (`buildStampItems`) and `stampScript.ts` (`stampScript(pdf, items, footer)`). Pages are only drawn on, so size, boxes, rotation and the text layer are untouched. The footer is on every page.
- Server: `exportMarkedScript` (`services/exports.ts`) and the MCP tool `export_marked_script` (`mcp/tools/exports.ts`) take `{documentId, versionId?, layers}` only.
- File names are built twice, by identical `exportFilename(parts)` copies in `services/exports.ts` and `exports/runPrintExport.ts`, as `<show> - <doc> v<n> - <layers>.pdf`. The server's `createExportRecord` only checks `text(200)`.
- Paper is `settings.paperSize` via `paperSize()` in `packages/shared/src/markup.ts`. It is used only for cue sheets (`cueSheetFile`). The script PDF is never resized today (spec 5.3: "Page size is unchanged").
- `export_records` (`packages/db/src/schema/exports.ts`) has `layer_selection` and a `changelog` stub, but nowhere to store options.
- **Cue notes are not printed anywhere today.** Cue stamp items carry only the lead and number, and the margin-marker spec says labels are not drawn. See decision 1.

### (b) Design

**Shared (`packages/shared/src/printOptions.ts`, new, pure):**
```ts
interface PrintOptions {
  pages: 'all' | string        // normalised 1-based list, e.g. "1-5, 8"
  paper?: 'A4' | 'Letter'      // absent = leave pages as they are
  includeStandbyWarn: boolean  // default true
  includeAnnotations: boolean  // default true
  includeCueNotes: boolean     // default true (decision 1)
}
```
- `printOptionsSchema` is the zod schema, reused by the API route and service.
- `parsePageRange(text, pageCount)` returns the ascending, de-duplicated zero-based indices or a typed error.
  - Accepted syntax: `N`, `N-M`, `N–M` (en dash) and `N—M` (em dash), comma separated, spaces allowed.
  - Messages: "Pages look like 1–43 or 3, 7–9." and "This script has 43 pages."
  - `normalisePageRange` gives the canonical ASCII text that is stored.
- `validateExportFilename(raw): {ok, name} | {ok:false, reason}`:
  - Trim. A trailing `.pdf` (any case) is removed and then re-added, so the field can show or hide it.
  - 1 to 200 characters in total.
  - Rejects `/ \ : * ? " < > |` and control characters.
  - Rejects a leading or trailing dot or space.
  - Rejects Windows reserved base names (CON, PRN, AUX, NUL, COM1–9, LPT1–9).
  - Reasons are plain, for example "File names can't contain / \ : * ? " < > |".
- `scriptExportFilename({show, document, versionNumber, layerLabel})` becomes the one shared default, in the mockup's slug form: `songs-for-a-new-world-libretto-v2-LX-SND-TM.pdf`.
  - Lower-case slugs for show and document titles, `v<n>`, department codes joined by `-`, `all-layers` or `clean` or `personal` where `layerSelectionLabel` says so.
  - The server and web copies both import it, so they cannot drift.
  - Cue sheets keep their existing `exportFilename`.
  - The old `Show - Doc v2 - LX.pdf` default changes for new script exports. See decision 4.

**Core.**
- `buildStampItems(input)` gains `include?: {standbyWarn?: boolean; annotations?: boolean}`, all defaulting to true.
  - `standbyWarn:false` keeps only `type === 'go'` cues.
  - `annotations:false` emits no annotation items.
- `stampScript(pdf, items, footer, opts?: {pages?: readonly number[]; paper?: PaperSize})`:
  - **Page subset.** Build a fresh `PDFDocument`, `copyPages(src, indices)` (pdf-lib's `removePage` does not drop orphaned objects, so copying keeps output small), then stamp the copies. Items are re-indexed through an original-to-output map; items for omitted pages are skipped. The invisible text layer travels with each copied page.
  - **Paper.**
    - A second pass embeds each stamped page into a new page of the chosen paper (A4 595.28×841.89, Letter 612×792, swapped per page for landscape pages), scaled to fit and centred.
    - Stamping first means no coordinate changes, because the existing displayed-space maths is untouched.
    - It is a no-op for pages already within about 3% of the target.
    - The footer scales with the page.
  - I treat "paper override" as fit-to-paper. See decision 2.
  - A test must prove the resized output still reads in `pdftotext`, since embedding turns each page into a form XObject.
- Cue notes (decision 1): `buildStampItems` emits a `cue-note` item per cue with a non-empty note when `include.cueNotes` is true; `layoutCueTags` treats a tag with a note as tag height + 9 pt in the stacking sweep and returns the note's box under the tag; `stampScript` draws it in 7 pt Helvetica in the department colour, truncated with an ellipsis to the tag column width, and skips it when the column is under 40 pt. Tests: a note prints under its tag; two stacked tags with notes do not overlap; a 36 pt margin draws no note; `cueNotes:false` draws none.

**Dialog (`PrintDialog.tsx`, in the existing native `<dialog>` and `DialogShell`, per the restyle spec).**
- Two columns as in the `print` mockup. Left: Layers, Pages (segmented All N / Range plus a mono input whose faint placeholder is `1–N`), Paper (A4 / Letter), Include. Right: preview. Below: file name and footer ("Saved to Exports. Works offline.").
- State: `{layers, pagesMode, rangeText, paper, includeStandbyWarn, includeAnnotations, filename, filenameEdited}`.
  - The file name follows the choices (`scriptExportFilename`) until the user edits it, then stays theirs.
  - Range and file name validate live: `aria-invalid`, an error line, Download disabled while any is invalid.
- Initial paper: the segment nearest page 1's size if within 3%, otherwise the show's `paperSize`. An untouched dialog therefore changes nothing for a Letter script in an A4 show. See decision 2.
- The page count comes from `document_versions.page_count` (local).
- **Preview.** A lightweight SVG, `PrintPreview.tsx`, not a render of the PDF:
  - A page rectangle in the paper's aspect ratio, about 19 grey text bars, and a few sample tag pills per selected department on that department's side from `markerSide(settings, id)`, in its colour. A second, dashed pill per department shows standby and warn when that toggle is on.
  - Caption: "Sides follow the show settings".
  - `role="img"` with a label such as "Preview: LX and TM tags on the left, SND on the right".
  - The mockup's own note says the thumbnail is not a preview of the content.
  - Rendering page 1 through pdf.js plus the core layout is feasible offline from the cache, but adds cost for little gain, since page 1 often has no cues. Recommend the drawing.
- `runPrintExport(db, ctx, input{…, options, filename})`:
  - Resolves the page indices with `parsePageRange`.
  - Passes `include` to `buildStampItems`.
  - Loads word layers only for included pages, and not for highlight pages when annotations are off, which is faster on a 188-page score.
  - Passes `pages` and `paper` to `stampScript`.
  - Uses the validated file name for the download and the outbox `meta`.
  - `PendingExport.meta` gains optional `options`, so old queued entries still flush.
- Layer rows are restyled in the restyle plan (Task 7: swatches, segmented controls). Layer counts and "All / Only mine" are styling, not designed here.

**Record, API and MCP.**
- Migration `0015_export_options.sql`: `ALTER TABLE export_records ADD COLUMN options jsonb`. Add `options` to the drizzle schema (typed `PrintOptions | null`) and to the client schema as `options: column.text`.
- `routes/exports.ts` `metaSchema` gains `options: printOptionsSchema.optional()`. `createExportRecord` stores it and validates the file name with `validateExportFilename`, so unsafe names are rejected at the door. Existing records are untouched.
- `exportMarkedScript` input becomes `{documentId, versionId?, layers, options?: Partial<PrintOptions>, filename?}`.
  - It validates the range against the version's real page count and applies the same core calls, so server and browser output match.
  - The MCP default is no paper refit.
- `export_marked_script` gains `pages` (string), `paper`, `includeStandbyWarn`, `includeAnnotations`, `filename`. The description names the range syntax and the default file name. No new service operation, so no parity change.
- `list_exports` includes `options` in the record.

**Offline.** Everything is client-side and pure: range, filters, copy and fit all run on cached bytes. The preview needs no network. Printing offline is unchanged: it downloads, queues in the outbox, and records on reconnect with `options` in `meta`.

**Roles.** Unchanged: viewer or above may export.

### (c) Edge cases
- A range reaching past the page count is an error, never a clamp.
- Zero selected layers is a clean copy (already supported). Range plus clean copy is allowed.
- A very large PDF with a fit pass doubles peak memory. Run the fit pass only when a page actually needs it.
- Mixed orientation pages fit per page.
- A rotated or cropped page: embedding uses the visible box, which is the same frame stamping uses.
- A file name collision in Downloads is the browser's job.
- The server rejects a client file name that fails validation with 400; the dialog already prevents it.
- Unicode in names: allowed, and `contentDisposition()` in `routes/blobs.ts` already encodes it.
- Personal layer plus subset: the record stays private as before.

### (d) Tests
- `packages/shared/src/printOptions.test.ts`
  - `parsePageRange accepts 1–43, "3, 7-9" and rejects 0, 44, "a-b", empty`.
  - `normalisePageRange merges and sorts`.
  - `validateExportFilename rejects / \ : * ? " < > |, control chars, CON, leading dot, 201 chars`.
  - `validateExportFilename re-adds a single .pdf`.
  - `scriptExportFilename produces songs-for-a-new-world-libretto-v2-LX-SND-TM.pdf`.
- `packages/core/src/print/stampItems.test.ts`
  - `standbyWarn false keeps only go cues`.
  - `annotations false emits no annotation items`.
- `packages/core/src/print/stampScript.test.ts`
  - `pages [1,2] outputs exactly 2 pages, each with its footer, stamped tags on the right pages`.
  - `paper Letter on an A4 page yields a 612×792 media box with content scaled inside`.
  - `a page already within 3% of the paper is not resized`.
- `apps/api/test/printExport.test.ts` (uses `pdftotext`)
  - `a page range keeps only those pages and pdftotext still finds the script text`.
  - `a Letter fit keeps the text layer searchable`.
  - `options are stored on the export record`.
  - `a range beyond the page count is 400`.
  - `a custom file name is used and an unsafe one is 400`.
  - `the default file name is the slug form`.
- `apps/api/test/exports.test.ts`
  - `the upload meta options round-trip to the record`.
  - `an unsafe client file name is rejected`.
- `apps/api/test/mcpExports.test.ts`
  - `export_marked_script with pages and paper makes the subset PDF`.
- `apps/web/src/exports/PrintDialog.test.tsx`
  - `range input shows the error and disables Download when invalid`.
  - `file name follows the choices until edited, then stays`.
  - `an invalid file name disables Download with the reason`.
  - `submit passes pages, paper and include flags to runPrintExport`.
- `apps/web/src/exports/PrintPreview.test.tsx`
  - `tags land on each department's configured side`.
  - `the page aspect ratio follows the paper`.
- `apps/web/src/exports/runPrintExport.test.ts`
  - `omitted pages load no word layers`.
  - `the outbox meta carries options and the typed file name`.
- `apps/web/e2e/export.spec.ts` (and the `.offline` variant)
  - `printing range 2–3 on Letter downloads a 2-page Letter PDF named as typed, and the export record carries the options`.
  - `after a cold offline reload the same print downloads at once and records on reconnect`.

### (e) Size: 7 tasks
1. M. Shared: options type, range parser, file-name validator, shared default name (replacing both `exportFilename` copies for scripts), tests.
2. M. Core: include filters, page subset, paper fit, with the `pdftotext` check.
3. M. DB migration `0015`, `createExportRecord` and route meta, `exportMarkedScript` options, client schema column, API tests.
4. S. MCP `export_marked_script` options plus tests.
5. S. Web: `runPrintExport`, outbox meta, flusher.
6. M. Web: `PrintDialog` UI and `PrintPreview`.
7. S. e2e online and offline.

Decided: cue notes print under the tag (decision 1). Not built: the written options on the Exports list (not in the mockup; stored but not displayed).

---

## Feature 3. Processing controls

### (a) What exists today
- Pipeline: `apps/api/src/processing/` (`documentJob.ts`, `pageJob.ts`, `ocrmypdf.ts`, `poppler.ts`, `exec.ts`, `queue.ts`, `reanchorJob.ts`, `reanchorSweep.ts`).
  - pg-boss 12.37 runs the document queue (concurrency 1, `retryLimit` 2, expiry OCR timeout plus 10 min, dead-letter queue) and the page queue (concurrency 2).
  - `runTool` (`exec.ts`) uses `execFile` with a timeout. A timeout kills only the direct child with SIGTERM.
- Real failure points today, with what is written:
  - Enqueue fails after the upload: `enqueueProcessing` sets `failed` with "Could not queue processing" (`documents.ts`).
  - `pdfinfo` exits non-zero, or its output has no page count or sizes: `markVersionFailed` with "This PDF is password-protected…" or "This file could not be read as a PDF. (…)". This is the encrypted and corrupt case.
  - Dead letter after retries or expiry: "Processing timed out after retries." or "Processing failed after retries: <message>".
  - A pdfinfo or poppler timeout rethrows, is retried, then dead-letters.
  - **Not failures today:** `runOcrmypdf` falls back to a plain copy on any `ToolError`, including an OCR timeout, and the version becomes `ready` with `error` holding "ocrmypdf exit N: …". A scan with no extractable text also becomes `ready` with empty word layers. A page job failure marks only that page.
  - A 200 MB upload cap is rejected at the door with 413 (`byteLimit`), and non-PDFs by magic bytes before any row exists. Neither is a version failure.
- `markVersionFailed` is conditional on `status IN ('queued','processing')`, so a ready version is never failed afterwards.
- `processDocumentVersion` sets `status='processing'` **unconditionally**, and its final transaction writes the searchable key and pages with no status check. Both would resurrect a cancelled version, so they must be fixed.
- Web: `documents/documentEntries.ts` and `DocumentRow.tsx` give a plain sentence plus Details (`splitFailure`), and an "Upload again" button for failed rows; there is no retry, remove or cancel. The processing row says "Uploaded, now extracting text" with no size.
- No document or version delete exists in `services`. `services/revert.ts` treats `documents` and `document_versions` inserts and deletes as not revertible (lifecycle events).
- Sync: `document_versions` is not writable through sync (`sync/policy.ts`), so cancel, retry and remove are API calls. Spec 4.1 gives editors (and owners) Documents upload, rename and delete.

### (b) Design

**Schema (`0016_version_processing_controls.sql`, `packages/db/src/schema/documents.ts`).**
- `original_size_bytes integer` (nullable; the 200 MB cap fits in 32 bits, and integer is simplest for PowerSync).
- `failure_code text` (nullable; set only when `status='failed'`).
- `failure_dpi integer` (nullable; set only for `low_resolution`, the one code whose copy needs a number).
- Backfill failed rows from the existing `error` text with an `UPDATE … CASE`:

| `error` matches | `failure_code` |
|---|---|
| `%password-protected%` | `password_protected` |
| `This file could not be read%` | `unreadable` |
| `%timed out%` | `timeout` |
| `Could not queue processing` | `enqueue_failed` |
| anything else | `unknown` |

- Client schema (`apps/web/src/powersync/schema.ts`) gets `original_size_bytes: column.integer`, `failure_code: column.text`, `failure_dpi: column.integer`.
- **Sync rules: no change** (`SELECT *`). `schema.test.ts` and `publication.test.ts` stay green.

**Size capture.** `BlobStore.put` (`apps/api/src/blob/BlobStore.ts`) changes from returning `void` to returning `{ size: number }`.
- `DiskBlobStore` stats after the rename.
- `storeThenWrite` in `services/documents.ts` passes the size into the version insert. That covers `createDocument`, `addDocumentVersion` and `uploadDocumentFromUrl`.
- Web: `formatBytes()` gives "12 MB" (mono, decimal; one decimal under 10), and the processing row reads "12 MB uploaded, now extracting text".

**Failure taxonomy (`packages/shared/src/processing.ts`, new, pure, with copy).**

| code | detected where | pill | copy |
|---|---|---|---|
| `unreadable` | `readPages`: pdfinfo error or parse error, not a password | couldn’t read file | This file isn’t a PDF Binder can open. It may be damaged. Export the script as a PDF again and upload that. |
| `password_protected` | pdfinfo stderr says password | password protected | This PDF needs a password to open. Remove the password and upload it again. |
| `no_text` | new check, below | couldn’t read text | No text could be read from any page, so there is nothing to search or anchor cues to. Check it is the script, or upload a clearer scan. Or remove this upload, then upload the file again as a new document with Text recognition set to Never, and mark it up by position. (R44) |
| `low_resolution` | `no_text` plus median scan ppi under 150 | couldn’t read text | Scanned at {dpi} dpi, so there is no text to search or anchor to. Try a 300 dpi scan. Or remove this upload, then upload the file again as a new document with Text recognition set to Never, and mark it up by position. (the mockup's words, plus R44) |
| `timeout` | dead letter with "timed out", or a job-expiry message | couldn’t finish | This file took too long to process. Try again; if it keeps happening, split the PDF or upload a smaller scan. |
| `cancelled` | the cancel service | cancelled | Cancelled. The file is still here if you want to try again. |
| `enqueue_failed` | `enqueueProcessing` catch | didn’t start | Binder couldn’t start processing this file. Try again. |
| `unknown` | any other dead letter | couldn’t process | Binder couldn’t process this file. Try again; if it fails again, Details says why. |

- `describeFailure(code, params)` returns `{title, message, retryable}`. Retryable in place: `timeout`, `cancelled`, `enqueue_failed`, `unknown`. Deterministic: `unreadable`, `password_protected`, `no_text`, `low_resolution`.
- `too_large` and "not a PDF" are not persisted. The first is the 413 at upload; the second is the 400 magic-byte refusal. State this in the doc comment.
- `error` stays as the technical detail for Details, and as the fallback for any legacy row with a null code (`splitFailure` stays for that).
- Web `documentEntries.ts`: `FailedEntry` gains `code`, `title`, `canRetryInPlace`; `ProcessingEntry` gains `sizeBytes` and `canCancel` (true for queued or processing; false for the re-anchoring wait). The MCP version summaries add `failureCode`, `failureMessage` and `originalSizeBytes`.

**New detection (`documentJob.ts` after OCR or copy, before the searchable blob is stored).**
- `listImagePages` becomes `imageStats(pdf)`. `pdfimages -list` already prints `x-ppi y-ppi` columns (verified on `fixtures/public/generated/pirates-scan.pdf`: 150/150). It returns the page set plus the median of `min(x-ppi, y-ppi)`.
- `countTextChars(searchable)` runs `pdftotext -enc UTF-8 file -` and counts non-whitespace characters.
- Rule: if the document is text-anchored (effective snap-to-text true, so kind `libretto` or `other`, or `snapToText` set), `ocrMode === 'auto'`, and the total is under 20 characters, fail with `no_text`, or `low_resolution` with `failure_dpi` when the median ppi is under 150.
- Scores, blocking and `ocrMode='never'` are exempt, because they anchor by position and the spec says their OCR is junk anyway. This keeps the blast radius small. See decision 3.
- `markVersionFailed(db, id, error, code, dpi?)` gets the new parameters. `classifyJobFailure(output)` maps dead-letter text to `timeout` or `unknown`.

**Cancel (queued or processing only).**
- Service `cancelVersionProcessing(db, jobs, actor, {versionId, showId?})`:
  - Editor or above on a writable show.
  - One transaction locks the version `FOR UPDATE` and runs a conditional update to `failed`, `failure_code='cancelled'`, `error='Cancelled'`, `updated_by=actor`, only `WHERE status IN ('queued','processing')`.
  - It deletes the version's page rows and writes a change-log row (before status, after failed/cancelled).
  - If the version is already `failed`/`cancelled` it returns it (idempotent). If it is `ready` it throws `conflict("This upload has already finished")`.
  - The re-anchoring wait is `ready` and not current, so it is not cancellable. The UI hides Cancel there.
- Stopping the work is DB-driven, not tied to pg-boss internals:
  - pg-boss 12.37 only aborts `job.signal` when a queue heartbeat is configured, and `boss.cancel` does not interrupt an active handler, so I do not rely on either.
  - The document job wraps OCR in `watchForCancel(db, versionId, controller)`, which polls `document_versions.status` every 2 s and aborts the controller when the status is no longer `processing` or the row is gone. This works however the worker is deployed.
  - `runTool` gains a `signal` option, implemented with `spawn({detached:true})` and a process-group kill: SIGTERM, then SIGKILL after 5 s. This fixes a latent issue: today a timeout leaves ghostscript and tesseract children running.
  - `ToolError` gets `aborted: true`.
  - **`runOcrmypdf` must rethrow an aborted error instead of falling back to a copy.** The document job catches `ProcessingCancelled` and returns quietly, so the pg-boss job completes without a retry.
- Guards so cancel cannot be undone by a late job (needed even without cancel, as retries race):
  - The first update in `processDocumentVersion` becomes `WHERE status IN ('queued','processing')`, and it returns when zero rows change. `processing` stays allowed, so a pg-boss retry of the same job continues.
  - The final transaction re-reads the version `FOR UPDATE`, and if the status is not `processing` it discards its work and deletes the searchable blob it wrote.
  - `processPage` returns early when its version is not `processing` (cancelled page rows are already gone).
- A job still queued in pg-boss for a cancelled version simply runs, sees `failed`, and returns.

**Retry (same blob).**
- Service `retryVersion(db, blobs, jobs, actor, {versionId, showId?})`: editor or above; show writable.
  - It requires `status='failed'` and that the version is the document's newest. Otherwise `conflict("A newer version exists; upload again or remove this one")`.
  - It requires `blobs.exists(originalKey)`, otherwise `conflict("The uploaded file is no longer stored; upload it again")`.
  - One transaction does a conditional update to `queued`, with `error`, `failure_code`, `failure_dpi` cleared, `updated_by=actor`, deletes any page rows, and logs it.
  - After commit it re-uses `enqueueProcessing`, which marks `enqueue_failed` if the enqueue throws.
- Allowed for every code. The web decides the button: for a retryable code, "Try again" calls retry; for a deterministic code it opens the existing upload dialog for a replacement version, because re-running the same file would fail identically. This keeps the mockup's two buttons, [Try again] [Remove].
- A newer version hides an older failed one (`buildDocumentEntries` already shows only the newest), so no cleanup is needed.

**Remove (failed versions, and the document when it was the only one).**
- Service `removeVersion(db, blobs, actor, {versionId, showId?})`:
  - Editor or above; show writable; `status` must be `failed` (cancel first), otherwise `conflict`.
  - It refuses if any cue or annotation anchor references the version (`anchor->>'documentVersionId'`). The pipeline cannot produce that, because cues anchor only after the version is ready, but the guard is cheap.
  - One transaction deletes the version row and its pages (cascade) and logs a `delete` with a before-image that includes `failureCode`.
  - If it was the document's only version, the document row is deleted too, with its own logged `delete`.
  - If it was `documents.current_version_id` and others exist, `current_version_id` becomes the highest ready version, else null.
  - After commit, best-effort `blobs.delete` for the original and searchable keys.
- Hard delete, not soft. It follows `deleteCues`/`deleteAnnotations` (before-image in the log) and `revert.ts` already refuses deletes on these tables. This is irreversible and the confirm copy says so.
- The summary grammar counts a document's own version deletion once.
- Cues anchored to a never-ready version: there are none. The guard covers the impossible case.

**Roles.** Editor or above (spec 4.1: upload, rename, delete). Viewer: not offered. Archived show: refused by `assertShowWritable`. Tokens: `requireShowRole`/scope as everywhere.

**Routes (`routes/documents.ts`).**
- `POST /api/shows/:showId/versions/:versionId/cancel` returns `{version}`.
- `POST /api/shows/:showId/versions/:versionId/retry` returns `{version}`.
- `DELETE /api/shows/:showId/versions/:versionId` returns `{removed:{versionId, documentId, documentRemoved}}`.
- Errors: 404 not found, 403 role, 409 wrong state.

**MCP.** Three tools in `mcp/tools/documents.ts`, separate so the hints are accurate:
- `cancel_version_processing {versionId}`
- `retry_version {versionId}`
- `remove_version {versionId, confirm}`. When the removal would delete a whole document it returns `confirmationRequired(...)`, using the existing gate and `CONFIRM_DESCRIPTION`.
- Map `cancelVersionProcessing`, `retryVersion` and `removeVersion` in `OPERATION_TO_TOOL`.
- `list_documents` and `get_document` version summaries add `failureCode`, `failureMessage`, `originalSizeBytes`.
- Update the MCP `INSTRUCTIONS` string in `mcp/server.ts`.

**Change-log grammar** (shared with Feature 1's task 1; see its summary rules): `cancelled`/`retried`/`removed` give "cancelled 1 upload", "retried 1 upload", "removed 1 upload". `cardSentence` renders them as "upload cancelled" and so on.

**Web.**
- `DocumentRow.tsx`:
  - Processing row: the size in the status line, a ghost Cancel (44 px on phone), hidden while re-anchoring and when the user cannot upload (reuse `canUpload`).
  - Failed row: pill from `describeFailure().title`, copy with `<span class="mono">` for the dpi, then [Try again] [Remove] and Details only for the technical text.
- `documents/useVersionActions.ts` has `useMutation`s calling the three routes. Online only: when offline the buttons are disabled with "Needs a connection" (reuse the `NeedsConnection` pattern from `history/`). Success relies on the sync stream, which flips the row within about 2 s.
- Remove confirms with `useConfirm` ("Remove Blocking notes.pdf? The file and its record go. Nothing in the script uses it.").
- Surface server `ApiError` messages via `pushNotice`.

### (c) Edge cases
- Cancel versus a job that is just finishing: whichever commits first wins. The conditional updates and the re-check in the final transaction make this safe. If the job wins, cancel returns "already finished".
- Retry immediately after cancel, within the 2 s poll window: the first run may keep going and the version is requeued, so the second job finds it `ready` and exits. Harmless, listed so no one is surprised.
- Cancelling mid-OCR must leave no partial `searchable.pdf`: the abort path writes nothing.
- A pg-boss retry after a crash resumes via the `processing` guard.
- Orphan OCR grandchildren are fixed by the process-group kill.
- Retry where the blob was lost to a volume restore: 409 with plain copy.
- The first upload of a new document cancelled: the row becomes failed/cancelled and the user presses Remove (two steps; fine).
- Concurrent removes: the second sees 404.
- A user removed from the show between click and request: 404/403 as usual.
- `no_text` false positives on a mostly-image score are avoided by the kind exemption. An all-blank PDF correctly fails.
- PowerSync lag: the UI may show Cancel for 2 s after the job finished. The 409 is shown as a notice.
- A search of docs for `document_versions` row history in `formatChange.ts` may need the new verbs (low risk).

### (d) Tests
- `packages/shared/src/processing.test.ts`
  - `describeFailure low_resolution interpolates the dpi (72)`.
  - `every FailureCode has a pill and message`.
  - `deterministic codes are not retryable in place`.
  - `formatBytes gives 12 MB, 1.4 MB, 340 KB`.
- `apps/api/test/processing.test.ts`
  - `password-protected pdf fails with password_protected`.
  - `a corrupt pdf fails with unreadable`.
  - `dead letter 'job timed out' gives timeout`.
  - `dead letter with another message gives unknown`.
  - `enqueue failure gives enqueue_failed`.
  - `a text-anchored scan with no text and 72 dpi fails low_resolution with failure_dpi 72`.
  - `no text at 300 dpi fails no_text`.
  - `a score with no text becomes ready`.
  - `ocrMode never is not checked`.
  - `a cancelled version is not resurrected by the document job`.
  - `a cancelled version is not made ready by late page jobs`.
- `apps/api/test/processing.test.ts` (tool wrappers)
  - `runTool aborts the whole process group on signal`.
  - `runOcrmypdf rethrows an aborted run instead of copying`.
- `apps/api/test/processingControls.test.ts` (new)
  - `cancel flips a queued version to failed/cancelled, deletes pages, logs`.
  - `cancel during OCR kills ocrmypdf within about 3 s` (a stand-in `ocrmypdf` script on PATH that sleeps, as the existing tests do).
  - `cancel on a ready version is conflict`.
  - `cancel by a viewer is forbidden, in an archived show is refused`.
  - `retry requeues the same blob and a new job processes it to ready`.
  - `retry when the original blob is missing is conflict`.
  - `retry of a non-newest version is conflict`.
  - `retry marks enqueue_failed if the queue throws`.
  - `remove of a failed only-version deletes the document too and its blobs`.
  - `remove of a failed v2 keeps v1 current`.
  - `remove of a ready version is conflict`.
  - `remove refuses when a cue is anchored to the version`.
  - `change log records cancel, retry and remove; revert refuses them`.
- `apps/api/test/documents.test.ts`
  - `upload records original_size_bytes`.
  - `uploadDocumentFromUrl records the size`.
- `packages/db/test/schema.test.ts`: the migration backfills failure codes from `error`.
- `apps/api/test/mcpDocuments.test.ts`
  - `the three tools work`.
  - `remove_version needs confirm for a whole-document delete`.
  - `list_documents shows failureCode and size`.
- `apps/web/src/documents/documentEntries.test.ts`
  - `failed entry copy comes from the code`.
  - `legacy null code falls back to splitFailure`.
  - `canCancel is false while re-anchoring`.
- `apps/web/src/documents/DocumentRow` tests
  - `processing row shows "12 MB uploaded" and Cancel`.
  - `failed low_resolution row shows the mockup copy with 72 dpi`.
  - `Try again on a timeout calls retry; on low_resolution it opens the upload dialog`.
  - `Remove confirms then calls delete`.
  - `buttons are disabled offline`.
- `apps/web/e2e/documents.spec.ts` (new)
  - `uploading a 72 dpi scan shows "couldn’t read text" with the dpi copy and Remove clears the row`.
  - `cancelling a big upload turns the row to Cancelled and Try again completes it` (fixtures from `fixtures/scripts`).

### (e) Size: 9 tasks
1. S. Shared taxonomy, copy, `formatBytes`, tests.
2. M. Migration `0016`, drizzle and client schema, `BlobStore.put` size, capture at upload, backfill test.
3. M. Failure classification in the document job, dead letter, `enqueueProcessing`, resurrect-guards.
4. M. `no_text`/`low_resolution` detection (`imageStats`, `countTextChars`).
5. M. Cancellation: `runTool` signal and process-group kill, watcher, `runOcrmypdf` rethrow.
6. M. Services `cancel`/`retry`/`remove`, routes, change log, summary verbs (this is where the Feature 1 grammar gets `cancelled`/`retried`/`removed`).
7. S. MCP tools, parity, instructions, summaries.
8. M. Web rows, mutations, confirm, offline disabled, phone layout.
9. S. e2e.

Cut or defer: the "64 %" figure (not asked; the page-ready ratio already exists); Cancel during re-anchoring; soft delete or revertable remove; per-page retry (spec 11 defers it).

---

## Feature 4. Keep-offline switch

### (a) What exists today
- `apps/web/src/offline/OfflineButton.tsx` is a one-off `prefetchShow` (`prefetch.ts`). It calls `navigator.storage.persist()`, then `blobUrlsForShow(loadShowBlobRows(...))` (searchable PDF, thumbs and word layers of each ready version, current version first, six at a time via `storeBlob`).
- `useOfflineSummary.ts` and `cacheStatus.ts` count cached versus total and re-scan on a cache epoch or a ready-version change.
- The button is used in `overview/OfflineCard.tsx` (desktop and tablet) and `routes/shows.$showId.more.tsx` (the phone's Offline card).
- Blobs live in the Cache API `blobs-v1` (`blobs/fetchBlob.ts`). The service worker also caches any `/blobs/*` response CacheFirst into the same cache (`vite.config.ts` runtime caching), so cached is not strictly "prefetched".
- Sign-out: `auth/signOut.ts` calls `clearOutbox` then `clearLocalData`, which runs `disconnectAndClear` and `clearBlobCache`. `powersync/provider.tsx` also clears the blob cache and other users' outboxes when the device changes owner. The per-user IndexedDB store pattern is in `exports/outbox.ts` (`binder-exports-<userId>`).

### (b) Design

**Where the preference lives.** IndexedDB via idb-keyval, one database per user: `binder-offline-<userId>`, key `show:<showId>` holding `{on: true, enabledAt}`. It is per device and per user, never synced; it mirrors the outbox's shape (`OfflinePrefsStore` with get, set, list, clear) and is mirrored in memory with a `useSyncExternalStore` subscription, in the style of `cacheStatus.ts`. Transient state (progress, errors) is memory only.

**Runner.** `apps/web/src/offline/keepOffline/`: `store.ts`, `runner.ts` (pure logic with injected deps) and a `KeepOfflineRunner` component mounted once in `routes/__root.tsx`'s `SignedIn`, inside the PowerSync provider. It runs app-wide, so it keeps working while the user is on the home page or another show.
- Trigger sources: a preference change, a change in the set of ready versions or page rows, the browser `online` event, and a retry timer. Row changes come from one app-level `useQuery` over `document_versions` and `pages` for all local shows, filtered in JS to enabled shows. A signature string debounces it by 2 s after changes settle.
- `reconcile()` for each enabled show:
  - Take `blobUrlsForShow(rows)` (same ordering, current version first).
  - Get the cached set from one `cache.keys()` call, and compute `missing = urls − cached`.
  - Fetch the missing ones with `storeBlob`, concurrency 2 (the manual button uses 6).
  - Because it is a set difference, it self-heals after a cache eviction or a first enable, and no "new files" bookkeeping is needed.
- Limits:
  - Skip when offline or `navigator.connection?.saveData`.
  - Before each batch, `navigator.storage.estimate()`: if free space is under `max(150 MB, 10% of quota)`, or `cache.put` throws a quota error, stop with state `full`. `original_size_bytes` (Feature 3) may be used to estimate a batch before starting, as an optional refinement.
  - Failures retry with backoff 30 s, 2 min, 10 min (capped), reset by the next sync change or online event.
  - Call `navigator.storage.persist()` when first switched on.
  - No cellular detection: the Network Information API is Chromium-only and not on iOS.
- Single leader across tabs: `navigator.locks.request('binder-keep-offline', {ifAvailable:true}, …)`. Other tabs show On without progress. Sharing status over `BroadcastChannel` is a later nicety.
- Switching on runs the full catch-up immediately (the same work as today's button, with progress). Switching off aborts in-flight fetches and keeps what is already cached. "Free up space" is cut, see below; if wanted later it deletes cache keys with the prefix `/blobs/shows/<showId>/documents/` and leaves export blobs alone.
- Pruning: when a show disappears from the local `shows` table (membership removed or deleted), drop its preference and delete that show's document blobs, so a removed member's files do not linger.

**Service worker background sync: not worth it.**
- PowerSync only syncs while the page is open, so there is no way for a worker to learn that a new version exists.
- Background Sync and Periodic Sync are Chromium-only; iOS Safari has neither.
- The runner reconciles by set difference on every open, so what was missed is fetched when the app next opens. Say this in the doc comment.
- Caveat to show the owner: iOS can evict storage for sites not installed to the Home Screen, so the promise "stays fully offline-ready" is strongest for the installed PWA.

**UI states (words, never colour alone).** A `KeepOfflineSwitch` component (the toggle with the word "On" in green, per `m-more`) replaces `OfflineButton` in the phone More card, and sits in `overview/OfflineCard.tsx` as well, because tablet and desktop have no More tab. That second placement goes beyond the mockup; I recommend it, since iPad is a main device.
- On, all cached: the existing `OfflineLine` ("All 311 files are cached on this device.").
- On, working: "Updating 3 files…" with a progress indicator, `role="status"`.
- On, offline: "Waiting for a connection. 3 files to fetch." Offline is a state, not an error (DESIGN §11).
- On, storage full: "Storage is full. Binder couldn’t save 3 files. Free some space on this device." with a warn pill carrying words.
- On, failures: "2 files couldn’t be saved. Binder will try again."
- Off: only the summary line.
- The one-off "Make available offline" button stays on the desktop overview/top bar, as the `show` mockup keeps it. The switch is the persistent version.

**Sign-out and user change.**
- `SignOutDeps` gains `clearOfflinePrefs`, called next to `clearOutbox`, deleting the user's preference store.
- `clearOtherOfflinePrefs(userId)` runs in the `claimLocalDb` callback in `provider.tsx`, as `clearOtherOutboxes` does.
- The runner is stopped (aborting in-flight fetches and ignoring any late `cache.put`) before `clearBlobCache`, so a download that is mid-flight at sign-out cannot repopulate the cache for the next user.
- After sign-out the next sign-in starts with every show Off. That is deliberate, since the cache was wiped too.

**Roles.** None needed; the switch is local. Archived shows: allowed.

### (c) Edge cases
- Quota exceeded mid-batch: stop and report `full`, and keep partials. The next reconcile continues.
- Two tabs: the Web Locks leader runs; if the leader closes, the next tab's lock request takes over on its next trigger. Tabs without Web Locks (old Safari) fall back to running in each tab, which is harmless because `storeBlob` skips cached URLs.
- A version still processing: nothing to fetch until `ready`, because `blobUrlsForShow` only takes ready versions.
- A huge first enable on a slow link: progress, and `online`/`visibilitychange` resumes it.
- Removing a show's membership while On: pruned (above).
- Cache eviction by the browser: next reconcile refetches.
- An export outbox or export blobs: untouched.

### (d) Tests
- `apps/web/src/offline/keepOffline/runner.test.ts` (fakes for db, cache, estimate, timers)
  - `fetches only missing urls, current version first`.
  - `a new ready version fetched after the sync signature changes`.
  - `Off stops in-flight fetches and keeps cached blobs`.
  - `offline waits and resumes on online`.
  - `saveData pauses`.
  - `a quota error stops with state full`.
  - `low estimate headroom stops with state full`.
  - `failures back off 30 s then 2 min then 10 min and reset on a sync change`.
  - `a removed show's preference and blobs are dropped`.
  - `a late put after stop is discarded`.
- `store.test.ts`
  - `preferences are per user`.
  - `clearOtherOfflinePrefs keeps the current user's`.
- `apps/web/src/auth/signOut.test.ts`
  - `sign-out clears offline preferences and stops the runner before clearing the cache`.
- `KeepOfflineSwitch.test.tsx`
  - `renders On with the word, the updating text, the offline text and the full text`.
  - `the toggle persists the preference`.
- `apps/web/e2e/offline.spec.ts` (add)
  - `with keep-offline On, a revision uploaded by another user is in the Cache within 30 s and opens offline; with it Off it is not`.
  - `after sign-out and sign-in the switch is Off`.

### (e) Size: 5 tasks
1. S. Store, hooks, sign-out and user-change clearing.
2. M. Runner logic with tests (planner, limits, backoff, locks).
3. S. `KeepOfflineRunner` mount, status store, blob-cache epoch notifications.
4. S. `KeepOfflineSwitch` UI, More card and `OfflineCard`, state copy.
5. S. e2e.

Cut: "free up space on Off" (optional, one S task if wanted, decision 5), service-worker background sync, a cellular-data rule, `BroadcastChannel` status sharing.

---

