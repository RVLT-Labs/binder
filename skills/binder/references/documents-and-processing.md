# Documents and processing

Uploading documents and versions, what processing does, every failure code and its fix, and the cancel, retry and remove controls.
Derived from `apps/api/src/mcp/tools/documents.ts`, `apps/api/src/services/documents.ts`, `processingControls.ts`, `apps/api/src/processing/documentJob.ts`, `apps/api/src/upload/fetchPdf.ts`, `packages/shared/src/processing.ts`.

Read this when adding a script, when a version is not `ready`, or when a user asks why an upload failed.

## Documents and versions

- A **document** is a PDF with a `kind` (`libretto`, `score`, `blocking`, `other`), a title, and settings: `ocrMode` (`auto` or `never`), `snapToText`, `sortOrder`. Cues and annotations anchor to a document version.
- A **version** is one uploaded file. Versions number from 1 in upload order; `currentVersionId` on the document is the one people see and mark up. A new upload becomes current only after it is `ready` and its re-anchoring run has finished ([revisions-and-history.md](revisions-and-history.md)).
- Only editors and owners upload, and only to unarchived shows.

## Uploading

Two paths, same token:

**From a public URL** with `upload_document {showId, url, kind?, title?, ocrMode?, documentId?, label?}`. The server fetches the PDF itself. Rules: http or https only; no user:password in the URL; the host must not resolve to a private, loopback, link-local (cloud metadata included), CGNAT, multicast or reserved address, checked at connect time and after every redirect; at most 200 MB while streaming; 60 s timeout; the response must be `200`. `kind` is required for a new document (`title` defaults to the file name, `ocrMode` to `auto`); `documentId` adds a version instead (`label` defaults to the file name), and then `kind`, `title` and `ocrMode` are refused (`invalid: kind, title and ocrMode apply only to a new document; use update_document`).

**From the user's machine** over REST, because MCP carries no file bodies:

```bash
# new document: kind and title required, ocrMode optional (snapToText is not accepted here: use update_document)
curl -F kind=libretto -F title="Pirates libretto" -F ocrMode=auto -F file=@script.pdf \
  -H "Authorization: Bearer $BINDER_TOKEN" "$BINDER_API/api/shows/$SHOW/documents"
# new version of a document: label required
curl -F label="Rehearsal cut 2" -F file=@script.pdf \
  -H "Authorization: Bearer $BINDER_TOKEN" "$BINDER_API/api/shows/$SHOW/documents/$DOC/versions"
```

`$BINDER_TOKEN` is the token the user supplied for this session, set by them in the environment; never echo, log, paste or store it. If no token is available to you, give the user the command with `$BINDER_TOKEN` and `$BINDER_API` as placeholders to run themselves. A new version re-anchors every mark on the document and switches the current version once ready, ungated: say so first.

Both answer `201` with the document and/or version rows (`status: "queued"`). The file must start with `%PDF-` (else `400`), and is capped at 200 MB (`413`). A REST write with a bearer token is logged `via: "mcp"` with the HTTP `User-Agent` as the agent (`Skill Docs Agent via curl`).

Either way, keep the returned `version.id` and poll.

## Processing

After an upload the version goes `queued` → `processing` → `ready` or `failed`. The job:

1. Reads the PDF (page count and sizes). A damaged or password-protected file fails here.
2. With `ocrMode: "auto"`, runs OCR on pages without text (ocrmypdf, up to 30 minutes) and writes a searchable PDF; OCR trouble falls back to a plain copy rather than failing. With `never`, copies the file as is.
3. Extracts a word layer per page (`words` and `lines` in displayed page space) and renders page images on demand.
4. Checks there is text, but only for a **text-anchored** document (`snapToText` true, which is the default for `libretto` and `other`) with `ocrMode: "auto"`: fewer than 20 characters across the whole document fails as `no_text`, or `low_resolution` when the pages are scans under 150 dpi. If OCR was meant to run and did not (it failed or timed out) and there is no text, the failure is `timeout` or `unknown` instead, because a retry may succeed. Scores and blocking documents (`snapToText` false) and `ocrMode: "never"` skip the check: the version becomes `ready`, possibly with empty word layers.
5. Marks pages and the version `ready`; a new version then runs re-anchoring and becomes current.

Poll `get_document {documentId}` every few seconds. The three-page fixture processes in seconds; a 147-page OCRed libretto takes minutes. Each version summary carries `status`, `pageCount`, `error` (technical detail), `failureCode` and `failureMessage` (the plain-language reason to show the user).

