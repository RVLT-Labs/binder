# Binder UI restyle

Status: approved by Jayden ("I like the design language. Let's document it all and build", 2026-10-16). The design is `DESIGN.md` (repo root); the approved pictures are the mockup gallery in `docs/superpowers/design/binder-ui-2026-10/` (`index.html`, 29 screens; PNG renders via `_shot.mjs`). This spec says how the web app gets there. Nothing about the data model, the sync rules, the API or the MCP surface changes, except the default department colours (§6).

## 1. Goal

Every screen of `apps/web` looks and behaves like the mockups at three widths (phone < 768, tablet 768–1024, desktop > 1024), using RVLT Flow's tokens and registry components, with all M1 behaviour, accessibility and offline support intact and every existing test green (tests change only where markup they pin moves on purpose).

## 2. Stack

- **Tailwind CSS v4** with `@tailwindcss/vite` (fall back to `@tailwindcss/postcss` if the Vite plugin's peer range does not accept Vite 8). Utilities in TSX through `cn()` (`clsx` + `tailwind-merge`), exactly as Flow does.
- **Tokens**: `apps/web/src/styles/tokens.css` = Flow's generated espresso `:root` block and its `@theme inline` mapping (`~/rvltflow/gearflow/src/app/globals.css`, lines 1–262, the `.light` block included so the Paper theme can be switched on later), plus Binder's tokens from `DESIGN.md` §4.2–4.3 (`--page`, `--page-ink`, `--dept-*` defaults) mapped into `@theme` the same way.
- **Fonts**: self-hosted with `@fontsource` packages: Archivo 800, Hanken Grotesk 400/500/600/700, Geist Mono 400/500, Kalam 400. Latin subsets only. The PWA precache glob gains `woff2` so the installed app renders offline.
- **Primitives**: copied from Flow's `src/components/ui` into `apps/web/src/components/ui` (shadcn convention, the registry is copy-in): button, input, textarea, label, checkbox, switch, tabs, sheet, drawer (vaul), popover, dropdown-menu, tooltip, kbd, badge, skeleton, avatar, plus `cmdk` for the palette. Strip `"use client"` and any Next.js import. Add the `@/` → `src/` alias in `vite.config.ts` and `tsconfig.json` so copied files keep their imports.
- **Icons**: `lucide-react`. Replace text glyphs ("−", "+", "←") with icons that keep their accessible names.
- **Dialogs**: the five existing native `<dialog>` sites (Upload, Upload revision, Print, Renumber, Revert confirm) **stay native** (they already trap focus, have `aria-labelledby` and the tests depend on their behaviour). They take one shared look: `DialogShell` styles (20 px radius, 2 px `--line-2` outline, `--sh-stk` shadow, `--card` fill, `::backdrop` = `--scrim`). Net-new overlays use Radix through the registry: Sheet (tablet panel), Drawer (phone bottom sheet), DropdownMenu (avatar menu, row menus), Tooltip, and the palette.
- `window.confirm` for sign-out is replaced by an in-app confirm in the avatar menu.

## 3. What must not break (from the code inventory)

1. **Accessible names, roles, labels and headings** are how 424 e2e queries and ~180 unit queries find elements. A restyle may change any element and class, but not an accessible name, role, label text, heading text or landmark label, unless the test changes in the same commit for a stated reason.
2. **Test-hook classes and data attributes stay on the same elements** even when they no longer carry styles: `cue-tag-body`, `cue-underline`, `cue-leader`, `cue-trigger`, `cue-highlight`, `cue-tick`, `cue-marker-selection`, `cue-drag-ghost`, `markup-surface`, `annotation-*` shape classes, `activity-row`, `activity-end`, `compare-tint`, `search-hit`, `search-hit-active`, `peer-outline`, `badge` (with `data-flag`), `thumbnail-slot`, `thumbnail-presence`, `cue-page`, `tool-hint`, `visually-hidden`, `review-older`; every `data-*` attribute listed in the inventory (`data-page-index`, `data-cue-id`, `data-op`, `data-export-id`, `data-testid`, `data-selected`, `data-review-item`, `data-handle`, `data-flag`, `data-cue-trigger`, `data-annotation-id`, `data-cue-label`, `data-state`, `data-status`).
3. **Viewer geometry**: `.page-sheet` keeps `position: relative`, explicit inline size, and no border, padding or transform (pointer maths uses its bounding rect). The overlay SVG keeps `pointer-events: none` with opt-in children. `Viewer.FIT_ALLOWANCE`, `PageList.GAP` / `SLOT_PADDING_TOP` and `ThumbnailRail.THUMB_WIDTH` must equal the CSS they describe; when the design changes a spacing, change the constant and the CSS in the same commit (thumbnails go to 96 px per DESIGN §6.2).
4. **Full-height layout**: the document route's `body:has(.document-page)` trick is replaced by the AppShell giving routes an explicit full-height content area; the `min-height: 0` chain that lets the page list, thumbnails and panel scroll independently must survive.
5. **Keyboard**: every shortcut in `useMarkupShortcuts` and `controls.ts` keeps working; new shortcuts (⌘K, ⇧C, tool letters) go through the same `isEditableTarget` gate.
6. **Offline**: no network dependency at runtime (fonts, icons and CSS ship in the bundle and precache).
7. **Presence colours** asserted as exact `rgb()` in e2e keep coming from data.

## 4. Information architecture

| Route | Screen | Rail item (desktop/tablet) | Phone tab |
|---|---|---|---|
| `/login` | Sign in (no shell) | — | — |
| `/` | Shows home | — (Shows at the rail foot) | none: the list sits above the tab level |
| `/shows/$showId` | Show overview: needs you, scripts, cue lists by department, recent activity, in the binder now, offline | Script | Script |
| `/shows/$showId/docs` *(new)* | Documents: all documents with versions, processing and failure states, upload | Docs | Docs |
| `/shows/$showId/docs/$docId` | Script markup (and Calling mode, §5.6) | Script | Script |
| `/shows/$showId/docs/$docId/compare` | Compare versions | Script | Script |
| `/shows/$showId/cues` | Cue lists | Cues | Cues |
| `/shows/$showId/activity` | Activity | Activity | Activity |
| `/shows/$showId/exports` | Exports | Exports | More → Exports |
| `/shows/$showId/settings` | Show settings | (overview footer, avatar menu) | More → Settings |
| `/settings/tokens` | Personal access tokens | (avatar menu) | More → Tokens |
| `/shows/$showId/more` *(new, phone only)* | More | — | More |

The current show page's document list moves to the Documents route; the show page becomes the overview. Existing URLs keep working.

## 5. Screens

Each screen matches its mockup (gallery ids in brackets) at the widths it is drawn at, and follows DESIGN §6 at the others.

1. **Shell** [all]: `AppShell` with rail (desktop labels, tablet icons), top bar (crumbs, sync, presence, actions, one red primary), phone tab bar with safe areas, avatar menu (account email, Personal access tokens, Sign out with in-app confirm). Notices restyled as Flow notices (left accent bar), kept `role="alert"`, stacked bottom-right on desktop and above the tab bar on phone.
2. **Sign in** [login, m-login]: centred card, mark, Kalam line, email and password, red Sign in, "Email me a link instead" when the server can send links.
3. **Shows home** [home, phone-home]: greeting, active cards with status pill, versions and cue count, presence, last activity; archived cards dashed; New show as a dialog (name only; the department step of the wizard mockup is later, §8).
4. **Show overview and Documents** [show, docs, m-show, m-docs]: overview composed from data the app already has (documents, review counts, department cue counts and duplicate counts, the activity feed, presence, offline state). Documents list with upload progress and the four processing steps, failure state with its reason and Try again.
5. **Script markup** [markup, t-markup, m-markup, palette]: stage, thumbnails (96 px, tag marks per side, presence), floating ToolStrip with key hints, top bar (crumbs, version switcher, review count, Print, Calling mode), status bar, ContextPanel with tabs Cue / Layers / History / Review hosting the existing CueEditor, AnnotationEditor, LayerPanel, history and ReviewPanel; SearchPanel opens as a panel tab or popover rather than a fixed column. Tablet: panel as a slide-over Sheet, no scrim. Phone: page full width, "Place cue" floating button when nothing is selected, the panel as a vaul Drawer when something is.
6. **Calling mode** [calling, goto, phone-calling]: `?mode=calling` on the document route. Same page renderer, no editing affordances (tags stay focusable for reading; no drag, no tools, no editor), slim status line, CallingStrip (page ‹ n/N ›, next cue on the active department, Go to…, Exit), page turn by tapping the left or right third of the page, swipe, or ←/→, and the GoToKeypad dialog. ⇧C toggles it.
7. **Command palette** [palette]: ⌘K on desktop and tablet (and a search button in the phone top bar). Groups Go to · Cues · In the script · Actions, built from the local database (cues of the current show, pages of the current document, script search through the existing search index, and a fixed action list).
8. **Cue list** [cues, m-cues]: department segmented control with counts, flag filter pills, the table restyled (inline editing unchanged), the selected cue's detail and history in the ContextPanel, phone cards. Renumber and cue-sheet export restyled.
9. **Activity** [activity, m-activity]: filters as segmented controls, rows as sentences with avatar, meta and Revert. Phone cards with a visible Revert (swipe-to-reveal is later, §8).
10. **Exports, Compare, Review** [exports, compare, review]: as drawn.
11. **Show settings and tokens** [settings, tokens, m-settings]: departments with colour presets and the red guard (DESIGN §4.3), number format and marker side as segmented controls, members and roles, paper size, stamp sets, archive; tokens with the copy-once card and inline revoke confirm.
12. **States** [states]: offline banner, empty states (one Kalam line), skeletons (solid `--elev` pulse) wherever a query is loading, toasts.

## 6. Data change: department defaults

`DEFAULT_DEPARTMENTS` in `@binder/shared` takes DESIGN §4.3's colours (LX `#C9811F`, SND `#2F6BD6`, TM `#7A5CD0`, VID `#C2487E`, SM `#1C8B83`, STG `#CC5E2E`, FLY `#6E8C12`). Existing departments are not migrated. A shared `deptChrome(hex)` returns the chrome tint, and `isTooCloseToRed(hex)` backs the picker's guard (ΔE76 < 20 against `#E0363D`), both unit-tested.

## 7. Page markup colours

Markup drawn in TSX with literal colours moves to tokens: tag numbers and notes use `--page-ink` (`#1A1715`, was `#111827`); selection handles and the selected-tag outline use `--red` (was `#1d4ed8`); focus-visible on page objects is a 2 px red outline. Print stamping is unchanged except the tag-number ink, which takes the same `#1A1715`.

## 8. Out of scope for this pass

The department step of the new-show wizard, swipe-to-revert, sync conflict cards (no conflict model exists yet), the Paper (light) theme toggle, the cue-sheet print layout, invite emails, Paper mode on every screen. The tokens and components are laid out so each can be added without restyling again.

## 9. Verification

- Unit and e2e suites green at every task boundary; the full suite plus offline e2e at the end.
- Playwright screenshots of every route at 390 × 844, 834 × 1194 and 1280 × 800 against a seeded show, looked at next to the matching mockup PNG, at every screen task and in a final pass.
- No horizontal page scroll at 390 px on any route. Every tap target at phone width ≥ 44 px (checked by a small e2e helper over interactive elements).
- `biome check` clean; `pnpm -r typecheck` clean; the production build's precache includes the fonts.
