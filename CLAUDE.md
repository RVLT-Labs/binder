# Binder (by RVLT): notes for Claude sessions

Binder is an offline-first PWA and API for marking up musical-theatre scripts: scripts and scores as PDFs
with a word layer, cues per department anchored to lines, annotations, history with revert, revisions with
re-anchoring, print and cue-sheet exports, live presence, and an MCP server for agents. It is live at
https://binder.rvlt.app (sync at https://binder-sync.rvlt.app). Owner: Jayden Nawotka, a theatre sound
designer; this is a personal tool first, product later.

Read this file, then the doc that matches your task (map at the bottom). Do not re-derive decisions that
are already recorded; follow them or say why you are overriding one.

## Layout

```
apps/api      Hono API, services (the business rules), MCP server, pg-boss processing (OCR/render), sync write path
apps/web      React 19 + TanStack Router/Query PWA, PowerSync (local SQLite), Tailwind v4, vite-plugin-pwa
packages/core     pure, browser-runnable logic: anchors, re-anchoring, cue numbering, cue tags, print stamping, history grammar
packages/db       Drizzle schema + migrations (packages/db/drizzle), createDb/runMigrations
packages/shared   zod schemas and constants shared by api and web (print options, processing codes, presence...)
fixtures/         a workspace package: public-domain test PDFs (Gilbert and Sullivan) and generators; real shows are never committed
skills/binder     the agent skill for using Binder over MCP (also served by the API as binder://skill/index)
deploy/           Dockerfiles, compose files (prod, dev, local), Caddyfile, PowerSync config, smoke scripts, deploy README
docs/             specs, plans, decision records, MCP doc, working guides, UI mockup sources
DESIGN.md         the design system and its decisions log
```

## Commands

Node 24 (`.nvmrc`), pnpm 12.11.2. If `pnpm` is not on PATH on macOS: `export PATH="$HOME/Library/pnpm:$PATH"`.

```bash
pnpm install
pnpm lint                      # biome; read the REAL exit code, never pipe it into tail
pnpm typecheck                 # every package
pnpm test                      # everything (vitest projects); needs Docker, see below
pnpm exec vitest run apps/api/test/revert.test.ts      # one API/db test file: run from the REPO ROOT
cd apps/web && pnpm test                                # web unit tests
pnpm --filter @binder/web build                         # typecheck + production build (also precaches fonts and the SW)
pnpm --filter @binder/db generate                       # new migration after a schema change
```

- The API's processing tests and local uploads run the real PDF tools: install `poppler-utils`, `ocrmypdf`, `qpdf`,
  `tesseract-ocr` (with English data) and `ghostscript` on the host. Without them those tests skip locally and
  fail in CI.
- **API and db tests only work from the repo root.** The root `test/global-setup.ts` starts one Postgres
  container through testcontainers (Docker must be running) and hands each test file a fresh database.
  Run from a package folder they fail with "No test database". Under heavy load some API tests hit their
  5 s timeout: rerun that file alone before treating it as a failure.
- **e2e** (`apps/web/e2e`, Playwright) needs the dev stack and starts the API (:3000) and web (:5173)
  itself; the offline suite runs against `vite preview` of a production build (:4173).
  ```bash
  docker compose -f deploy/docker-compose.dev.yml up -d     # Postgres (logical replication) + PowerSync
  # keep the compose project name `binder-dev` (the file sets it): reconnect.spec.ts stops and starts
  # the containers binder-dev-postgres-1 and binder-dev-powersync-1 by name
  pnpm e2e                    # whole suite;  pnpm e2e responsive calling   # only those specs
  pnpm e2e:offline            # the offline/service-worker suite
  pnpm e2e:all                # both (spec filters reach only the offline half)
  ```
  `pnpm e2e*` runs `scripts/e2e-locked.sh`: a machine-wide lock plus a port clean-up, because Playwright
  silently REUSES whatever is already listening on those ports, and two sessions or worktrees running e2e
  at once test each other's code. It kills anything listening on :3000, :5173 and :4173. **Never run
  `playwright test` or `pnpm e2e` inside `apps/web` directly.** A cold-start failure (a lazy route compiling
  on first load) deserves one rerun of that spec before it is treated as real.
