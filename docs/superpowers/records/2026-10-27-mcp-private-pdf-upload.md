# MCP upload of a local (private) PDF

Date: 2026-10-27. Base: `origin/main` at `e34de82480dcf11bdfbd70805728f3835ca35995`
(branch `pandacode/fix/mcp-private-pdf-upload-on-main`).

## Problem

`upload_document` only takes a public http(s) URL. An agent holding a private script on its own
machine, with a working MCP connection but no browser session and no separate REST token, has no
supported way to add it: hosting the script publicly, extracting the MCP token for `curl`, letting the
server read its own filesystem, or loosening the SSRF guard are all refused.

## Why not base64 in a tool call

The MCP endpoint takes JSON bodies of at most 2 MiB (the API and Caddy both enforce it), so one call
carries at most about 1.4 MiB of PDF after base64. A script is 5 to 50 MB, which would mean dozens of
calls. Worse, a model has to produce every argument byte as output tokens: about 1.4 million characters
per call is not something an agent can emit. Chunked base64 would satisfy the body limit but not the
agent. Bytes therefore travel outside the JSON-RPC channel, while authority, intent and the audit
trail stay inside MCP.

## Design: a negotiated upload in three steps

1. **`begin_document_upload`** (MCP, editor or owner, token show scope, open show). The agent states
   the intent explicitly with `mode`:
   - `new_document`: `kind` and `title` are required, `ocrMode` is optional. Never touches an
     existing document.
   - `new_version`: `documentId` and `label` are required, plus `confirm: true`. Without it the
     answer is `CONFIRMATION_REQUIRED`: once ready, the version re-anchors every mark on the
     document and becomes current. Nothing re-anchors silently.

   It also declares `sizeBytes` (1 B to 200 MB) and `sha256` (hex). The server records a
   `document_uploads` row and answers with an upload id, a `PUT` URL on the API origin, a one-time
   upload secret and a ready-made `curl -T` command. The upload expires 30 minutes after it begins.
2. **`PUT /api/uploads/{uploadId}`** with `Authorization: Bearer bndu_…` and the raw PDF as the body
   (`application/pdf` or `application/octet-stream`). The endpoint streams the body into a staging
   blob (`shows/{show}/uploads/{id}/staged.pdf`) through the same byte limit and `%PDF-` check as
   every other upload, hashing as it goes. It refuses with 400 when the byte count or the SHA-256
   differs from what was declared, and deletes the partial blob. The body never touches the JSON
   limit, a log, or memory beyond stream back-pressure. This step writes no document rows.
3. **`complete_document_upload`** (MCP, the same user, live token). Re-checks role, scope and the
   archived state, then hands the staged file to the existing `createDocument` or
   `addDocumentVersion`, so storage, the change log (`via: mcp`, the client's name as agent) and the
   processing queue are exactly those of every other upload. It then deletes the staging blob.
   `cancel_document_upload` discards an upload that has not completed.

### Why the upload secret is safe to hand to an agent

It is not a credential. It cannot read anything, cannot create rows, and only stages bytes for one
upload. Those bytes must match the SHA-256 declared over MCP, so anyone who sees the secret can only
send the file the agent already committed to. It expires with the upload (30 minutes), is accepted
at most 5 times (failed attempts included), and is stored only as a SHA-256 hash. It travels in the
`Authorization` header, never the URL, so access logs and Referer never carry it. Personal access
tokens still cannot be minted through MCP.

### State, retries and idempotency

`document_uploads.status` is `pending → receiving → received → completing → completed`.
- A PUT claims `pending → receiving`. A second, concurrent PUT gets 409. A failed PUT (wrong size,
  wrong hash, not a PDF, dropped connection) returns to `pending` and may be retried until it expires
  or reaches the attempt cap. A PUT after `received` gets 409 with the message "already received;
  call complete_document_upload".
- `complete_document_upload` claims `received → completing`. Calling it again after success returns
  the same document and version (no second copy). If it fails (for example the show was archived in
  the meantime), it returns to `received`.
- Another user's upload id, or an unknown one, is `not_found`, as is an expired one.

- A completion records its result as soon as the document service returns. Its writes carry the
  upload id as their change-log batch, so if the process dies (or recording fails) after the commit,
  the next `complete_document_upload` finds the version insert in that batch and returns it instead
  of storing the file a second time.
- Staged bytes (`shows/{show}/uploads/…`) are never served by `GET /blobs/*`, to any member,
  the uploader included: they are unchecked until the upload completes.
- If the blob store fails before draining the body, the PUT fails at once (500) and the upload goes
  back to `pending`; it does not wait on back-pressure.

### Limits and clean-up

- 30 minutes from begin to the start of the PUT; a running PUT holds its claim for up to 2 hours;
  then 30 minutes, counted from when the bytes are in, to complete.
- 200 MB per file, the same as the REST upload and the URL upload.
- At most 5 unfinished uploads per user at once (`conflict` beyond that: complete or cancel one).
- Expired rows and their staging blobs are swept when an upload begins and every 5 minutes by the
  API process (the same timer pattern as the re-anchor sweep). A completed row is kept for 24 hours,
  so a retried complete still finds its result, and then swept.
- A row lost to the sweep during a slow PUT makes that PUT fail and remove its own staged blob.

### Unchanged

`upload_document` (URL, the SSRF guard included) and the REST multipart routes behave exactly as
before. `document_uploads` is not in the PowerSync publication (`0003_publication.sql` names its
tables explicitly), so neither the hash nor the secret hash ever reaches a client.

## Deployment requirements

- A forward-only migration that creates `document_uploads`. It is additive, so it is safe on
  production data and applies when the API starts.
- Caddy needs no change: `/api/*` has no body cap at the proxy. The API exempts only
  `PUT /api/uploads/{id}` from its 2 MB JSON limit, and that route enforces the declared size itself.
- The URL handed to agents is built from `APP_ORIGIN`, which must be the public origin
  (`https://binder.rvlt.app` in production).
- Traffic reaches production through Cloudflare, whose Free and Pro plans cap a request body at
  100 MB. Above that the PUT fails at the edge, as the REST multipart upload already does, whatever
  the API's 200 MB limit says. Check the plan before relying on files over 100 MB.

## Known limits

- `DiskBlobStore` writes through a `.tmp` file. A crash in the middle of a PUT can leave one behind
  (up to 200 MB) that no sweep removes. Every upload path shares this; it is not new.
- Removing a show cascades to its upload rows but not to staged blobs. No route removes shows today.

## Review

An independent review (2026-10-27) proved two defects and found three smaller ones, all fixed with
tests in `apps/api/test/mcpUpload.test.ts` ("hardening"):
- staged bytes were readable through `/blobs` by any member;
- a store failing before reading the body hung the PUT;
- expiry was counted from the start of the PUT;
- an oversize message rounded to "0 MB";
- a completion lost after commit could be repeated.

The final review then proved one more defect (F1), also fixed with a test for both modes. The
document service can throw after its commit, when queueing fails and so does marking the version
failed. The completion then went back to `received`, and a retry stored the file a second time.
Now it goes back only when the change log shows nothing was committed under the upload's batch. A
committed completion is recorded instead, and an unknown one stays `completing`.

A client dropping mid-PUT, concurrent completes, and a cancel or sweep during a PUT were already
correct and are now covered by tests too.
