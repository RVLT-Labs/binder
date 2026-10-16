# Exports and print

Marked-script PDFs, cue sheets, export records, reading the files, and the limits.
Derived from `apps/api/src/mcp/tools/exports.ts`, `apps/api/src/mcp/resources/exports.ts`, `apps/api/src/services/exports.ts`, `packages/shared/src/printOptions.ts`, `exportFiles.ts`, `packages/core/src/print/*`, `sheets/*`.

Read this when the user wants a print, a calling script, a department's cue sheet, or a file to send.

## Marked-script PDF

`export_marked_script {documentId, layers, versionId?, pages?, paper?, includeStandbyWarn?, includeAnnotations?, includeCueNotes?, filename?}` stamps the chosen layers' cues and annotations onto the version's searchable PDF (the invisible text layer survives, so the file still searches) and adds a footer to every page. Any member can export, viewers included, and archived shows allow it.

### Layers

| `layers` | Prints | Record |
|---|---|---|
| `"all"` | every department that is not hidden; no personal layer | public to the show |
| `"none"` | a clean copy (footer only) | public |
| `["LX"]`, `["LX", "SND"]` | those departments, by code, id or `department:<id>` key | public |
| `["LX", "personal"]` | plus your own personal layer | **private to you** (`privateTo` = your user id); nobody else sees the record or file |

A department in the list that is hidden still prints. Another member's personal layer cannot be named (`forbidden: an export can only include your own personal layer`). Order in the list does not matter; the footer names departments in department order.

### Options