```json
{"id":"01a146d7-7ed2-7ea5-b5f8-4d9457280b75","versionNumber":1,"status":"failed","pageCount":null,
 "error":"No text could be read from the document (found 6 text characters in 1 pages)","failureCode":"no_text",
 "failureMessage":"No text could be read from any page, so there is nothing to search or anchor cues to. Check it is the script, or upload a clearer scan. Or remove this upload, then upload the file again as a new document with Text recognition set to Never, and mark it up by position."}
```

## Failure codes

| `failureCode` | Title in the app | Retry helps? | What to do |
|---|---|---|---|
| `unreadable` | couldn't read file | no | Not a PDF Binder can open, possibly damaged. Export the script as a PDF again and upload that. |
| `password_protected` | password protected | no | Remove the password and upload again. |
| `no_text` | couldn't read text | only after a settings change | No text on any page (under 20 characters after OCR). Check it is the script, or upload a clearer scan. Or `update_document {snapToText: false}` or `{ocrMode: "never"}` and `retry_version` (below), then mark it up by position. |
| `low_resolution` | couldn't read text | only after a settings change | Scanned under 150 dpi (the message quotes the measured value: `Scanned at 96 dpi…`). Scan at 300 dpi and upload again, or the settings-change route above. |
| `timeout` | couldn't finish | yes | Processing took too long. `retry_version`; if it keeps happening, split the PDF or upload a smaller scan. |
| `cancelled` | cancelled | yes | Someone called `cancel_version_processing`. The file is kept: `retry_version` runs it again. |
| `enqueue_failed` | didn't start | yes | The job queue refused. `retry_version`. |
| `unknown` | couldn't process | yes | Something else; `retry_version`, and read `error` if it fails again. |

"Too large" (413) and "not a PDF" (400) are refused at upload and never become a version. Retrying with nothing changed fails the same way again (verified: `retry_version` on a `no_text` version re-queued it and it failed again with `no_text`).

**The no-re-upload way through `no_text` and `low_resolution`.** The job reads the document's settings when it runs, not when the file was uploaded, so changing them and retrying works (verified live, both variants came up `ready`):

- `update_document {documentId, snapToText: false}` then `retry_version {versionId}`: OCR still runs, the text requirement is dropped, and whatever text there is stays searchable (one `OFFSET` word in the test).
- `update_document {documentId, ocrMode: "never"}` then `retry_version {versionId}`: no OCR, empty word layers, mark up by position.

The app's own `failureMessage` names only the remove-and-re-upload path; both routes end the same way, and this one keeps the document id. `unreadable` and `password_protected` are not rescued by either.

## Controls

All three need editor or owner on an unarchived show and take `{versionId}`.

- `cancel_version_processing`: a `queued` or `processing` version becomes `failed` with `failureCode: "cancelled"`; the file stays. On a `ready` version: `conflict: This upload has already finished`; on one that failed for another reason: `conflict: This upload is not processing`. Cancelling twice returns the version unchanged.
- `retry_version`: a `failed` version goes back to `queued` from the stored file and is processed again. Only the document's newest version can be retried (`conflict: A newer version exists; upload again or remove this one`); a ready version is `conflict: This upload has already finished`; a lost file is `conflict: The uploaded file is no longer stored; upload it again`.
- `remove_version`: permanently deletes a `failed` version, its pages and files (ungated when the document keeps other versions: ask first). When it is the document's only version the document goes too, and the call is **confirm-gated**: `CONFIRMATION_REQUIRED` with `This is the only version of "Textless page", so removing it deletes the whole document and its stored file permanently.` until `confirm: true`. When a removed version was current and others remain, the highest `ready` sibling becomes current. A `ready` version cannot be removed (`conflict: Only a failed upload can be removed`); a running one must be cancelled first (`conflict: This upload is still being processed; cancel it first`); a version with cues or annotations anchored to it is refused. Returns `{removed: {versionId, documentId, documentRemoved}}`. **This cannot be reverted.**

Every control is logged (`cancelled 1 upload`, `retried 1 upload`, `removed 1 upload` in the activity feed) but none is revertable.

## Document settings

`update_document {documentId, title?, kind?, ocrMode?, snapToText?, sortOrder?}` (editors and owners). `ocrMode` and `snapToText` are read by the processing job each time it runs: they apply to future uploads and to a `retry_version` of a failed one, not to a version that is already `ready` (to reprocess a ready version, upload it again as a new version). `snapToText` does two things: it switches the web app's drag snapping, and (with `ocrMode: "auto"`) it decides whether processing requires readable text at all. `null` restores the kind default (on for `libretto` and `other`).

## Not possible through MCP

- Deleting a document or a `ready` version. Only failed versions can be removed.
- Replacing the current version by hand: the newest ready version becomes current through re-anchoring, and only a batch revert of that run moves it back.
- Uploading file bytes through a tool: use the REST upload above.
