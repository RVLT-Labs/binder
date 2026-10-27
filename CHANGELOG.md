# Changelog

All notable changes to Binder. Format follows [Keep a Changelog](https://keepachangelog.com). Binder has no
version numbers: each entry is dated and names the commit on `main` that was deployed to
https://binder.rvlt.app. The reasoning behind each change is in `docs/superpowers/records/`; the design
reasoning is in the decisions log at the end of `DESIGN.md`.

## [Unreleased]

### Known issues
Listed in full, with their fixes, in `docs/superpowers/records/2026-10-16-ui-restyle-rulings.md` under "Known
issues and open follow-ups". The ones worth knowing:
- The e2e test "compare shows the cut lines as removed" (`revisions.spec.ts`) fails about one full run in three
  on a cold dev server; it passes alone and is not a user-facing problem.
- The offline banner takes layout space, so the document stage shifts by about 56 px when the network flaps.
- In Calling mode the strip's page counter lags after a keypad jump until the next scroll.
- On an archived show, the phone script keeps a disabled Place cue button whose tooltip covers script text.
- A highlight or underline whose quote was cut at 400 characters and whose range crosses a page is not flagged
  `approximate` when a revision re-anchors it, so it can shrink to the part that fits without landing in the
  review list.
- On a touch screen the cue tool places a cue with a tap, which under Auto is a line: a finger cannot drag a
  range because the page scrolls. To highlight several words use an Apple Pencil, or choose Underline in the
  flyout, tap, and switch its Mark to Highlight in the cue editor.

## 2026-10-22: cue marks, bubbles and connectors, reactivate, and placement by gesture (`e34de82`)

Deployed to production on 2026-10-22 after a fully green CI run on `main` (`check`, `images` and the browser
`e2e` suite). This entry also collects everything since `d8ecf93` that was never dated: the canonical-contracts
work from #2 first went out as `967f0c4` on 2026-10-20.

### Added
- Cue mark styles. A cue is drawn as an underline (as before, and the default), a highlight (a translucent
  fill in the department colour, 28% and 40% while selected), a line (a bar on a character boundary, so a cue
  can sit in the middle of a word) or a line with a pointer. The mark is chosen per cue: a `Cue mark` choice
  beside the type in the cue tool's flyout, and a `Mark` control in the cue editor. The highlight prints too
  (a multiply-blended fill, so black text stays black); this relaxes the old "print never fills" rule for the
  highlight only. MCP: `place_cue_at_text` takes `mark` and `charOffset`, and `create_cue` / `update_cue`
  accept `mark`. History reads a mark change as "restyled". The data lives in the cue's `anchor` JSON (`mark`
  and `text.offset`), so there is no migration. Spec: `docs/superpowers/specs/2026-10-20-cue-marker-styles.md`.
  - Compatibility: a web client cached from before this change does not know the new anchor fields and drops
    them when it moves a cue, so that cue goes back to an underline, and a moved bubble goes back to the
    margin (the old client drops its `tag` too), until the client is reloaded (Reload in the update prompt). Nothing is lost on the server for cues nobody moves.

- A cue's number bubble can be moved off the margin. Drag the bubble of the selected cue to put it anywhere on
  the page, or nudge it with Alt+arrow keys (1 pt, 10 pt with Shift; plain arrows still turn the page); the cue editor has a `Bubble` row that
  says "In the margin" or "Moved" with a `Reset to margin` button. A moved bubble takes no part in the margin
  spread, is joined to its mark by one straight leader, draws no note, and prints where it was put. History
  reads it as "bubble moved". MCP: `update_cue` takes `bubble: {dx, dy}` (`null` resets it) and the
  coordinates `anchor` of `create_cue` / `update_cue` accepts `bubble`. The offset is stored in the cue's
  anchor as `tag`, so there is no migration.

- A connector style per department. The owner picks a width (Thin 0.75 pt, the default, Medium 1.5 pt or Bold
  2.5 pt) and a pattern (Solid, the default, Dashed or Dotted) for each department's connector, the line from
  a cue's bubble to its mark, with the `Connector width` and `Connector pattern` controls in the Departments
  section of Show settings; everyone else reads them as words. It draws the same on screen, in browser print
  and in the server export. Parallel leaders on one line keep at least 1.5 pt apart, more when they are
  heavier. MCP: `update_show` settings carry `connectorStyles`
  (`{<departmentId>: {width, pattern}}`); each missing or invalid field falls back to its default (thin, solid). The data lives
  in the show's settings JSON, so there is no migration.

