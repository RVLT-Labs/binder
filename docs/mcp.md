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
and read page 1 of the libretto".

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
| `list_shows` | read-only | Shows this token reaches, active and archived, with your role (paginated). |
| `get_show` | read-only | One show with your role and its member count. |
| `create_show` | write | New show, in `organisationId` or your first organisation. Unscoped tokens only. |
| `update_show` | write, idempotent | Title, status, settings. Owners. |
| `add_show_member` | write | Add a user by email with a role. Owners. |
| `list_documents` | read-only | A show's documents with versions and processing status (paginated). |
| `get_document` | read-only | A document, its versions, and one version's page summaries. |
| `update_document` | write, idempotent | Title, kind, OCR mode, snapToText, sort order. Editors. |
| `upload_document` | write, open-world | Server downloads a PDF from a public http(s) URL as a new document or a new version. Editors. |
| `get_page` | read-only | A page as a JPEG (at most 1600 px on the long side) plus its word layer. |
| `search_script` | read-only | Phrase search over a version, with page, snippet and the first word's box. |

No tool is marked destructive: M0 has no delete operations.

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
- `binder://guides/{slug}`: the working guides in `docs/guides/` (listed): `jayden-style`,
  `mic-and-dca-practice`, `tmix-format`.

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
plumbing (`authenticateToken`, `tokenAllowsShow`).

## Smoke test

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
