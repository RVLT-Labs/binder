# Design System — Binder

Binder, by RVLT. Version 1.0, 2026-10-16. Approved by Jayden ("I like the design language", 2026-10-16) from the mockups in `docs/superpowers/design/binder-ui-2026-10/` (published as the *Binder UI direction* artifact).

## 0. How this document works

Binder is a sibling of RVLT Flow and inherits **RVLT Flow's `DESIGN.md` v1.1.1** (`~/rvltflow/gearflow/DESIGN.md`, registry `rvlt-labs.github.io/rvlt-designlanguage`) as law: tokens, type, spacing, radius, hard shadows, motion, required interactive states, status system, personality rules, mobile touch rules. This document records only:

- what Binder adds that Flow has no need for (the script page, cue markup, calling mode, the cue editor), and
- where Binder deliberately differs, each with the reason.

When this document is silent, Flow's is the answer. **The approved mockups are the binding standard for how every screen looks** (Jayden, 2026-10-16: "make sure the designs are fully compliant with the mockups"): where a mockup and Flow's registry or this document disagree on a component's shape, size, colour, copy or placement, the mockup wins. Buttons are drawn as the mockups draw them (10 px radius, 30 px tall at desktop, 44 px on phones), not as the registry's pills, and red appears where the mockups put it. The only exceptions are the floors (11 px text, 44 px phone targets), accessible names the tests rely on, and details that need data Binder does not have yet; each is listed in the decisions log.

## 1. Product context

Binder is the stage manager's binder, digital: script and score PDFs, cues per department marked on the page, cue lists, documents, history with revert, revisions with re-anchoring, and an MCP surface for agents. It is used in four situations, in order of time spent: marking up a script (hours, laptop then iPad), calling or following a show (in the dark, one hand, no edits), building and checking lists and exports (minutes, between sessions), and collaborating (who changed what, revert). The interface gives design effort in that order.

## 2. Aesthetic direction: "Prompt corner"

The prompt corner is where the stage manager sits with the book, the cue lights and the headset: dark, calm, everything in reach, the script lit and everything else dimmed. Confident, quick, quiet. The RVLT voice (dry, warm) appears only in greetings and empty states.

Three rules are Binder's own and outrank everything below:

1. **The page is paper.** A script page always renders as the PDF's own white (`--page`), in both themes, and is the brightest thing on screen. Chrome never competes with it: no bright panels beside the page, and controls stay muted until hovered or focused.
2. **Department colour is the only colour on the page.** Markup is drawn in department colours tuned to read as ink on white. Chrome around the page stays monochrome espresso plus RVLT red where the mockups put it (primary buttons, the live state, the active tab and tool, the selected cue). Presence uses a person's colour, never a department's.
3. **Two modes, one layout.** *Markup* is the full shell. *Calling* strips it to the page, the page number and a floating strip; nothing in Calling is editable. Both draw the page identically, so what you mark is what you call and what you print.

## 3. Typography

Flow's stack, unchanged: Archivo 800 (display, `--font-display`, the `font-display` utility), Hanken Grotesk (UI, `--font-sans`), Geist Mono (`--font-mono`), Kalam (`--font-hand`, personality only). Binder self-hosts all four (no font CDN) so the installed app renders correctly offline.

Binder additions:

