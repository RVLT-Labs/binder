# Binder UI Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every screen of `apps/web` to Binder's design system (RVLT Flow tokens and registry components, the "Prompt corner" direction) at phone, tablet and desktop widths, adding the show overview, documents route, command palette and Calling mode the approved mockups draw.

**Architecture:** Tailwind v4 utilities and Flow's token file replace the single plain `styles.css`; Flow's shadcn-style primitives are copied into `src/components/ui`. A responsive `AppShell` (rail / icon rail / tab bar) and a `ContextPanel` (docked / slide-over sheet / bottom drawer) carry every screen. Screens are restyled one at a time behind the same routes, keeping accessible names and the test-hook classes and data attributes, so the existing unit and e2e suites stay the safety net.

**Tech Stack:** React 19, TanStack Router/Query, PowerSync, Vite 8, vite-plugin-pwa, Tailwind CSS v4, Radix primitives (via the RVLT registry files), vaul, cmdk, lucide-react, @fontsource, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-ui-restyle.md` (how) and `DESIGN.md` (what). Mockups: `docs/superpowers/design/binder-ui-2026-10/index.html`; render PNGs of any screen with `node docs/superpowers/design/binder-ui-2026-10/_shot.mjs <abs index.html> <outdir>` (ids: home, show, markup, calling, cues, activity, review, login, newshow, settings, tokens, docs, compare, exports, print, palette, goto, states, phone-calling, phone-home, m-login, m-show, m-markup, m-cues, m-activity, m-docs, m-more, m-settings, t-markup).

## Global Constraints

- Work on branch `ui-design-system`. Commit with `git -c commit.gpgsign=false commit`; end every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `export PATH=$HOME/Library/pnpm:$PATH` before pnpm. Gates per task: `pnpm -r typecheck`, `pnpm lint` (biome, repo-wide, must exit 0), `pnpm --filter @binder/web test`, and the e2e specs named in the task (`cd apps/web && pnpm e2e -- <spec>`).
- Do not change an accessible name, role, label text, heading text or landmark label unless the task says so; if a test pins markup that moves on purpose, change the test in the same commit and say why in the commit body.
- Keep every test-hook class and `data-*` attribute listed in spec §3.2 on the same element, even when it no longer carries styles.
- `.page-sheet` gets no border, padding or transform. `FIT_ALLOWANCE`, `GAP`, `SLOT_PADDING_TOP`, `THUMB_WIDTH` always equal the CSS they describe.
- No runtime network dependency: fonts, icons and CSS are bundled and precached.
- Colours only through tokens (`bg-paper`, `text-ink`, `var(--page-ink)` …). The only literal hex values allowed in TSX are department/person colours that come from data.
- Red (`--red`) only for: the one primary action per view, live/active state, selection on the page, alerts. Never a department colour, never decoration.
- Copy: sentence case, 11 px minimum, numbers/times/keys/file names in Geist Mono tabular (`font-mono tabular-nums`), Kalam only where DESIGN §11 allows.
- Phone (< 768 px): every interactive element ≥ 44 × 44 px, no hover-only control, no horizontal page scroll at 390 px.
- Breakpoints: Tailwind `md` = 768 px (tablet starts), `lg` = 1024 px (desktop starts above it: use `lg:` for desktop-only rules and treat exactly 1024 as tablet via `min-[1025px]` where it matters).

## Review Focus

1. **Long real content at 390 px** — a 40-character show title, a 60-character cue label, a long export file name: nothing overflows the viewport or overlaps a control. Pinned by `apps/web/e2e/responsive.spec.ts` (Task 15) and the per-screen phone checks in Tasks 5–12.
2. **Viewer fit and scroll after the layout change** — "Fit width" makes the page exactly fill the stage width minus the allowance, and `?cue=` scrolls the cue's page into view with the tag visible. Pinned in Task 7 (`viewer.spec.ts` fit assertion, `markup.spec.ts` focus-cue assertion).
3. **Shortcuts inside new overlays** — typing `c`, `g`, `]` or a digit in the palette input, the keypad, or a drawer field must not place cues or switch layers; Escape closes the top overlay first. Pinned in Tasks 13 and 14 (unit tests on the key gate) and Task 8 (drawer).
4. **Cold offline start** — after "Make available offline" and a reload with the network off, fonts render (no fallback face) and the shell lays out. Pinned in Task 1 (precache manifest contains `.woff2`) and Task 15 (offline e2e asserts `document.fonts.check('800 16px Archivo')`).
5. **Focus return** — closing the bottom drawer, the slide-over sheet, the palette or the keypad returns focus to the control that opened it (usually the selected tag), and `SelectionAnnouncer` still announces selection changes. Pinned in Tasks 8, 13, 14.

---

### Task 1: Foundation — Tailwind, tokens, fonts, alias, theme colours

**Files:**
- Modify: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/manifest.ts`, `apps/web/src/manifest.test.ts`
- Create: `apps/web/src/styles/tokens.css`, `apps/web/src/styles/base.css`, `apps/web/src/lib/utils.ts`, `apps/web/src/styles/tokens.test.ts`

