# Binder MCP server

Binder exposes its service layer to AI agents over the Model Context Protocol (spec section 3.10).
The endpoint is `POST /mcp` on the API, using the Streamable HTTP transport in stateless mode:
every request is served by a fresh server instance, so there are no sessions, and `GET` and
`DELETE` on `/mcp` answer `405`. Both the 2025 protocol (the `initialize` handshake) and the
2026-07-28 protocol (per-request envelope) are served.

## Authentication

Every request needs a personal access token as a bearer token:

```
Authorization: Bearer bnd_...
```

Create one on the settings page, or with the CLI:

```bash
set -a; . ./.env; set +a
pnpm --filter @binder/api exec tsx src/cli.ts create-token --email you@example.com --name "Claude Code" --scope '*'
```

`--scope '*'` reaches every show you belong to; `--scope <showId>,<showId>` limits the token to
those shows. A missing, unknown, revoked or expired token gets `401` with
`WWW-Authenticate: Bearer realm="binder"`. There is no OAuth in version one, so clients must be
configured with the header. Tokens cannot be created, listed or revoked through MCP, so an agent
cannot mint credentials.

The endpoint only answers requests whose `Host` (and `Origin`, when sent) is the host of
`APP_ORIGIN`, `localhost`, `127.0.0.1` or `[::1]`. That guards against DNS rebinding; serve the
API under the app's hostname (as the Caddy deploy does) or add the hostname in
`apps/api/src/mcp/server.ts`.

## Connecting

### Claude Code

```bash
claude mcp add --transport http binder https://<api-host>/mcp \
  --header "Authorization: Bearer bnd_..."
```

For a local API, use `http://localhost:3000/mcp`. Then ask, for example, "list my Binder shows
and read page 1 of the libretto". The agent skill in [`skills/binder/SKILL.md`](../skills/binder/SKILL.md) tells an agent how to use the tools well (placing cues, revisions, exports, history, safety).

### Claude Desktop (via mcp-remote)

