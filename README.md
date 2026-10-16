# Binder

Binder (by RVLT) is an offline-first web app and API for marking up musical-theatre scripts: the stage
manager's binder, digital. It is live at https://binder.rvlt.app and installs as a PWA on an iPad or phone.

- **Script and score PDFs** with a searchable word layer per page (scans are OCRed), versions, and automatic
  re-anchoring of marks when a new draft arrives.
- **Cues per department**, numbered and anchored to lines of the script, with go, standby and warn types, shown as
  margin tags on the page and printed the same way. **Annotations** on department layers or a private layer.
- **Calling mode** (a next-cue strip and go-to keypad), a **command palette** (⌘K), cue lists, activity, history
  with revert, and **exports** (marked-script PDF with options, per-department cue sheets as PDF, XLSX, CSV).
- **Works offline** in the venue: the book is cached on the device and edits sync when the network returns.
- **Real-time and multi-user**: roles (viewer, department-scoped editor, owner), live presence, many shows per user.
- **AI-first**: everything the web app can do is also an MCP tool, with an agent skill that teaches an agent how
  to use them.

## Quick start

Needs Node 24 (`.nvmrc`), pnpm 12.11.2 and Docker.

```bash
pnpm install
docker compose -f deploy/docker-compose.dev.yml up -d          # Postgres + PowerSync (dev defaults)
set -a; . ./.env.example; set +a
printf '%s' 'choose-a-password' | pnpm --filter @binder/api exec tsx src/cli.ts create-user \
  --email you@example.test --name You --password-stdin
pnpm --filter @binder/api dev                                   # API on :3000
pnpm --filter @binder/web dev                                   # web on http://localhost:5173
```

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (needs Docker), and `pnpm e2e` for the browser tests. Details,
gotchas and the rules for working in this repo are in [`CLAUDE.md`](CLAUDE.md).

## Repository map

| Path | What |
|---|---|
| `apps/api` | Hono API, services, MCP server, OCR and render jobs, sync write path |
| `apps/web` | The PWA (React, TanStack Router, PowerSync, Tailwind) |
| `packages/core` | Pure logic that also runs in the browser: anchors, numbering, cue tags, print stamping |
| `packages/db`, `packages/shared` | Schema and migrations; schemas and constants shared by api and web |
| `skills/binder` | The agent skill for using Binder over MCP |
| `deploy` | Dockerfiles, compose files, Coolify runbook, smoke scripts |
| `docs` | Specs, plans, decision records, the MCP doc; see [`docs/README.md`](docs/README.md) |
| `DESIGN.md` | The design system and its decisions log |

## Documentation

- [`CLAUDE.md`](CLAUDE.md): how to work in the repo (commands, rules that bite, deploy).
- [`CHANGELOG.md`](CHANGELOG.md): what shipped, and what is still open.
- [`docs/README.md`](docs/README.md): the index of specs, plans and records.
- [`DESIGN.md`](DESIGN.md): the design system; the mockups it is built to are in
  `docs/superpowers/design/binder-ui-2026-10`.

## Agents

An agent connects to `POST /mcp` with a personal access token (create one in the app's settings; see
[`docs/mcp.md`](docs/mcp.md)). The server then points it at the skill in
[`skills/binder/SKILL.md`](skills/binder/SKILL.md), which is also served as the `binder://skill/index` resource.

## Deploying

Production is Docker Compose on Coolify, built from `main`. See [`deploy/README.md`](deploy/README.md) for secrets,
the first user, backups and the smoke tests.