- **Every cue number, page number, version, time, count, file name and key cap is Geist Mono with tabular figures**, everywhere: tags on screen, tables, cards, the palette, the keypad, history rows. Columns of numbers must line up.
- **The script's own text is never restyled.** Binder draws over the PDF; it never reflows or re-fonts it.
- **Markup type on the page** (tag lead and number, stamps, notes) is Helvetica-metric (`helveticaWidth` in core) on screen and Helvetica in print, so screen and paper measure identically. This is the one place Binder's UI fonts are not used, by design.
- 11 px floor, sentence case everywhere, over-labels included (the mockups' `.t-over`: 11 px / 600, .02em tracking, muted; no uppercase).

## 4. Colour

### 4.1 Chrome

Flow's espresso tokens verbatim (`--paper #141210`, `--paper-2 #1A1613`, `--card #211C17`, `--elev #2A241D`, `--ink #F5EFE2`, `--ink-2`, `--muted`, `--faint`, `--line`, `--line-2`, `--red #E0363D`, `--red-700`, status `--ok`/`--warn`, module hues, `--sh-card`, `--sh-hover`, `--sh-stk`, `--lit`). Dark is the default because Binder's working condition is the dark (tech table, FOH, a bio box). Flow's light "Paper" theme is the opt-in for daytime prep and print-adjacent review; it changes chrome only, never the page.

Red is a primary action (a view can have several, as the mockups draw them: the top bar's, and each script row's Open), live/active state ("Calling", the active phone tab, the selected cue), and alerts. **Red is never a department colour** and never decoration.

### 4.2 The page

| Token | Value | Use |
|---|---|---|
| `--page` | `#FFFFFF` | the PDF page ground, in every theme |
| `--page-ink` | `#1A1715` | ink drawn on the page that is not a department's (note text, tag numbers) |

### 4.3 Department colours

A department's colour is stored on the department (owner-editable in Show settings) and is the colour of its tags, underlines, leaders, layer swatch and cue-list accents. Defaults for new departments are tuned to read as ink on white paper and to stay distinct from each other and from red:

| Code | Name | Default | Chrome tint on dark |
|---|---|---|---|
| LX | Lighting | `#C9811F` | `#EBA53A` (amber) |
| SND | Sound | `#2F6BD6` | `#5B8DEF` (blue) |
| TM | TheatreMix | `#7A5CD0` | `#9B82E6` (purple) |
| SM | Stage management | `#1C8B83` | `#3FC8BE` (teal) |
| VID | Video | `#C2487E` | `#E875AC` (pink) |
| STG | Stage | `#CC5E2E` | `#EF7E55` (coral) |
| FLY | Flys | `#6E8C12` | `#AFC44E` (lime) |
| Personal | (per user) | `#6B7280` | `#9E9483` |

- On the page, use the stored colour as is.
- In chrome (swatches, cue numbers in lists, palette results on espresso), use the chrome tint: `deptChrome(hex)` = the table's tint when the stored colour is a default, otherwise `color-mix(in oklab, <hex> 70%, white)`. Never put a dark department colour as text on espresso.
- The colour picker in Show settings offers the seven defaults as presets plus a custom value, and refuses anything within ΔE76 20 of RVLT red (that catches `#D0021B` at 13.3 and still allows coral at 25.8) with the message "Red is kept for Binder's own alerts. Pick another colour."
- Existing shows keep their stored colours. (The M1 default for SM was red, `#D0021B`; owners can change it, and the picker's red guard applies the next time it is edited.)

### 4.4 People

Avatars use Flow's module hues as person colours (Jayden amber, Oli teal, Mikaela blue, …), assigned by stable hash of the user id. Presence on the page is the person's colour as a 2 px outline around the tag they have selected, and their initials on page thumbnails. Never animated, never a toast.

## 5. The page and its markup

The authoritative geometry is `docs/superpowers/specs/2026-10-15-cue-margin-markers.md`, implemented once in `@binder/core` (`layoutCueTags`) and used by both the screen overlay and print stamping. In design terms:

- **Tag**: a pill in the margin, opaque white, 1 pt outline in the department colour: department code in the colour, cue number in bold page ink. Standby: dashed outline. Warn: 1.5 pt outline. Narrow margins drop the department code first, then the type word, never the number.
- **Trigger**: the words the cue goes on, underlined 1.5 pt in the department colour. On screen only, a 10 % fill while the cue is selected or hovered. Print never fills.
- **Leader**: 0.75 pt at the underline's level, so it never crosses a glyph; a stacked tag jogs through a 2 pt gutter outside the text block.
- **Side**: per department (`settings.markerSides`), default left.
- **Selection**: the selected tag gets a 2 px red outline (red here is "active", not a department). Peer selection: 2 px in that person's colour.
- **Annotations**: notes (left rule plus 12 % tint of their colour), stamps (outlined caps, slight rotation), shapes and arrows in their layer's colour.
- Labels are never drawn on the page; they live in the tag's accessible name and hover title, the cue editor, lists and sheets.

## 6. Layout

### 6.1 Breakpoints

| Name | Width | Shell |
|---|---|---|
| Phone | < 768 px | bottom tab bar inside a show; single column; panel as bottom sheet |
| Tablet | 768–1024 px | icon-only rail (52 px); panel as a slide-over sheet from the right |
| Desktop | > 1024 px | rail with labels (56 px); thumbnails; panel docked right |

Calling mode is designed for the tablet first (iPad landscape and portrait), and follows the same page rules on phone and desktop.

### 6.2 Desktop shell

- **Rail** 56 px, `--paper-2`, right rule `--line`. Top: the Binder mark (28 px). Items 44 × 44, icon over an 11 px label (the mockup draws 10 px; the 11 px floor wins). Module hues: Script blue, Cues amber, Docs teal, Activity purple, Exports green; the active item takes its hue's soft fill and colour with `--sh-card`. Foot: Shows, then the user's avatar.
- **Top bar** 44 px (plus the top safe-area inset), `--paper`, bottom rule `--line`: breadcrumbs (show / document, current item bold), version chip, then on the right sync state, presence avatars, secondary actions, and the primary button (red). The script's own bar is the markup mockup's: sync, presence, Undo, Redo, Print, Calling mode and a "…" menu that holds Upload revision, Command palette…, Go to page… and Renumber from script order.
- **Content** on `--paper`, 28–32 px padding (left and right padding never less than the device's safe-area insets), sections labelled with Flow's section-label (over-label plus rule).
- **Script screen**: thumbnails column (92 px, the thumbnails 62 px wide inside it) · the page centred on a `#0E0C0A` stage with a floating tool strip at its left edge · the right panel (340 px, `--paper-2`, tabs Cue / Layers / History / Review). A 26 px status bar at the bottom: page n of N, snap state (Snap lives here, not in the strip), active layer, the four shortcuts people forget (`c` `]` `g` `⌘K`). The tool strip's buttons are 34 px with a mouse and 44 px on any touch screen (`pointer: coarse`); on a short touch screen the strip scrolls rather than shrinks its buttons. A tool's own options (the cue type, the stamp) open in a small flyout beside the tool, clamped inside the viewport.

### 6.3 Tablet

Rail drops its labels (52 px). Thumbnails hide by default (toggle in the top bar). The page centres with equal margins. The panel opens as a 360 px sheet over the right of the page when something is selected, with a hard shadow and no scrim, so the page stays bright.

### 6.4 Phone

- **Shows list** sits above the tab level: top bar (title, sync, avatar), greeting, show cards one per row. No tab bar.
- **Inside a show**: bottom tab bar, 56 px plus the home-indicator inset, five tabs — Script · Cues · Docs · Activity · More. Active tab: icon and 11 px label in red (Flow's mobile convention). Inactive: `--muted` (not `--faint`; contrast in the venue matters more than quiet).
- Top bar 56 px (back chevron, title, one action) so 44 px targets fit.
- The page fills the width with the tags still in its margins. The tool strip becomes a single "Place cue" floating button, shown when nothing is selected. Selecting a cue opens the cue editor as a **bottom sheet** (20 px top radius, grab handle, covers the tab bar while open).
- Tables become cards (one row, one card: big mono number, label, page and trigger, flag pill). Swipe left on an activity row reveals Revert.
- Every target ≥ 44 px; nothing depends on hover; safe-area insets respected (Flow §15): the bottom inset under the tab bar, the top inset above the top bar, and the left and right insets (a notch in landscape) around the whole shell, the notices, the sheets and Calling mode. The shared Checkbox's hit area is 40 px with a mouse and 44 px on a touch screen.

## 7. Navigation

- Desktop and tablet: the rail is the whole navigation. Show-level destinations: Script, Cues, Docs, Activity, Exports; Shows and the account at the foot. Settings, members and tokens are reached from the show overview's footer links and the avatar menu.
- Phone: the tab bar inside a show; *More* holds Exports, Settings, Members, Personal access tokens, Shows, the offline card and the account.
- **⌘K** (desktop and tablet with a keyboard) jumps to a cue number, a page, a line of script or an action, in four fixed groups: Go to · Cues · In the script · Actions. Results never reshuffle into one ranked list.

## 8. Components

Binder uses the RVLT registry primitives (copied into `apps/web/src/components/ui`, shadcn convention): Button, Input, Textarea, Label, Select, Checkbox, Switch, Segmented, Tabs, Dialog, Sheet, Drawer (vaul), Popover, DropdownMenu, Tooltip, Kbd, Badge, Skeleton, Avatar. Notices are Binder's own (`Notices`, `pushNotice`), not sonner. There is no global stylesheet: styling is the three token and base files, Tailwind utilities, and `styles/markup.css` for what Tailwind cannot reach (the page's SVG objects, search hits, the drag ghost, presence avatars). Icons are lucide, 18 px in the rail, 16 px inline, stroke 1.8.

Binder-specific components (each has a mockup in the gallery):

| Component | Notes |
|---|---|
| **AppShell** | rail / top bar / content at desktop; icon rail at tablet; tab bar at phone; owns safe areas |
| **ContextPanel** | the one right panel (docked, slide-over or bottom sheet by width); tabs depend on the screen: Script (Cue, Layers, History, Review), Cue list (Cue, History) |
| **CueEditor** | department swatch + mono number + status pill; Number, Label, Type (segmented Go / Standby / Warn), Layer, Trigger (quote from the page, mono, left rule in the department colour), Notes; Delete (plain) and "edited by … · time" |
| **LayerRow** | swatch, name, count (mono), eye, lock; active layer has `--card` fill and `--sh-card` |
| **ToolStrip** | floating column on the stage: select, cue, highlight, note, rectangle, arrow, stamp, search; key hint in each corner; active tool is red |
| **CueTable / CueCard** | table at desktop and tablet, cards at phone; flags as pills with words (duplicate, approximate, unresolved); selected row has a red outline |
| **ActivityRow** | avatar, sentence (who, via agent in purple, what), meta line, mono time, Revert (with count when >10 rows) |
| **ReviewRow** | old and new thumbnails, quote and page change in words, Accept (red) / Move / Revert |
| **DocumentRow** | thumbnail, title, version and page count, status pills, actions; processing rows show a progress bar and the four steps (Upload → Extract text → Build word layer → Re-anchor), derived from what the data knows; a failed row says the plain reason and keeps the tool's own output behind "Details"; a cancelled row is neutral, not red |
| **SyncState** | dot plus word: Synced (ok), Syncing… n (warn), Offline (muted; the count of waiting changes is in the OfflineBanner, not here), Conflict n (red, not built: see ConflictCard) |
| **Presence** | stacked avatars; "In the binder now" list with document and page |
| **CommandPalette** | 640 px, 20 px radius, groups as in §7, current result with the red edge and ↵ hint, footer of keys in mono |
| **CallingStrip** | page ‹ n / N ›, next cue on the active department (swatch, code, mono number, label), Go to…, Exit |
| **GoToKeypad** | Cue / Page segmented, 40 px mono readout, live match line, 3 × 4 keys ≥ 64 px, wide red Go, Recent chips |
| **OfflineBanner** | the States sheet's banner: `--elev`, 2 px `--line-2`, radius 12, a wifi-off icon in `--muted`, "Offline. Changes are saved on this device — N waiting to sync." with N in mono. A polite status, never an alert. Drawn once, under the top bar of every signed-in screen, while the browser is offline; Calling mode's overlay covers it, since "offline, cached" is already that mode's calm state |
| **Notice (toast)** | an `--elev` card, 2 px `--line-2`, radius 12, the sticker shadow, bottom-right (above the tab bar on a phone); the action is a blue 600 link and × dismisses. A problem (a rejected write, an error) also has a 3 px red bar down its left edge; good news has none |
| **EmptyState** | an `.empty` card (`--card`, 2 px `--line-2`, `--r`, `--sh-card`): an optional icon tile or label, a 15 px / 600 heading, one `--ink-2` line, then optionally the Kalam line (`--ink-2`, never red) and one outlined action. Kalam appears nowhere else in a list |
| **Skeleton** | rows on the table's column widths (52 px · flexible · 44 px, 46 px high), solid `--elev` bars with a pulse and no gradient (Flow), under visually hidden "Loading…" text |
| **Confirm** | a 20 px-radius card, an 18 px Archivo title, one `--ink-2` sentence saying what goes and what stays recoverable, the destructive button red and last, the safe button beside it: "Keep" where a person's own thing is at risk (removing a member or an upload), "Cancel" where it only asks whether to go on |
| **ConflictCard** | designed (the States sheet) but not built: Binder has no conflict flow yet, since sync is last-write-wins with a rejection notice. Its sync word, "Conflict n", is likewise not drawn |

Required states for every interactive element are Flow's §9.1 (rest, hover, focus-visible red ring, active press, disabled, loading).

## 9. Modes

- **Markup**: everything above.
- **Calling**: entered from the top bar ("Calling mode") or ⇧C. Shows only a slim status line (red "Calling" pill, show · document · version, time, sync state) and the page at reading size, with the CallingStrip floating at the bottom. Page turn by tap on the page's left or right third, swipe, or ←/→. Nothing is editable. The keypad (GoToKeypad) is the only overlay. Offline and cached is the normal state here and reads as calm.

## 10. Keyboard

Global: ⌘K palette, ⌘P print (in a document), `g` go to page, `]` / `[` next / previous cue, `esc` closes the top overlay or clears selection. Script tools: `v` select, `c` cue, `h` highlight, `n` note, `r` rectangle, `a` arrow, `s` stamp, `/` search. Calling: ←/→ page, `g` keypad, ⇧C toggles Calling. Shortcuts are shown as key caps (`.kbd`) next to the actions they trigger.

## 11. Voice

Flow §9 applies. Binder specifics:

- Plain and direct wherever a cue, a revision, a conflict or a delete is involved. Say what happens and what is recoverable: "It goes from the page, the cue list and the cue sheet. Activity keeps a record so it can be reverted."
- Name people and agents: "Oli moved LX 12 to p.2 while you were offline." "Jayden via Claude Code placed 42 LX cues."
- Kalam appears only in greetings, the sign-in card and empty states ("the book is where you left it", "the quiet before the pad comes in"), in `--ink-2`, never red except on the shows home's empty-show card.
- Offline is a state, not an error: "Offline. Changes are saved on this device — 3 waiting to sync."

## 12. Accessibility

Everything M1 built stays: tags are focusable buttons with full accessible names (department, type, number, label, trigger), keyboard selection and movement, labelled controls, live regions for sync and notices. On top of Flow's rules:

- Focus is always visible (red 2 px ring offset on the surface).
- Dialogs, sheets and the palette trap focus and return it on close (Radix).
- Status is colour plus a word, every time.
- Contrast: body text on espresso ≥ 4.5:1; inactive tab labels use `--muted`.
- Reduced motion: no transitions on sheets or presses.

## 13. The mark

The Binder mark is a monoline B on the RVLT red tile whose two bowls are the rings of a binder on the spine (Jayden's pick, "Rings", 2026-10-16). Geometry (512 tile): stem `M170 131V381` at stroke 50, bowls `M170 131H262A60 60 0 0 1 262 251H170M170 251H282A65 65 0 0 1 282 381H170` at stroke 44, round caps and joins, ink `#F5EFE2` on red `#E0363D`, tile radius 116. Built by `apps/web/scripts/make-icons.mjs` (favicon.svg, 32 px favicon, 192/512 icons, full-bleed maskable 512, 180 px apple-touch-icon) and drawn in the app by `BinderMark`.

Lockups: in the app header, the tile and "Binder" in Archivo 800 with a "by RVLT" chip where there is room; the product lockup "RVLT BINDER" follows "RVLT FLOW" (RVLT letters in red, product in ink); the bare mark in page ink for print footers.

## Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-10-15 | "Prompt corner" direction; page is paper; department colour only on the page; two modes, one layout | Binder is used in the dark and the page is the work |
| 2026-10-15 | Cue tags are Binder's own pills with underlines, not Cuelist's barred tags | Jayden: "I don't wanna exactly mimic Cuelist" |
| 2026-10-15 | Fully mobile: tab bar inside a show, bottom sheet, cards for tables | Jayden: "I want the app's design to be fully mobile friendly" |
| 2026-10-16 | Rings B as the app icon | Jayden's pick from six concepts |
| 2026-10-16 | ~~Registry components win over mockup shapes (pill buttons)~~ superseded the same day | — |
| 2026-10-16 | Mockups are the binding visual standard: their button shape, red usage, copy and layout win over the registry and over the one-red-per-view rule | Jayden: "make sure the designs are fully compliant with the mockups" |
| 2026-10-16 | New department defaults retuned for ink on paper; red refused in the picker | Red is RVLT's alert colour and the M1 SM default was red |
| 2026-10-16 | Inactive phone tab labels use `--muted`, not `--faint` | ~3:1 contrast is too low in a dark venue (an accessibility floor, kept under the mockup rule) |
| 2026-10-16 | Fonts self-hosted | the installed app must render correctly offline |
| 2026-10-16 | Red-guard threshold is ΔE76 < 20, not < 10 (R1) | at 10 the guard passes `#D0021B`, the red that motivated it; 20 still allows coral |
| 2026-10-16 | The display utility is Flow's `font-display`, not `font-disp` (R6); Flow's fixed cream tokens stay (R7) | Flow's component class names must resolve unchanged, and the copied button's `cream` variant uses them |
| 2026-10-16 | Sign out asks only when uploads are still waiting, and the in-app confirm replaces `window.confirm` for that (R9) | clearing the local database loses queued changes; with nothing waiting there is nothing to ask |
| 2026-10-16 | Links the shell replaces ("← Show", in-page Settings · Activity · Exports) are removed from pages (R10); the show index keeps its Settings link (R13) | the rail and crumbs are the navigation; Settings is not a rail item |
| 2026-10-16 | Kbd is restyled onto Binder tokens (R11) | the registry's class names resolve to no token in any theme |
| 2026-10-16 | Rail labels are 11 px, not the mockup's 10 px (R12); §6.2 corrected | the 11 px floor outranks the mockup |
| 2026-10-16 | Document processing shows only what the data knows: queued, processing, ready or failed, and per-page status; the four steps are derived and the bar is ready pages over page count, with no invented size figure (R14) | a step line that claims more than the pipeline reports would be a guess |
| 2026-10-16 | The empty-show action is "Start a show" and an unarchived show wears the green "Active" pill (R15) | "New show" would be a second control with the top bar's name; "live" is red's word and a show that is merely open is not live |
| 2026-10-16 | A failed version shows a plain sentence with the tool's output behind "Details" (R16); a first upload's "Upload again" opens a new version of the same document (R17); a cancelled version is neutral, not red (R34) | plain voice; no duplicate or undeletable rows; cancelling is the person's own choice |
| 2026-10-16 | Tool keys v h n r a s / are real (R18); ⌘P prints inside a document (R35); ⇧C toggles Calling mode (R41) | §10 specifies them and a hint for a dead key would lie |
| 2026-10-16 | The stamp picker and cue type are inline flyouts beside their tool (R19) | a portalled popover dismisses on the placing click |
| 2026-10-16 | Thumbnails are 62 px wide in a 92 px column and Snap lives in the status bar (R22); the script's top bar is the markup mockup's, with Upload revision inside "…" (R39) | that is the mockup's geometry |
| 2026-10-16 | Mockup copy wins over an e2e-pinned name (the tests change in the same commit), and the only departures from a mockup are the floors, accessible names the tests cannot reasonably change, and data Binder lacks, each listed where it happens (R20, R21) | the binding-standard decision above, applied |
| 2026-10-16 | The overview's right column follows the mockup at every width, with DOM order equal to visual order at each width (R21) | assistive reading order must match what is seen |
| 2026-10-16 | Notes and stamps match the mockup on screen and in print (R23), and a right-side cue note aligns to the tag's outer end (R27) | screen and print stay identical, and the note stays inside the margin column |
| 2026-10-16 | The phone context drawer is genuinely non-modal (R25) | the page behind stays in the accessibility tree and a pointer user can still tap it |
| 2026-10-16 | Byte sizes drop a trailing ".0" ("12 MB") (R26) | the mockup's own figure |
| 2026-10-16 | Where mockup copy states a permission Binder does not grant, accurate copy wins (R31) | settings must not misstate permissions (members: editors work in the departments they are given) |
| 2026-10-16 | A new personal access token is shown once in full in the app; only screenshots and mockups mask it (R32) | the one chance to copy it; a real secret must never be in a capture |
| 2026-10-16 | The print dialog has no "Clean copy" preset or "Footer layers" line (R33); the preview uses the paper's real proportions in the mockup's slot | the print mockup has neither; unticking layers still makes a clean copy |
| 2026-10-16 | For a cue-shaped palette query ("lx 12") the In-the-script group searches the number part (R36) | as the palette mockup draws it |
| 2026-10-16 | The keep-offline switch has a "paused" state line, and an empty shows list is never passed to the runner (R37, R38) | it states the runner's real status in words; a prune is irreversible |
| 2026-10-16 | Calling mode makes the shell inert; the phone strip's Exit button, 44 px targets over the mockup's 40, token colours over its slightly darker values and a page whose width is capped at 0.9 × stage height (so it can be taller than the stage) are accepted (R41) | the touch floor and the tokens outrank the mockup's numbers |
| 2026-10-16 | Offline is a muted banner and a notice, never an alert; the conflict card and "Conflict n" are designed but not built (task 15a) | Binder has no conflict flow; sync words stay Synced, Syncing… n, Offline |
| 2026-10-16 | The shell honours all four safe-area insets, and touch screens (`pointer: coarse`) get 44 px hit areas on the tool strip and the Checkbox, with the strip scrolling instead of shrinking (task 15a) | a notched phone in landscape clipped the rail; iPad mini in landscape got 32 px buttons |
| 2026-10-16 | `styles.css` is gone: tokens, base, Tailwind utilities and `markup.css` carry all styling (task 15a) | one source for colour, and no literal hex outside data |
| 2026-10-16 | `Segmented` is an accessible radio group: `role="radiogroup"` with `role="radio"` items and `aria-checked` (R5) | the contract is the pattern a screen reader knows, not the library under it |
| 2026-10-16 | A document no version of which can be read says so in its own words and names the way through: remove the upload and upload the file again as a new document with Text recognition set to Never, then mark it up by position (R44) | accurate to what Remove leaves; the API has no new surface for it |
| 2026-10-16 | The print dialog's Segmented controls (pages, paper), its file name and its preview, which R19 left out as unbuilt, were built with the print options (Feature 2); the stamp picker and cue type stay inline flyouts | R19's reason (no page-range or paper choice) no longer held once the options existed; the flyout half stands |
| 2026-10-16 | The top bar's sync word is "Offline" with no count; "N waiting to sync" lives in the OfflineBanner, a live region that stays mounted so its arrival is announced (R47) | the states mockup draws it so (R21); tests read the count from `data-pending` |
| 2026-10-16 | Search hits on the page use fixed page colours (a yellow wash, an orange active hit), never a theme token or a department's colour | the page is white in every theme and a department colour on it means that department's own markup |