- Bring a show out of the archive from where you find it. An owner's archived card on the shows home now has
  **Reactivate**, and an archived show's page opens with a banner (read-only for everyone, exports still work)
  that gives the owner **Reactivate show** and tells everyone else to ask an owner. Reactivating returns the show
  to prep, as the Archive card in Show settings always did, and the card moves up to Active under keyboard focus.
  No server or MCP change: an owner changing `status` back was already the one write an archived show accepts.

### Changed
- The cue tool places by gesture. Its `Cue mark` choice has a new default, **Auto**: dragging over one or more
  words (mouse or pen) highlights exactly those words, and a plain click places a line on the nearest character
  boundary (with the ghost bar showing where). Underline, Highlight, Line and Line with pointer stay in the
  choice as overrides and behave as before; a finger on a touch screen still scrolls, so there Auto only
  places lines (use Highlight, or the cue editor, for a highlight). The Place cue button and the `c` key place
  a line in Auto. In the cue editor, switching a line to Underline or Highlight now covers just the word the
  bar sits in instead of the rest of the line; MCP `update_cue` still keeps the cue's whole quote. A cue with
  no `mark` is still an underline, and an MCP placement still defaults to underline.
- Dragging a cue's bubble no longer moves the cue; it moves only the bubble. To move the cue, drag its mark
  (with the Select tool) or use "Move to...".
- Crowded margin bubbles now spread up and down around their own lines instead of only drifting down the
  page, so each bubble stays near its line (two cues on one line sit 8 pt above and 8 pt below it). Tags that
  do not overlap stay level with their lines. The same layout runs on screen, in browser print and in server
  export, so crowded bubbles in existing shows sit slightly differently on screen and on paper than before;
  nothing stored changes.
- Re-anchoring after a script revision no longer shortens a matched quote to eight words, so an annotation
  highlight whose quote is longer than eight words keeps its full range instead of shrinking.
- A cue's underline range that was cut at 400 characters (a long drag with the cue tool) re-anchors as
  `approximate`, as a cut highlight does, instead of shrinking silently.
- Archived cards on the shows home no longer have the rename pencil: the server refuses any change to an archived
  show but its status, so a rename could not be saved. It comes back with the show.
- Guard retained local CRUD completion handles and read callbacks against session changes; close
  Print when history restores Calling; reserve 44 px comparison/tool option fields and room in their containers.
- Adopt canonical RVLT v1.3.0 authority and contrast roles, preserving Binder's fixed white page,
  Helvetica cue geometry, compact rectangular button faces and dialog cast. Cue words now use page
  ink on screen and in print; department identity stays on marks and swatches in both themes.
- Preserve loading-button names, guard disabled/loading slotted controls, reserve nonoverlapping
  44 px chrome targets, label custom colours and request decimal cue keyboards. Calling keeps
  the palette and Print closed, says Offline without asserting cache readiness, and labels its
  next cue relative to the page top. Ambiguous keypad jumps require Page or a recent target.
- Sign-out checks queued changes and pending exports, stops on count failures, drains local writes
  and exports before confirmation, rechecks queues and awaits runners before clearing. New or
  changed department colours need 3:1 mark contrast on white and the existing red guard; unchanged
  legacy colours remain editable.
- RVLT-wide design decisions (rvlt-designlanguage v1.2.0, 2026-10-19): page titles use the new `t-page-title`
  (24 px / 800 Archivo; `t-title` stays for dialogs), icons draw at stroke 2 instead of 1.8, key caps are 11 px
  (the floor) instead of 10.5 px, and the opt-in Paper theme is retoned so every text pairing passes 4.5:1
  (`--ok`/`--green`, `--warn`, `--rep`, `--blue`, `--muted`, `--faint`, `--coral`, `--teal`, `--lime`). The dark
  theme is unchanged. Recorded in the `DESIGN.md` decisions log.