**Interfaces:**
- Produces: Tailwind utilities for every token (`bg-paper`, `bg-paper-2`, `bg-card`, `bg-elev`, `text-ink`, `text-ink-2`, `text-muted`, `text-faint`, `border-line`, `border-line-2`, `bg-red`, `text-red`, `bg-red-soft`, `text-ok`, `bg-ok-soft`, `text-warn`, `bg-warn-soft`, module hues and their `-soft`, `bg-page`, `text-page-ink`), font utilities `font-disp`, `font-sans`, `font-mono`, `font-hand`, shadows `shadow-card`, `shadow-hover`, `shadow-stk`; `cn(...inputs)` and `focusRing` / `disabledState` class strings in `src/lib/utils.ts` (copy Flow's `src/lib/utils.ts`); the `@/` import alias → `apps/web/src`.

- [ ] **Step 1: Write the failing tests.** In `src/styles/tokens.test.ts`: read `tokens.css` and assert it defines `--paper: #141210`, `--card: #211C17`, `--ink: #F5EFE2`, `--red: #E0363D`, `--page: #FFFFFF`, `--page-ink: #1A1715`, and that the `@theme inline` block maps `--color-paper`, `--color-page`, `--color-page-ink`, `--font-mono`. In `manifest.test.ts`, change "theme and background colours come from styles.css" to read `tokens.css` and expect `webManifest.background_color` and `theme_color` to both equal `#141210` and appear as `--paper: #141210`; expect `index.html` to contain `<meta name="theme-color" content="#141210" />`.
- [ ] **Step 2: Run** `pnpm --filter @binder/web exec vitest run src/styles src/manifest.test.ts` — expect FAIL (no tokens.css, old colours).
- [ ] **Step 3: Install** `tailwindcss`, `@tailwindcss/vite` (use `@tailwindcss/postcss` + `postcss.config.mjs` instead if the Vite plugin's peer range rejects Vite 8 — check with `pnpm why vite` after install and a `pnpm build`), `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`, `@fontsource/archivo`, `@fontsource/hanken-grotesk`, `@fontsource/geist-mono`, `@fontsource/kalam`, `tw-animate-css`.
- [ ] **Step 4: Build `tokens.css`** from Flow's `~/rvltflow/gearflow/src/app/globals.css` lines 1–262 (`@import "tailwindcss"`, `tw-animate-css`, the espresso `:root`, the `.light` block, `@theme inline`, `@layer base`), drop Flow-only tokens that have no Binder use (warehouse display, gaff tape, cream), and add DESIGN §4.2–4.3 tokens (`--page`, `--page-ink`, `--dept-lx` … `--dept-fly`, `--dept-personal`) with `@theme` mappings. `base.css`: body `bg-paper text-ink font-sans`, `color-scheme: dark`, `-webkit-font-smoothing: antialiased`, `:focus-visible` red ring, reduced-motion rule. Import order in `main.tsx`: the four `@fontsource` CSS files for the weights in spec §2, then `tokens.css`, `base.css`, then the old `styles.css` (it stays until Task 15 and loses rules screen by screen).
- [ ] **Step 5: Alias and theme colours.** `@/` → `src` in `vite.config.ts` `resolve.alias` and `tsconfig.json` `paths`. Manifest `background_color` and `theme_color` → `#141210`; `index.html` theme-color meta → `#141210`. PWA `workbox.globPatterns` gains `woff2`; `includeAssets` keeps the icon files from the brand commit.
- [ ] **Step 6: Run** the unit tests from Step 2 (PASS), `pnpm --filter @binder/web build`, then `grep -c woff2 apps/web/dist/sw.js` — expect ≥ 1. Run `pnpm --filter @binder/web test` and `pnpm e2e -- viewer markup` (Tailwind preflight resets old styles; behaviour must be unchanged).
- [ ] **Step 7: Commit** `feat(web): Tailwind v4, RVLT tokens and self-hosted fonts`.

### Task 2: Department colours and helpers

**Files:**
- Modify: `packages/shared/src/markup.ts` (`DEFAULT_DEPARTMENTS`), any test that pins the old default hex values (`grep -rn "F5A623\|4A90E2\|9B51E0\|2BB0A6\|D0021B\|8B572A\|417505" apps packages`)
- Create: `packages/shared/src/colour.ts`, `packages/shared/src/colour.test.ts`; export from `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `deptChrome(hex: string): string` (DESIGN §4.3 table: default → its chrome tint; other → `color-mix(in oklab, <hex> 70%, white)` as a CSS string), `isTooCloseToRed(hex: string): boolean` (CIE ΔE76 in Lab against `#E0363D` < 20), `DEPARTMENT_COLOUR_PRESETS: readonly { code: string; colour: string }[]` (the seven defaults in DESIGN order), `RVLT_RED = '#E0363D'`.

- [ ] **Step 1: Write failing tests** in `colour.test.ts`: `deptChrome('#C9811F') === '#EBA53A'`; `deptChrome('#2F6BD6') === '#5B8DEF'`; `deptChrome('#123456') === 'color-mix(in oklab, #123456 70%, white)'`; case-insensitive input; `isTooCloseToRed('#E0363D')`, `isTooCloseToRed('#D0021B')` (ΔE 13.3), `isTooCloseToRed('#B21F26')` (14.1) and `isTooCloseToRed('#e53b40')` true; `isTooCloseToRed('#C9811F')`, `isTooCloseToRed('#CC5E2E')` (coral, the nearest default, ΔE 25.8) and `isTooCloseToRed('#EF7E55')` (28.7) false; presets equal DESIGN §4.3 in order LX, SND, TM, SM, VID, STG, FLY. In the existing markup test for `DEFAULT_DEPARTMENTS`, expect the new colours and that none `isTooCloseToRed`.
- [ ] **Step 2: Run** `pnpm --filter @binder/shared test` — FAIL.
- [ ] **Step 3: Implement** `colour.ts` (hex → sRGB → XYZ D65 → Lab, ΔE76) and update `DEFAULT_DEPARTMENTS` colours (codes, names, formats and order unchanged).
- [ ] **Step 4: Run** shared and api tests (`pnpm --filter @binder/shared test`, `pnpm --filter @binder/api test`) — PASS; fix any test that pinned old defaults.
- [ ] **Step 5: Commit** `feat(shared): ink-on-paper department defaults, chrome tint and red guard`.

### Task 3: UI primitives

**Files:**
- Create: `apps/web/src/components/ui/{button,input,textarea,label,checkbox,switch,tabs,sheet,drawer,popover,dropdown-menu,tooltip,kbd,badge,skeleton,avatar,segmented}.tsx`, `apps/web/src/components/ui/dialog-shell.tsx`, `apps/web/src/components/ui/ui.test.tsx`
- Modify: `apps/web/package.json` (Radix packages Flow uses for these, `vaul`, `cmdk`, `@radix-ui/react-slot`)

**Interfaces:**
- Consumes: `cn`, `focusRing`, `disabledState` (Task 1).
- Produces: Flow's exports for each copied file (`Button` with `variant: primary|line|ghost`, `size: sm|default|lg|icon`; `Tabs/TabsList/TabsTrigger/TabsContent`; `Sheet/SheetContent/...`; `Drawer/DrawerContent/...`; `DropdownMenu/...`; `Tooltip/...`; `Kbd`; `Badge`; `Skeleton`; `Avatar`). New: `Segmented` (`{ value, onValueChange, options: {value, label}[], 'aria-label' }`, a Radix ToggleGroup single-select styled as DESIGN's segmented control); `DialogShell` (`{ ref, labelledBy, className, children }` rendering a native `<dialog>` with the shared look from spec §2 and a `DialogHeader`/`DialogFooter` pair).

- [ ] **Step 1: Write failing tests** in `ui.test.tsx`: `Button` renders a `<button>` with its text and `aria-busy` when `loading`; `Segmented` exposes a radio-group (`getByRole('radiogroup', { name })`) whose options switch `aria-checked` on click and call `onValueChange`; `DialogShell` renders `<dialog aria-labelledby>`; `Kbd` renders a `<kbd>`; `Tabs` switch panels by `getByRole('tab')`.
- [ ] **Step 2: Run** `pnpm --filter @binder/web exec vitest run src/components/ui` — FAIL.
- [ ] **Step 3: Copy** each file from `~/rvltflow/gearflow/src/components/ui`, remove `"use client"` and Next imports, keep Flow's classes (pill buttons per DESIGN §0), and set `Drawer`'s `shouldScaleBackground` default to `false` (the page must not scale). Write `segmented.tsx` and `dialog-shell.tsx`.
- [ ] **Step 4: Run** the unit tests — PASS; `pnpm -r typecheck`; `pnpm lint`.
- [ ] **Step 5: Commit** `feat(web): RVLT registry primitives, segmented control and dialog shell`.

### Task 4: AppShell, navigation, notices

**Mockups:** home, show, markup (rail and top bar), m-show, m-more (tab bar), t-markup (icon rail).

**Files:**
- Create: `apps/web/src/shell/AppShell.tsx`, `apps/web/src/shell/Rail.tsx`, `apps/web/src/shell/TopBar.tsx`, `apps/web/src/shell/TabBar.tsx`, `apps/web/src/shell/AccountMenu.tsx`, `apps/web/src/shell/navItems.ts`, `apps/web/src/shell/useBreakpoint.ts`, `apps/web/src/shell/AppShell.test.tsx`, `apps/web/src/routes/shows.$showId.more.tsx`
- Modify: `apps/web/src/routes/__root.tsx`, `apps/web/src/routes/shows.$showId.tsx` (becomes a pure layout: shell + PresenceProvider + `<Outlet/>`; its current page content moves unchanged to a new `apps/web/src/routes/shows.$showId.index.tsx`), `apps/web/src/components/Notices.tsx`, `apps/web/src/components/SyncStatus.tsx`, `apps/web/src/styles.css` (remove the base/app-header rules and the `:has()` full-height rules)

**Interfaces:**
- Consumes: primitives (Task 3), `BinderMark`, lucide icons.
- Produces: `<AppShell showId? crumbs actions primary? fullBleed?>` — `fullBleed` gives the child a full-height, non-scrolling content area (the document route uses it); `navItems(showId)` returning `{ key: 'script'|'cues'|'docs'|'activity'|'exports', label, to, hue, icon }[]`; `useBreakpoint(): 'phone'|'tablet'|'desktop'` (matchMedia on 768/1024, SSR-safe default `desktop`); `TopBar` slots; `AccountMenu` (email, Personal access tokens, Sign out → in-app confirm, then the existing `signOutAndClear`).

- [ ] **Step 1: Write failing tests** in `AppShell.test.tsx` (mock `matchMedia`): at desktop the rail is a `navigation` named "Binder" with links Script, Cues, Docs, Activity, Exports and the current one `aria-current="page"`; at tablet the same links exist with labels only as accessible names (visually hidden text); at phone there is no rail and a `navigation` named "Show" with Script, Cues, Docs, Activity, More; on `/` (no show) the phone has no tab bar. `AccountMenu`: choosing Sign out asks "Sign out of Binder?" in the page (no `window.confirm`), and confirming calls the sign-out function once.
- [ ] **Step 2: Run** the test — FAIL.
- [ ] **Step 3: Implement** the shell per DESIGN §6–7 (rail 56 px with labels at desktop, 52 px icon-only at tablet, top bar 44 px desktop / 56 px phone, tab bar 56 px + `env(safe-area-inset-bottom)`, active tab red icon and label, inactive `text-muted`). Root route renders the shell for the shows home and tokens pages; the show route renders it with `showId`. Notices: Flow notice style (3 px left accent bar on `bg-card`), still `role="alert"`, fixed bottom-right at desktop and above the tab bar at phone. SyncStatus: dot plus word per DESIGN §8 (`data-state` kept). `/shows/$showId/more` lists Exports, Settings, Members (→ settings#members), Personal access tokens, Shows, the offline card (existing `OfflineButton`) and the account row.
- [ ] **Step 4: Run** unit tests; `pnpm e2e -- sync offline settings history` (navigation by role must still work; update any e2e that clicked the old header links by name only if the name changed, and say so).
- [ ] **Step 5: Screenshot** `/`, a show and a document at 390, 834 and 1280 px (Playwright script in the scratchpad, not committed) and compare with the mockups' shell.
- [ ] **Step 6: Commit** `feat(web): app shell with rail, icon rail and phone tab bar`.

### Task 5: Sign in and shows home

**Mockups:** login, m-login, home, phone-home.

**Files:**
- Modify: `apps/web/src/routes/login.tsx`, `apps/web/src/auth/LoginForm.tsx`, `apps/web/src/routes/index.tsx`, `apps/web/src/styles.css` (remove `.login`, shows-list rules)
- Create: `apps/web/src/shows/ShowCard.tsx`, `apps/web/src/shows/NewShowDialog.tsx`, `apps/web/src/shows/ShowCard.test.tsx`

**Interfaces:**
- Produces: `<ShowCard show status openedOrOpens presence lastActivity />`; `<NewShowDialog />` (name field, red Create; uses the existing create-show mutation).

- [ ] **Step 1: Write failing tests**: `ShowCard` shows the title as a link to the show, a status pill with a word (Running / Rehearsal / Prep / Archived from the show's dates and status as the API provides them; if the API has no phase field, show Active/Archived only and record the gap in the report), archived cards say "read-only"; `NewShowDialog` creates a show and navigates to it (existing behaviour of the inline form, now in a dialog). Keep the inline rename's accessible names.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** per the mockups: sign-in card (mark, "Binder", "by RVLT" chip, Kalam line "the book is where you left it" in `text-ink-2`, labelled fields, red full-width Sign in, "Email me a link instead" link when available, the offline note under the card); home greeting by time of day with the user's first name or email local part, active show cards in a 3-column grid (desktop), 2 (tablet), 1 (phone), archived cards dashed and muted, empty state with one Kalam line, "New show" as the top-bar primary.
- [ ] **Step 4: Run** unit tests and `pnpm e2e -- auth shows archive` (whichever specs cover login and shows; list them with `ls apps/web/e2e`).
- [ ] **Step 5: Screenshot** at three widths; compare with mockups.
- [ ] **Step 6: Commit** `feat(web): sign in and shows home in the Binder design`.

### Task 6: Show overview and Documents

**Mockups:** show, m-show, docs, m-docs.

**Files:**
- Create: `apps/web/src/routes/shows.$showId.docs.index.tsx` (the Documents route, `/shows/$showId/docs`), `apps/web/src/overview/ShowOverview.tsx`, `apps/web/src/overview/NeedsYou.tsx`, `apps/web/src/overview/DepartmentCards.tsx`, `apps/web/src/overview/overview.test.tsx`, `apps/web/src/documents/DocumentRow.tsx`
- Modify: `apps/web/src/routes/shows.$showId.index.tsx` (created in Task 4; its content becomes `ShowOverview`), `apps/web/src/documents/DocumentList.tsx`, `apps/web/src/documents/UploadDialog.tsx` (DialogShell), `apps/web/src/offline/OfflineButton.tsx`, `apps/web/src/presence/Avatars.tsx`, `apps/web/src/styles.css` (remove Documents, Offline, Presence-list rules)

**Interfaces:**
- Consumes: existing queries for documents, cues per department, review counts, the activity feed and presence; `deptChrome` (Task 2).
- Produces: `<DocumentRow doc versions status onOpen … />` used by both the overview (scripts card) and the Documents route.

- [ ] **Step 1: Write failing tests** in `overview.test.tsx`: Needs you lists "N cues to review after the revision" with a Review link when any document has pending reviews and "LX has N duplicate numbers" with a Fix link (to the cue list filtered by duplicates) when duplicates exist, and renders nothing when neither; department cards show code, count in mono and "N duplicates" / "clean"; a failed document row shows its reason and a Try again button; a processing row shows a progressbar (`role="progressbar"` with `aria-valuenow`).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the overview layout (main column: Needs you, Scripts, Cue lists by department, Recent activity (latest 3 from the feed); right column at desktop: In the binder now, Needs you, Offline, footer links Settings · Members · Tokens; single column with the order Needs you → Scripts → Cue lists → In the binder now → Offline at phone). Documents route: rows with versions, cached chip, actions (Open, Cue lists, Compare, Upload new version), processing steps, failure state, drop target. Top-bar primary: Upload document. UploadDialog in DialogShell.
- [ ] **Step 4: Run** unit tests and `pnpm e2e -- viewer offline revisions` (upload and document list flows).
- [ ] **Step 5: Screenshot** at three widths; compare.
- [ ] **Step 6: Commit** `feat(web): show overview and documents route`.

### Task 7: Script screen frame

**Mockups:** markup, t-markup, print.

**Files:**
- Modify: `apps/web/src/routes/shows.$showId.docs.$docId.tsx`, `apps/web/src/viewer/Viewer.tsx`, `apps/web/src/viewer/ViewerToolbar.tsx`, `apps/web/src/viewer/ThumbnailRail.tsx`, `apps/web/src/viewer/PageList.tsx`, `apps/web/src/markup/MarkupTools.tsx`, `apps/web/src/exports/PrintDialog.tsx`, `apps/web/src/revisions/VersionSwitcher.tsx`, `apps/web/src/revisions/UploadRevisionDialog.tsx`, `apps/web/src/styles.css` (remove Viewer and Print rules)
- Create: `apps/web/src/viewer/StatusBar.tsx`, `apps/web/src/markup/ToolStrip.tsx` (replaces the toolbar's tool fieldset), `apps/web/src/viewer/frame.test.tsx`

**Interfaces:**
- Consumes: `AppShell fullBleed` (Task 4).
- Produces: `<ToolStrip />` (tools as `aria-pressed` buttons with the existing accessible names and a corner key hint; undo/redo; snap toggle; stamp picker as a Popover); `<StatusBar page pages snap activeLayer />`.

- [ ] **Step 1: Write failing tests** in `frame.test.tsx`: the tool buttons keep their names and `aria-pressed`, and each shows its key hint (`v`, `c`, `h`, `n`, `r`, `a`, `s`, `/`); the status bar reads "Page 1 of 43" and the active layer name; `THUMB_WIDTH === 96`. Add to `e2e/viewer.spec.ts`: after "Fit width" the first `.page-sheet` width equals the `.viewer-pages` client width minus `FIT_ALLOWANCE` (± 1 px). Add to `e2e/markup.spec.ts`: opening `?cue=<id>` leaves that cue's `rect.cue-tag-body` inside the viewport.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: top bar = crumbs (show / document) + version chip/switcher + review count + Print + presence (the Calling mode control is added by Task 14, not here); the stage `bg-[#0E0C0A]` centring the pages; thumbnails 96 px with per-side tag marks if cheap (else plain) and presence initials, hidden by default at tablet with a top-bar toggle; floating ToolStrip at the stage's left edge; status bar 28 px at desktop/tablet (hidden at phone). Keep the toolbar's zoom, fit and "Go to page" controls with their names (they move into the status bar's right side). Update `FIT_ALLOWANCE`, `GAP`, `SLOT_PADDING_TOP` together with the CSS if spacing changes. Print and Upload revision dialogs in DialogShell with Segmented controls for layers/pages/paper.
- [ ] **Step 4: Run** unit tests and `pnpm e2e -- viewer markup annotations search export revisions presence`.
- [ ] **Step 5: Screenshot** desktop and tablet; compare with `markup` and `t-markup`.
- [ ] **Step 6: Commit** `feat(web): script screen stage, tool strip, thumbnails and status bar`.

### Task 8: Context panel on the script screen

**Mockups:** markup (panel), t-markup (slide-over), m-markup (bottom sheet), review.

**Files:**
- Create: `apps/web/src/panel/ContextPanel.tsx`, `apps/web/src/panel/ContextPanel.test.tsx`, `apps/web/src/markup/PlaceCueButton.tsx`
- Modify: `apps/web/src/viewer/Viewer.tsx` (the `markup-panel` aside and `SearchPanel` column become the ContextPanel), `apps/web/src/markup/CueEditor.tsx`, `apps/web/src/markup/AnnotationEditor.tsx`, `apps/web/src/markup/LayerPanel.tsx`, `apps/web/src/history/HistoryPanel.tsx`, `apps/web/src/revisions/ReviewPanel.tsx`, `apps/web/src/search/SearchPanel.tsx`, `apps/web/src/styles.css` (remove Markup panel, Search, History, Revisions rules)

**Interfaces:**
- Produces: `<ContextPanel tabs={{ id, label, badge?, content }[]} value onValueChange open onOpenChange returnFocusTo? />` rendering a docked 340 px aside at desktop, a 360 px right Sheet without overlay at tablet, a vaul Drawer at phone (open only while something is selected or a tab was chosen); `<PlaceCueButton />` (phone only, red floating, ≥ 56 px, places a cue at the centre of the visible page through the existing placement path, then selects it).

- [ ] **Step 1: Write failing tests** in `ContextPanel.test.tsx` (matchMedia mocked): desktop renders `complementary` with tabs Cue, Layers, History, Review (Review shows its count); phone renders nothing until `open`, then a `dialog` containing the same tabs; closing the drawer returns focus to `returnFocusTo`; pressing `c` inside a panel text field does not call the place-cue handler (reuse `isEditableTarget`). CueEditor: Type is a Segmented "Type" with Go / Standby / Warn; Trigger shows the quote and page. Keep every existing label used by `markup.spec.ts`, `annotations.spec.ts`, `history.spec.ts`, `revisions.spec.ts`, `search.spec.ts`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the panel and restyle each editor to DESIGN §8 (CueEditor header: swatch + mono number + status pill; fields as Flow forms; Delete plain; "edited by … · time" muted). Search becomes a panel tab (or opens the panel on `/`). Phone: the page fills the width, the ToolStrip is hidden, PlaceCueButton shows when nothing is selected; selecting a tag opens the drawer on the Cue tab; Done closes it.
- [ ] **Step 4: Run** unit tests and `pnpm e2e -- markup annotations history revisions search presence`; add a phone-viewport case to `e2e/markup.spec.ts`: at 390 × 844, select a cue by its tag, the drawer opens with the cue's label field, edit the label, close, and the tag keeps focus.
- [ ] **Step 5: Screenshot** three widths; compare with markup / t-markup / m-markup.
- [ ] **Step 6: Commit** `feat(web): context panel — docked, slide-over and bottom sheet`.

### Task 9: Page markup colours

**Files:**
- Modify: `apps/web/src/markup/CueMarker.tsx`, `apps/web/src/markup/Handles.tsx`, `apps/web/src/markup/AnnotationShape.tsx`, `apps/web/src/presence/PeerOutline.tsx`, `packages/core/src/print/stampItems.ts` (tag number ink), their tests
- Create: `apps/web/src/styles/markup.css` (focus-visible and selection styles for SVG page objects; imported after `tokens.css`)

**Interfaces:**
- Consumes: `--page-ink`, `--red` tokens; `PAGE_INK = '#1A1715'` exported from `@binder/core` for print.

- [ ] **Step 1: Write failing tests**: the tag number `<text>` fill is `var(--page-ink)` on screen; selection handles and `.cue-marker-selection` stroke `var(--red)`; core stampItems test expects the tag number drawn in `#1A1715`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** per spec §7; move the marker/shape `:focus-visible` rules from `styles.css` to `markup.css` as a 2 px red outline (stroke) on the tag body / shape.
- [ ] **Step 4: Run** web and core tests, `pnpm e2e -- markup annotations presence export`.
- [ ] **Step 5: Commit** `feat(markup): page ink and red selection from the design tokens`.

### Task 10: Cue list

**Mockups:** cues, m-cues.

**Files:**
- Modify: `apps/web/src/routes/shows.$showId.cues.tsx`, `apps/web/src/cuelist/CueListTable.tsx`, `apps/web/src/cuelist/CueSheetButtons.tsx`, `apps/web/src/cuelist/RenumberDialog.tsx`, `apps/web/src/styles.css` (remove Cue list rules)
- Create: `apps/web/src/cuelist/CueCard.tsx`, `apps/web/src/cuelist/CueCard.test.tsx`

**Interfaces:**
- Consumes: ContextPanel (Task 8) with tabs Cue and History; `deptChrome`.
- Produces: `<CueCard cue selected onSelect />` for phone.

- [ ] **Step 1: Write failing tests**: department switcher is a Segmented "Department" with counts; flag filter pills toggle with `aria-pressed`; selecting a row (`tr[data-cue-id]`) opens the panel with that cue; at phone width rows render as `CueCard`s (a `list` of buttons named by number and label) and the `badge[data-flag]` pills are still present. Keep the "Number, row N" style labels used by `cuelist.spec.ts`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** per the mockups (mono tabular numbers, trigger in mono, flags as pills with words, selected row red outline, "Show on page" in the panel, Renumber and Export in the top bar; Renumber dialog in DialogShell).
- [ ] **Step 4: Run** unit tests and `pnpm e2e -- cuelist export`.
- [ ] **Step 5: Screenshot** three widths; compare.
- [ ] **Step 6: Commit** `feat(web): cue list table, detail panel and phone cards`.

### Task 11: Activity, Exports, Compare

**Mockups:** activity, m-activity, exports, compare.

**Files:**
- Modify: `apps/web/src/routes/shows.$showId.activity.tsx`, `apps/web/src/history/ActivityFeed.tsx`, `apps/web/src/history/useRevertAction.tsx` (DialogShell), `apps/web/src/routes/shows.$showId.exports.tsx`, `apps/web/src/exports/DownloadAgain.tsx`, `apps/web/src/routes/shows.$showId.docs.$docId.compare.tsx`, `apps/web/src/revisions/ComparePane.tsx`, `apps/web/src/styles.css` (remove History/activity, Exports, Compare rules)
- Create: `apps/web/src/history/ActivityRow.test.tsx`

- [ ] **Step 1: Write failing tests**: an activity row (`.activity-row`) reads as a sentence with the actor, "via Claude Code" when an agent acted, the meta line and a mono time; Revert shows "Revert N rows…" above 10; filters are Segmented controls "Layer" and "Who" (keep the existing accessible names if the e2e uses them; otherwise name them so and update the spec). Compare keeps `.compare-tint[data-op]`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** per the mockups; exports rows with file-type tile, mono file name, layer and time, Download again, "What changed since this", "Only you" pill, the Waiting-to-upload section; compare's change list in the ContextPanel at desktop and a bottom drawer at phone.
- [ ] **Step 4: Run** unit tests and `pnpm e2e -- history export revisions`.
- [ ] **Step 5: Screenshot** three widths; compare.
- [ ] **Step 6: Commit** `feat(web): activity, exports and compare in the Binder design`.

### Task 12: Show settings and personal access tokens

**Mockups:** settings, m-settings, tokens.

**Files:**
- Modify: `apps/web/src/routes/shows.$showId.settings.tsx`, `apps/web/src/markup/MarkerSideEditor.tsx`, `apps/web/src/exports/PaperSizeEditor.tsx`, `apps/web/src/markup/StampSetEditor.tsx`, `apps/web/src/routes/settings.tokens.tsx`, `apps/web/src/styles.css` (remove their rules)
- Create: `apps/web/src/settings/ColourField.tsx`, `apps/web/src/settings/ColourField.test.tsx`

**Interfaces:**
- Consumes: `DEPARTMENT_COLOUR_PRESETS`, `isTooCloseToRed` (Task 2).
- Produces: `<ColourField label value onChange />` (preset swatches as radio buttons + a custom colour input; shows "Red is kept for Binder's own alerts. Pick another colour." and does not call `onChange` for a red-close value).

- [ ] **Step 1: Write failing tests**: ColourField refuses `#E0363D` with the message (role `alert`) and accepts `#2F6BD6`; marker side and number format are Segmented controls with the existing accessible names; the tokens page shows the new token once in a red-outlined card with a Copy button and the inline revoke confirm "Revoke “<name>”? Anything using it stops working." with Revoke and Keep.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** per the mockups (departments table at desktop, cards at phone; members with role selects; invite row if the API supports invites, else leave the existing member-add control restyled; archive card using the existing archive action; "Only the owner can change these." line; read-only state for non-owners keeps today's behaviour).
- [ ] **Step 4: Run** unit tests and `pnpm e2e -- settings tokens archive` (whichever exist).
- [ ] **Step 5: Screenshot** three widths; compare.
- [ ] **Step 6: Commit** `feat(web): show settings and tokens in the Binder design`.

### Task 13: Command palette

**Mockup:** palette.

**Files:**
- Create: `apps/web/src/palette/CommandPalette.tsx`, `apps/web/src/palette/usePaletteResults.ts`, `apps/web/src/palette/palette.test.tsx`
- Modify: `apps/web/src/shell/AppShell.tsx` (mount and ⌘K / Ctrl+K), `apps/web/src/markup/useMarkupShortcuts.ts` (ignore keys while the palette is open)

**Interfaces:**
- Consumes: local queries for cues and documents of the current show, the existing search index for script text, router navigation, `cmdk`.
- Produces: `usePaletteResults(query, { showId, docId }) → { goTo: Result[], cues: Result[], script: Result[], actions: Result[] }` where `Result = { id, label, detail?, hint?, run(): void }`; and the pure `matchCues(query: string, cues: CueRow[], departments: Department[]) → CueRow[]` (department code optional, prefix match on the formatted number, ordered by page then y) exported from `apps/web/src/palette/matchCues.ts` for Task 14's keypad.

- [ ] **Step 1: Write failing tests**: "lx 12" puts LX 12 first under Go to and LX 12.5 / LX 120 under Cues (prefix match on the formatted number within the department); "12" also offers "Page 12" when the document has ≥ 12 pages; "wind" offers an In-the-script result with the line count; actions include Print…, Renumber from script order, Hide <dept> layer (Switch to calling mode is added in Task 14); `matchCues('lx 12', …)` and `matchCues('12', …)` unit-tested directly; Enter runs the current result; Escape closes and returns focus; while open, typing `c` or `]` does not trigger markup shortcuts.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** per DESIGN §7–8 (four fixed groups, red edge on the current result, ↵ hint, footer keys in mono); phone: a search button in the top bar opens it full-screen.
- [ ] **Step 4: Run** unit tests and `pnpm e2e -- markup` plus a new `e2e/palette.spec.ts`: ⌘K, type a cue number, Enter, the cue is selected on its page.
- [ ] **Step 5: Commit** `feat(web): command palette for cues, pages, script text and actions`.

### Task 14: Calling mode and the go-to keypad

**Mockups:** calling, goto, phone-calling.

**Files:**
- Create: `apps/web/src/calling/CallingView.tsx`, `apps/web/src/calling/CallingStrip.tsx`, `apps/web/src/calling/GoToKeypad.tsx`, `apps/web/src/calling/nextCue.ts`, `apps/web/src/calling/calling.test.tsx`, `apps/web/e2e/calling.spec.ts`
- Modify: `apps/web/src/routes/shows.$showId.docs.$docId.tsx` (validate `mode: 'calling'` in search params; render CallingView; add the "Calling mode" control to the script top bar), `apps/web/src/palette/usePaletteResults.ts` (add the "Switch to calling mode" action), `apps/web/src/viewer/Viewer.tsx` (a `readOnly` prop that disables tools, drag and editors but keeps tags focusable), `apps/web/src/markup/useMarkupShortcuts.ts` (⇧C toggles; in Calling only navigation keys act)

**Interfaces:**
- Consumes: `matchCues` (Task 13) for the keypad's live match line.
- Produces: `nextCue(cues, { departmentId, page, y }) → Cue | null` (the first cue on the active department at or after the top of the visible page, in page then y order); `<CallingStrip page pages next onPrev onNext onGoTo onExit />`; `<GoToKeypad mode: 'cue'|'page' onGo onCancel />` (live match line from the same matcher the palette uses).

- [ ] **Step 1: Write failing tests** (`calling.test.tsx`): `nextCue` picks the first LX cue at or below the page top and skips other departments; the strip shows "p.1 / 43" in mono and "Next LX 12 Ship deck wash in"; the keypad builds "2.2" from key presses, shows "SND 2.20 · Verse 2 swell · p.1" as the match, Go navigates to it, Cancel and Escape close it returning focus to Go to…; in read-only mode `c`, Delete and digit keys do nothing, ←/→ turn pages. `e2e/calling.spec.ts`: open Calling mode from the top bar, no tool buttons exist, the page shows, → turns the page, the keypad jumps to a cue, Exit returns to markup with the same page.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** per DESIGN §9 (slim status line with the red "Calling" pill, the page at reading size, floating strip, tap left/right thirds to turn pages, keypad keys ≥ 64 px, wide red Go, Recent chips from session history); phone layout per `phone-calling`.
- [ ] **Step 4: Run** unit tests, `pnpm e2e -- calling markup viewer`, and `pnpm e2e:offline` (Calling mode must work from the offline cache).
- [ ] **Step 5: Screenshot** iPad landscape (1024 × 744), iPad portrait (834 × 1194) and phone; compare.
- [ ] **Step 6: Commit** `feat(web): Calling mode with the next-cue strip and go-to keypad`.

### Task 15: States, cleanup and the responsive pass

**Mockups:** states and every screen.

**Files:**
- Create: `apps/web/e2e/responsive.spec.ts`, `apps/web/src/components/EmptyState.tsx`, `apps/web/src/components/OfflineBanner.tsx`
- Modify: every route that still renders "Loading…" text (Skeleton instead, keeping any text the e2e waits for as visually hidden), `apps/web/src/styles.css` (delete; move any rule still needed into `markup.css` or utilities), `apps/web/src/main.tsx`, `DESIGN.md` (decisions log entries for anything the build ruled), `docs/superpowers/design/binder-ui-2026-10/` untouched

- [ ] **Step 1: Write the failing e2e** `responsive.spec.ts`: for each route (home, overview, documents, script, cues, activity, exports, settings, tokens, more) at 390 × 844 with a seeded show whose title is 40 characters and with a 60-character cue label: `document.documentElement.scrollWidth <= innerWidth`; every visible `button, a, input, select, [role=button], [role=tab]` outside the page overlay has a bounding box ≥ 44 × 44 (report offenders by accessible name); at 1280 × 800 the rail is visible and the tab bar is not. In `offline.spec.ts`, after the offline reload, assert `document.fonts.check('800 16px Archivo')` and `document.fonts.check('400 13px "Geist Mono"')`.
- [ ] **Step 2: Run** — expect failures to fix.
- [ ] **Step 3: Implement** EmptyState (icon tile, heading, one line, optional Kalam line, optional CTA) and the OfflineBanner (muted, wifi-off icon, "Offline. Changes are saved on this device — N waiting to sync."), skeletons; fix every offender from Step 1; delete `styles.css`.
- [ ] **Step 4: Run** the whole suite: `pnpm -r typecheck`, `pnpm lint`, `pnpm test`, `cd apps/web && pnpm e2e`, `pnpm e2e:offline`, `pnpm --filter @binder/web build`.
- [ ] **Step 5: Screenshot** every route at 390, 834 and 1280 into the scratchpad and look at each next to its mockup; fix what differs in ways DESIGN.md cares about (not pixel nits).
- [ ] **Step 6: Commit** `feat(web): states, responsive checks and the end of styles.css`.