| Option | Default | Notes |
|---|---|---|
| `versionId` | current version | Any `ready` version of the document; older versions print with the anchors that are on them (see `get_version_anchors`). |
| `pages` | `"all"` | 1-based, `"1-5, 8"`, `"3"`, hyphen, en dash or em dash, spaces allowed; merged and sorted; stored normalised (`1-5, 8`). A page past the end: `invalid: This script has 3 pages.` Bad syntax: `invalid: pages look like 1-43 or 3, 7-9`. The output contains only those pages. |
| `paper` | none (pages keep their size) | `A4` or `Letter`: every page not already within 3% of that paper is drawn centred and scaled to fit on a sheet of it (turned to match the page's orientation). |
| `includeStandbyWarn` | `true` | `false` prints only `go` cues. |
| `includeAnnotations` | `true` | `false` prints no notes, shapes, stamps or highlights. |
| `includeCueNotes` | `true` | `false` leaves the one-line note out from under each tag. |
| `filename` | slug | With or without `.pdf`. Rules: no `/ \ : * ? " < > |` or control characters, no leading or trailing dot or space, not a Windows reserved name (`con`, `prn`, `aux`, `nul`, `com1`…`lpt9`), at most 196 characters before `.pdf`. Error texts: `File names can't contain / \ : * ? " < > |`, `File names can't start or end with a dot or a space.`, `"con" is reserved by Windows. Pick another name.`, `Keep the name under 196 characters.` |

The default name is `<show slug>-<document slug>-v<versionNumber>-<layers>.pdf`, for example `pirates-of-penzance-skill-docs-pirates-libretto-v1-LX.pdf`, `…-v2-clean.pdf`, `…-v2-all-layers.pdf`, `…-v1-LX-SND.pdf`, `…-v2-LX-personal.pdf`.

### What prints

Cue tags in the margin (department side from `settings.markerSides`), the trigger words underlined with a leader from the tag, the note under the tag, then annotations, in the order the screen draws them ([placing-cues.md](placing-cues.md#how-a-cue-looks-on-the-page)). Only marks anchored on the printed version appear; a cue left on an older version is not on the page. Unplaced cues never print on the script (they are on the cue sheet).

The footer on every page, 7 pt grey at the bottom left: `<show> · <document> v<n> · <layers> · export <last 8 of the export id> · YYYY-MM-DD HH:MM` in the server's local time. The layer label is `Clean copy`, `All layers`, `All layers + personal`, `LX, SND`, `LX + personal` or `Personal`.

### Result

`{record, uri}` plus a `resource_link` content block (`uri`, `name` = filename, `mimeType: "application/pdf"`). Verified: `export_marked_script {layers: ["LX"], pages: "1-2"}` on the three-page fixture returned a 9,168-byte PDF starting `%PDF-1.7`.

```json
{"record":{"id":"01a146d7-8673-7a3b-9921-c2503abc8f67","kind":"pdf-script","filename":"pirates-of-penzance-skill-docs-pirates-libretto-v1-LX.pdf","privateTo":null,
  "layerSelection":[{"id":"01a146d3-e223-71ae-80f9-a876f368c5ec","kind":"department"}],"options":{"pages":"1-2","includeCueNotes":true,"includeAnnotations":true,"includeStandbyWarn":true}},
 "uri":"binder://shows/01a146d3-e21c-7a9e-9bd7-b2b7977b0fd6/exports/01a146d7-8673-7a3b-9921-c2503abc8f67"}
```

## Cue sheet (CSV, XLSX, PDF)

`export_cue_list {format, department + showId | departmentId}` makes one department's cue sheet from the same rows as the cue list screen. Any member; archived shows allowed.

- Columns: `Cue, Type, Label, Page, Document, Trigger, Notes, Status`.
- Order: placed cues by number, then unplaced cues (empty `Page`) last.
- `Cue` is the display number as text (`10.50` keeps its format). `Page` is 1-based (a number cell in XLSX). `Document` is filled only when the department has cues in more than one document. `Trigger` is the bound quote, empty for positional or unbound cues. `Status` lists flags: `duplicate`, `approximate`, `unresolved`, `on older version`.
- `csv`: UTF-8 with a byte order mark, CRLF lines, RFC 4180 quoting, a leading apostrophe on any cell that would start a formula. `xlsx`: one sheet named after the code, header row frozen. `pdf`: portrait on the show's `paperSize` (A4 default, or Letter), title, cue count, header repeated per page, footer with the export id and `Page n of m`.
- The record's `kind` is `csv`, `xlsx` or `pdf-sheet`; the file is `<show> - <CODE> cue sheet.<ext>`.

```
Cue,Type,Label,Page,Document,Trigger,Notes,Status
10,go,Preset: house to half,1,,A rocky sea-shore on the coast of Cornwall,,
12,go,Act II preset reference,1,,A ruined chapel by moonlight,,duplicate
14,go,Colliding eleven,2,,,,
12,warn,Unplaced spare,,,,,duplicate
```

## Export records and reading a file

Every server-side export writes a record and stores the file. `list_exports {showId}` lists them newest first (`id`, `kind`, `filename`, `layerSelection`, `privateTo`, `options`, `createdBy`, `createdAt`); records private to someone else are never listed.

Read a file with `resources/read` on `binder://shows/{showId}/exports/{exportId}` (the `uri` every export returns). The content is one item with `mimeType` and `blob` (base64). Decode the blob to get the bytes: a PDF starts `%PDF-`, an XLSX `PK`, a CSV with the byte order mark `EF BB BF`. A record that does not exist, belongs to another show, or is private to another member is a JSON-RPC error `Export not found`.

The web app's own exports (made in the browser so they work offline) upload their file over REST and appear in the same list; an agent cannot make those, only the two server-side kinds above. There is no `tmix` export tool yet; the `tmix` kind exists in the record schema for a later milestone.

## Offline and size limits

- Exports need the server: a version whose searchable PDF is not ready is `invalid: the version has no searchable PDF yet (status: queued)`. Nothing is generated offline through MCP.
- A stored export file is capped at 200 MB (the upload limit); a marked script is the source PDF plus a little vector ink, so it is about the size of the upload. A long OCRed scan can be large: prefer `pages` ranges when the user only needs an act.
- `layers` lists at most 200 entries; `pages` and `filename` at most 200 characters.
- Reading an export through the resource returns the whole file base64-encoded in one response: a 50 MB PDF is a 67 MB message. For large files, give the user the `uri` or the filename and let them download from the app's exports list instead of reading it yourself.
- Export records are never deleted through MCP.