- Local API without e2e: `set -a; . ./.env.example; set +a; pnpm --filter @binder/api dev` (dev values; the
  dev compose stack needs no env file). Users and tokens: `pnpm --filter @binder/api exec tsx
  src/cli.ts create-user|create-token ...` (usage in `apps/api/src/cli.ts`; a password comes from stdin or
  `BINDER_PASSWORD`, never from argv).
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, test and builds every production image on each push and
  PR; on pushes to `main` (and manual dispatch) it also starts the dev compose stack and runs both e2e suites.

## Rules that bite

**Architecture**
- Business rules live in `apps/api/src/services` as `operation(db, actor, input)`. The web app, the sync
  write path and the MCP server are three clients of the same functions. Do not put a rule in a route,
  a tool or a component.
- **A capability is not done until it is in MCP.** Register it in `apps/api/src/mcp/registry.ts`
  (`OPERATION_TO_TOOL`, or `UI_ONLY_OPERATIONS` with a reason); `apps/api/test/mcpParity.test.ts` enforces it.
  Then document the tool in `skills/binder/references/tools.md`; `apps/api/test/skillDocs.test.ts` fails if a
  tool or confirm gate is missing or wrong. Changing a tool's behaviour means updating the skill docs too.
  `docs/guides/` is served as `binder://guides/*` and `apps/api/test/mcp.test.ts` pins exactly three guides.
- **Offline-first.** The web app reads from local SQLite (PowerSync) and writes locally; the connector
  uploads through `/api/sync`, where `apps/api/src/sync/policy.ts` decides what is accepted. A table or column
  the client writes needs: a policy entry, the client schema (`apps/web/src/powersync/schema.ts`) and, for
  reads, the stream in `deploy/powersync/sync-config.yaml`. Anything new must work offline or be disabled with
  a visible reason. PDFs and page data are cached in the `blobs-v1` Cache; the service worker only updates when
  the user taps Reload.
- `apps/web/src/routeTree.gen.ts` is generated by the TanStack Router Vite plugin (when the dev server or
  `pnpm --filter @binder/web build` runs) and committed. After adding, renaming or moving a route file,
  regenerate it and commit the result.
- **Local tools are newer than production's.** The API image runs on Debian 12 (OCRmyPDF 14.0, poppler 22.12,
  qpdf 11.3, ghostscript 10.00); CI's Ubuntu has 15.2 / 24.02 / 11.9; a Homebrew Mac has OCRmyPDF 17. Behaviour
  that passes locally can fail in production (owner-restricted PDFs and rotated-page text did, and were the reason CI
  was red). When you touch `apps/api/src/processing`, run its tests in a bookworm container as well
  (`docker run --init`, the apt list from `deploy/Dockerfile.api`; without `--init` killed processes are not reaped
  and the cancel tests fail), and treat a red `check` job in CI as a real signal.
- `packages/core` stays pure and browser-runnable (no Node APIs): print stamping and layout must work offline.
- **Migrations** are forward-only SQL in `packages/db/drizzle` (generate, then commit the SQL, snapshot and
  journal). They apply when the API starts, so they must be safe on production data. The journal skips
  idx 15 on purpose (see `packages/db/README.md`); do not renumber.
- Every write is logged with who and through what (`via`); history, activity and revert read that log. Cue
  numbers are text (`"14.5"`), collisions are flagged `duplicate`, never refused.
- Roles are viewer, editor (department-scoped) and owner. Archived shows are read-only for everyone.