- Changing a show setting twice in quick succession (a connector's width, then its pattern; or a marker side and
  a connector style) no longer loses the first change: the settings editors read and write the show's settings
  in one local transaction. Tab order on a department row now runs marker side, Hidden, then the connector
  controls.

## 2026-10-17: fixes, license and housekeeping (`d8ecf93`)

Deployed to production after a fully green CI run on `main` (`check`, `images` and the browser `e2e` suite).

### Added
- MIT `LICENSE` (the agent skill's header already said MIT), with `"license": "MIT"` in every `package.json`.
- `CLAUDE.md` (notes for Claude sessions), this changelog, `docs/README.md` (a map of the docs), the UI
  restyle rulings record, and a README for the mockup sources.
- `scripts/e2e-locked.sh`, exposed as `pnpm e2e`, `pnpm e2e:offline` and `pnpm e2e:all` at the repo root: runs
  Playwright under a machine-wide lock so two sessions or worktrees never test each other's code.

### Fixed
- Re-anchoring after a script revision: a cue anchored to one copy of a repeated line (a chorus line, a refrain) was
  moved onto another copy with status `ok` when its own copy was cut, so it never reached the review list. It is now
  `approximate` and appears in the review. When the copies sit in near-identical surroundings, a few extra cues
  can be flagged; that is the safe direction.
- `revert_change` and `revert_batch` check the caller's rights before reporting that a row changed, so a caller who
  may not edit a layer gets `forbidden` and learns nothing about it (it used to get a `conflict` naming the columns).
- `renumber_cues` reports collisions with cues it does not touch (unplaced, or in another document) as `flagged`
  entries with reason `duplicate`; it used to return an empty list while both cues were marked duplicate.
- OCR on the production toolchain (Debian 12's OCRmyPDF 14): a scanned PDF with owner restrictions (no copying or
  editing, but opens without a password) is now OCRd instead of being copied through unread. A page whose text
  matrix holds a tiny number such as 6.1e-17 (typical of rotated text) no longer loses its text: in that rare
  case OCR is repeated so that pages which already have text are not re-OCRd, unless that would find less text,
  and the version's Details say when this happened.
- A restricted PDF now always gets an unrestricted working copy (OCR off, no images, or any fallback), so marked
  script exports no longer fail on it. The original upload is kept untouched.

### Changed
- The agent skill (`skills/binder`) and the specs and records it draws on describe the fixed behaviour above.
- DESIGN.md's Calling-mode row now says the page's width (not its height) is capped at 0.9 times the stage height.

## 2026-10-17: agent skill (`ed5dfbb`)

### Added
- `skills/binder`: a `SKILL.md` and eleven references that teach an agent to use Binder through MCP: reading
  scripts, placing and inserting cues, annotations, revisions and re-anchoring, history and revert, exports and
  print options, document processing, the confirm gate and the safety rules. Every recipe was run against a
  local API, and an independent review compared each claim with the code.
- MCP resource `binder://skill/{slug}` (`index` is the SKILL.md; the rest are the references, with relative links
  rewritten to resource URIs). The server's connect-time instructions now point agents at `binder://skill/index`.
- `apps/api/test/skillDocs.test.ts` fails if the docs name a tool that does not exist, omit a registered tool or
  resource, or disagree with the code's confirm-gated tools; `skillLinks.test.ts` covers the link rewrite.

### Changed
- `biome.json` ignores `.claude/worktrees` (nested configs there broke the root lint).

## 2026-10-17: UI restyle and four features (`8e2d9d0`)

The whole web app moved onto the "Prompt corner" design system (RVLT Flow tokens and fonts, ink-on-paper script
pages, department colour only on the page), built to the approved mockups, and works on phone, tablet and
desktop. Migrations 0016 and 0017 apply when the API starts.

### Added
- **Design system:** `DESIGN.md`, Tailwind v4 tokens, self-hosted fonts that the service worker precaches, UI
  primitives, an app shell (rail, tablet icon rail, phone tab bar), a context panel (docked, slide-over, bottom
  sheet), and empty, offline and loading states.
- **New screens:** show overview, Documents, command palette (⌘K: cues, pages, script text, actions), Calling mode
  with a next-cue strip and go-to keypad (keeps the screen awake), show settings and personal access tokens.
- **Show cards** show who is in the binder and the last change (`list_shows` gains `inNow` and `lastChange`;
  `GET /api/me/shows/presence` and `/last-changes`).
- **Print options:** page range, paper size with fit, include toggles (cue notes under the tag, standby and warn
  tags, annotations), a live preview, readable file names, and export options stored on the record (migration 0017).
- **Processing controls:** every failed upload has a code, a plain reason and a fix (migration 0016); uploads can
  be cancelled while processing (the whole tool process group is killed), retried or removed
  (`cancel_version_processing`, `retry_version`, `remove_version`); the web rows show size, Cancel, Try again,
  Remove and Details.
- **Keep available offline:** a switch that caches whole shows on the device, with states in words.
- **App icon:** the "Rings B" mark (chosen 2026-10-16) as the favicon, PWA and apple-touch icons, built by
  `apps/web/scripts/make-icons.mjs`.

### Changed
- Script export file names are validated and slugged from the show, document, version and layers (for example
  `cold-test-pirates-pirates-short-v1-LX.pdf`); names queued by older builds are sanitised before upload.
- "Upload revision" moved into the script's "…" menu (with Command palette, Go to page and Renumber); ⇧C now
  toggles Calling mode instead of placing a cue; ⌘P prints inside a document.
- The top-bar sync state says "Offline" (the count lives in the offline banner); activity sentences read in plain
  language ("uploaded 1 revision", "added 1 member").
- Text-anchored documents processed with OCR on auto now fail with `no_text` or `low_resolution` instead of loading
  without text; the failure message names the way through.
- `list_exports` and `export_marked_script` carry the new print options.

### Fixed
- A cancelled-then-quickly-retried upload could be marked ready with no pages and become unrecoverable.
- Signing out no longer throws in the top bar's sync status.
- The viewer shows a plain failure reason instead of raw tool output.
- Palette and "…" menu renumber open on a department the user can edit.

## 2026-10-15: cue margin markers (`cb1f93e`)

### Added
- Cuelist-style margin cue tags: a pill with the department code and a bold number (dashed for standby, heavier
  for warn), trigger words underlined, a leader line at the underline's height with a gutter jog for stacked tags,
  a per-department side (`settings.markerSides`). One layout (`layoutCueTags` in `packages/core`) draws both the
  screen and the print.

## 2026-10-15: M1 script markup (`c073981`, records in `d3cbaaf`)

### Added
- Departments as layers with scoped editor roles; cues with numbering, `place_cue_at_text`, text snapping and quote
  matching; annotations (notes, highlights, shapes, arrows, stamps) on department layers or a private personal layer.
- Row history, an activity feed and revert; personal undo and redo.
- Print export of a marked script, per-department cue sheets (PDF, XLSX, CSV), export records and the exports screen.
- Document revisions: automatic re-anchoring, a review list, version switching and compare.
- Live presence (who is on which page) over a WebSocket.
- MCP tools for all of the above, working guides served as `binder://guides/*`, and the sync write path
  (create-or-update, idempotent delete, chunked uploads).

## 2026-10-15: M0 foundation, live on Coolify

### Added
- pnpm monorepo (`packages/shared|db|core`, `apps/api|web`), Postgres with Drizzle migrations, Hono API with
  Better Auth sessions and personal access tokens, organisations, shows and memberships, and the change log.
- PowerSync sync service with the browser's local SQLite, the PWA shell, document upload and processing (searchable
  PDF through OCRmyPDF, word layers, thumbnails; pg-boss jobs), the virtualised PDF viewer, and search.
- The MCP server (`POST /mcp`, Streamable HTTP) with show, document, page and search tools.
- Production deployment on Coolify (`deploy/`), CI, and public-domain fixtures.
- The PWA manifest and install icons, so Binder installs on an iPad.
- Production hardening: browser security headers, sandboxed blobs, a 2 MB JSON body limit, same-origin checks on
  unsafe requests, and upload size limits that match Cloudflare's.

## 2026-10-14: design

- Platform design spec (`docs/superpowers/specs/2026-10-14-binder-platform-design.md`) and the M0 plan.