Claude Desktop launches local stdio servers, so bridge to the HTTP endpoint with `mcp-remote`. In
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "binder": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://<api-host>/mcp",
        "--header",
        "Authorization:${BINDER_AUTH}"
      ],
      "env": { "BINDER_AUTH": "Bearer bnd_..." }
    }
  }
}
```

Keeping the token in `env` (with no space after `Authorization:` in the argument) avoids argument
quoting problems. For a local API on plain http, add `"--allow-http"` after the URL.

## Tools

| Tool | Annotations | What it does |
|---|---|---|
| `list_organisations` | read-only | Your organisations (paginated). |
| `create_organisation` | write | New organisation with you as owner. Unscoped tokens only. |
| `list_shows` | read-only | Shows this token reaches, active and archived, with your role (paginated). Each active show also carries `inNow` (the people who have it open right now: name, departments) and `lastChange` (the newest change: who, a one-line sentence, when; `null` for none), so an agent can avoid a bulk edit while a human is in the show. |
| `get_show` | read-only | One show with your role and its member count. |
| `create_show` | write | New show, in `organisationId` or your first organisation. Unscoped tokens only. |
| `update_show` | write, idempotent | Title, status, settings. Owners. |
| `add_show_member` | write | Add a user by email with a role and optional department scope (codes or ids). Owners. Needs `confirm: true`. |
| `update_show_member` | write, idempotent | Role and department scope (codes, ids or `*`). Owners. Granting or removing owner needs `confirm: true`. |
| `remove_show_member` | destructive | Remove a member. Owners. Needs `confirm: true`; the last owner stays. |
| `list_show_members` | read-only | Members with role and department scope; emails for owners only. |
| `list_departments` | read-only | A show's departments (layers): code, name, colour, number format, order, hidden. |
| `create_department` | write | Add a department. Owners. |
| `update_department` | write, idempotent | Rename, recolour, reorder, hide, change code or number format. Owners. Departments are never deleted. |
| `list_cues` | read-only | Cues sorted by department then number, with display number, duplicate flag and anchor. Filter by department, document, placed. Paginated. |
| `get_cue` | read-only | One cue. |
| `create_cue` | write | Create a cue on a department layer; the number is suggested from script neighbours when omitted; an anchor `{documentId, pageIndex, x, y}` places it. Editors in scope. |
| `update_cue` | write, idempotent | Number, label, type, notes, colour, department or anchor (null unplaces). |
| `delete_cues` | write, destructive | Delete cues, all or nothing. More than ten needs `confirm: true`. |
| `place_cue_at_text` | write | Anchor a cue where a quoted line occurs in the script. Ambiguous quotes return the matches; call again with `occurrence` or `nearPageIndex`. |
| `renumber_cues` | write | Renumber one department's cues in one document by script order: the first cue takes the block size (default 10), the rest the following integers, minors reset; overflow spills into flagged points. Unplaced cues and the 0 range are untouched. One revertable batch. Editors in scope. |
| `list_annotations` | read-only | A show's annotations (note, rect, ellipse, line, arrow, stamp, highlight): every department layer plus your own personal layer, never anyone else's. Filter by layer (`personal`, a department code or id, or a layer key) and document. Paginated. |
| `get_annotation` | read-only | One annotation; another user's personal annotation is `not_found`. |
| `create_annotation` | write | Draw on `personal` or a department layer you can edit. The anchor `{documentId, pageIndex, x, y}` (plus `text` for a highlight) is placed on the document's current version; geometry is in points, relative to the anchor. |
| `update_annotation` | write, idempotent | Layer (needs edit rights on both), type, anchor, geometry, text or style. |
| `delete_annotations` | write, destructive | Delete annotations, all or nothing. More than ten needs `confirm: true`. |
| `list_documents` | read-only | A show's documents with versions and processing status (paginated). |
| `get_document` | read-only | A document, its versions, and one version's page summaries. |
| `update_document` | write, idempotent | Title, kind, OCR mode, snapToText, sort order. Editors. |
| `upload_document` | write, open-world | Server downloads a PDF from a public http(s) URL as a new document or a new version. Editors. |
| `get_page` | read-only | A page as a JPEG (at most 1600 px on the long side) plus its word layer. |
| `search_script` | read-only | Phrase search over a version, with page, snippet and the first word's box. |
| `get_history` | read-only | A show's change log, newest first: who, when, via web, sync or mcp, and the before and after values. Filter by row, table, layer, user, kind (human or agent) and time window. Each entry's `seq` is what `revert_change` takes. Paginated with `before`. |
| `get_activity` | read-only | The same log as one line per batch (`<name> via <agent>`, "moved 3 TM cues and relabelled 1"), with the `batchId` and `userId` that `revert_batch` takes. Use `from` for "what changed since". |
| `revert_change` | write | Revert one change log row by writing its old values back as a new logged change (itself revertable). Needs edit rights on the row's layer. A column changed since is a conflict unless `force: true`. |
| `revert_batch` | write, destructive | Revert every change one user made in one batch, all or nothing, as one new logged batch. Needs `confirm: true` when it changes or deletes more than ten rows. |
| `list_exports` | read-only | A show's export records, newest first. Exports that include someone else's personal layer are never listed. Paginated. |
| `export_marked_script` | write | Print a document version with chosen layers (`"all"`, `"none"`, or department codes, `"personal"`, layer keys) to a PDF with a footer; returns the record and a `resource_link` to the file. Including your personal layer makes the export private to you. |
| `export_cue_list` | write | A department's cue sheet as `pdf` (A4 or Letter, per the show's paper size), `xlsx` or `csv`, in cue-number order with unplaced cues last. Name the department by `department` (code or id) with `showId`, or by `departmentId` alone; returns the record and a `resource_link` to the file. |
| `get_reanchor_review` | read-only | What a script revision left to review for a document: `pending` (approximate or unresolved anchors on the current version) and `olderVersions` (anchors still on another version), each with the anchor before re-anchoring. Never includes another member's personal annotations. |
| `resolve_reanchor_item` | write | Resolve one review item as an ordinary logged edit: `accept` (keep the anchor, mark it ok), `revert` (put back the previous anchor) or `reanchor` (match it again to the current version). Needs edit rights on the item's layer. |
| `get_version_anchors` | read-only | Every cue and annotation anchored to a document version, with the anchor it had there (the newest in its history that was on that version), to see where marks sat on an older version. |
| `compare_versions` | read-only | A line diff of two versions of one document in reading order (`same`, `added`, `removed`), with `limit` and `context` to keep it short. |

### Confirmation-gated tools

Hard-to-reverse calls return `CONFIRMATION_REQUIRED` with a plain-language summary, change nothing,
and need a second call with `confirm: true` once the person has agreed (spec 3.10). The tools:

| Tool | Needs `confirm: true` when |
|---|---|
| `add_show_member` | always (it gives someone access to the show) |
| `update_show_member` | it makes someone an owner or takes ownership away |
| `remove_show_member` | always |
| `delete_cues` | more than ten cues are deleted in one call |
| `delete_annotations` | more than ten annotations are deleted in one call |
| `revert_batch` | the batch would change or delete more than ten rows |

Non-owners get `forbidden` before any confirmation is asked for, so the gate never leaks who is a
member. Restoring a snapshot and deleting a document are also gated by the spec; those operations
arrive with M2 and are not tools yet.

`get_page` returns a text block (a header line and the page's text), an `image/jpeg` block, and
`structuredContent` with the page size in PDF points, `text`, `words` as compact
`[text, x, y, w, h]` tuples rounded to 0.1 pt (origin bottom left), and `lines` as lists of word
indices. A 200-word libretto page is about 9 KB of structured JSON (roughly 2,500 tokens) plus the
image; pass `includeImage: false` to skip the image or `maxPx` for a smaller one. The 1600 px
render is cached as `.../pages/{index}/image-1600.jpg`.

`upload_document` refuses non-http(s) URLs, URLs with credentials, and any host that resolves to a
private, loopback, link-local (including cloud metadata), CGNAT, multicast or reserved address,
checked at connect time and again after every redirect. Downloads are capped at 200 MB while
streaming and abort after 60 s. For a file on your own machine, upload it directly:

```bash
curl -F kind=libretto -F title=Script -F file=@script.pdf \
  -H "Authorization: Bearer $TOKEN" $API/api/shows/$SHOW/documents