**UI**
- `DESIGN.md` is the design system. Since ruling R20 the **mockups are the binding visual standard**
  (`docs/superpowers/design/binder-ui-2026-10`, regenerate with `python3 _build.py`; render PNGs with
  `node _shot.mjs <abs index.html> <outdir>`). Match component shapes, red placement, copy and spacing to them;
  record any deliberate difference in the decisions log at the bottom of DESIGN.md.
- Colours, type and spacing come from `apps/web/src/styles/tokens.css` (Tailwind v4 theme); no literal hex in
  components. The script page is always paper and the brightest thing on screen; department colour is the only
  colour on the page; red is never a department colour.
- Breakpoints: phone under 768, tablet 768 to 1024, desktop over 1024 (`useBreakpoint`). Touch targets are at
  least 44 px (use `pointer-coarse`), text at least 11 px, state is always a word as well as a colour. Reuse
  `apps/web/src/components/ui` primitives before adding one. `apps/web/e2e/responsive.spec.ts` checks no
  sideways scroll at 390 px and 44 px targets on every screen.
- Keep accessible names and labels that e2e specs rely on; if copy changes to match a mockup, change the spec
  in the same commit.
- When visual work lands, send Jayden screenshots (phone, tablet, desktop). Never show a real token in one.

**Security**
- **Never create, ask for, print, store or use Jayden's production token or credentials.** The production
  smoke (`deploy/scripts/prod-smoke.sh`) and any signed-in check on binder.rvlt.app is his to run, or he signs
  in himself. Test against a local API with throwaway users. Tokens cannot be minted through MCP.
- Personal layers are private to their owner; exports that include one are private too.

## Git and process

- Conventional commits (`feat(web): ...`, `fix(api): ...`). Commit only when asked or when the task says so.
  Signing goes through Jayden's 1Password SSH agent, which sessions cannot reach: commit with
  `git -c commit.gpgsign=false commit` and keep the `Co-Authored-By` trailer for the model that wrote it.
- Parallel work uses git worktrees under `.worktrees/` or `.claude/worktrees/` (both ignored by git and by
  biome; run `pnpm install` in a new one). Merge a lane only at a quiet point, and rerun lint, typecheck and
  tests on the merged result.
- `.superpowers/` is git-ignored scratch (ledgers, briefs, reports). Anything a future session needs must be
  copied into `docs/superpowers/records/`. Do not leave decisions only there.
- Run `pnpm lint`, `pnpm typecheck` and the tests for what you touched before saying something is done.
  Add notable changes to `CHANGELOG.md` under Unreleased.

## Deploy

Production is Docker Compose on Coolify (`deploy/docker-compose.yml`, built from `main` of
`RVLT-Labs/binder`; app uuid `pyt2nmc5bof9xyxwqhhsml37`). Push to `main`, then deploy from Coolify (or the
Coolify MCP `deploy` tool; its wait times out, so poll `deployment list_for_app` and
`https://binder.rvlt.app/api/health`). Migrations apply when the API container starts. Before a risky deploy,
build the API and web images from a clean clone (`docker build -f deploy/Dockerfile.api .`). Full runbook,
secrets and backups: `deploy/README.md`. The commit currently in production is named in the
latest dated entry of `CHANGELOG.md`.

## Where things are

| You need | Read |
|---|---|
| What was decided and why | `docs/superpowers/records/` (M0, M1, UI restyle rulings), the decisions log in `DESIGN.md` |
| Product spec and milestones | `docs/superpowers/specs/2026-10-14-binder-platform-design.md` (+ one spec per feature) |
| How a milestone was planned | `docs/superpowers/plans/` |
| What changed and what is open | `CHANGELOG.md` (Unreleased and Known issues) |
| The MCP server, tokens, connecting a client | `docs/mcp.md`, then `skills/binder/SKILL.md` |
| TheatreMix files and house cue style | `docs/guides/` |
| Deploying, backups, smoke tests | `deploy/README.md` |
| The doc index | `docs/README.md` |

Known open items (a flaky e2e, small UI follow-ups, deferred review minors) are listed in the UI restyle
rulings record, under "Known issues and open follow-ups".