```

## Resources

- `binder://shows/{showId}/versions/{versionId}/pages/{index}/words`: the word layer as JSON.
- `binder://shows/{showId}/versions/{versionId}/pages/{index}/image`: the page JPEG.
- `binder://shows/{showId}/exports/{exportId}`: an export's file (PDF, CSV or XLSX) as a blob. A private
  export of another member is `not_found`.
- `binder://guides/{slug}`: the working guides in `docs/guides/` (listed): `jayden-style`,
  `mic-and-dca-practice`, `tmix-format`.
- `binder://skill/{slug}`: the agent skill in `skills/binder/` (listed): `index` is `SKILL.md`, the rest are
  its `references/` files. Relative links between them are rewritten to `binder://skill/…`.

## Attribution

Every change made through MCP is logged with the token's user, `via = 'mcp'`, and as `agent` the
client's declared `name/version` (2026-07-28 clients send it on every request). Stateless
2025-era requests do not carry the client's identity, so the HTTP `User-Agent` stands in.

## The parity rule

Every exported service operation must be reachable through a tool or be listed in
`UI_ONLY_OPERATIONS` with a reason (`apps/api/src/mcp/registry.ts`);
`apps/api/test/mcpParity.test.ts` fails otherwise. Exempt in M0: token management (`createToken`,
`listTokens`, `revokeToken`), the change log helper (`logChange`), permission guards
(`getShowRole`, `requireShowRole`, `assertShowWritable`, `assertShowAcceptsUploads`) and auth
plumbing (`authenticateToken`, `tokenAllowsShow`). Exempt in M1: `createExportRecord`, because
client-generated exports upload their file over REST (agents export with `export_marked_script` and
`export_cue_list`, which create the record server side).

## Smoke tests

`deploy/scripts/m1-smoke.ts` runs the M1 tools against a live stack (see
[`deploy/README.md`](../deploy/README.md#the-m1-smoke-test)): it connects as the client `m1-smoke`
and walks cues, history and revert, exports and a revision. The older M0 smoke:

```bash
BINDER_TOKEN=bnd_... [BINDER_MCP_URL=http://localhost:3000/mcp] node apps/api/scripts/mcp-smoke.ts
```

It connects a real MCP SDK client over HTTP, lists tools and resources, lists shows, reads page 1
of the first ready document, and searches it.

## Verified clients

**MCP TypeScript SDK client 2.3.1 (2025 protocol), 2026-10-15.** `apps/api/scripts/mcp-smoke.ts`
against the API dev server on the dev compose stack, with a CLI-created user and token and the
public-domain Pirates of Penzance libretto fixture (147 pages, processed by the server's own
pg-boss workers):

```
tools (13): list_organisations, create_organisation, list_shows, get_show, create_show, update_show, add_show_member, list_documents, get_document, update_document, upload_document, get_page, search_script
resources: binder://guides/jayden-style, binder://guides/mic-and-dca-practice, binder://guides/tmix-format
shows: 1 active, 0 archived: MCP smoke show (owner)
document: "Pirates libretto" (libretto) in "MCP smoke show"
page 1: 595.28 x 841.89 pt, 197 words, image image/jpeg 1132 x 1600 px (127 KB), text block 1208 chars
page 1 starts: THE PIRATES OF PENZANCE / OR / THE SLAVE OF DUTY
search "PIRATES": 5 hit(s)
  page 1: THE PIRATES OF PENZANCE
  page 1: Chorus of Pirates, Police, and General Stanley's
  page 1: curtain rises groups of pirates are discovered - some
  page 5: Where pirates all are well-to-do;
  page 14: (During this chorus the PIRATES have entered stealthily, and
```

The same run confirmed `401` with `WWW-Authenticate: Bearer realm="binder"` without a token and
`405` for `GET /mcp`. The in-process tests (`apps/api/test/mcp.test.ts`) run every tool and
resource test under both the 2025 and the 2026-07-28 protocol.

Not yet verified by hand: Claude Code (`claude mcp add` above) and Claude Desktop through
`mcp-remote`.
