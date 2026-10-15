# Design System — Binder

Binder, by RVLT. Version 1.0, 2026-10-16. Approved by Jayden ("I like the design language", 2026-10-16) from the mockups in `docs/superpowers/design/binder-ui-2026-10/` (published as the *Binder UI direction* artifact).

## 0. How this document works

Binder is a sibling of RVLT Flow and inherits **RVLT Flow's `DESIGN.md` v1.1.1** (`~/rvltflow/gearflow/DESIGN.md`, registry `rvlt-labs.github.io/rvlt-designlanguage`) as law: tokens, type, spacing, radius, hard shadows, motion, required interactive states, status system, personality rules, mobile touch rules. This document records only:

- what Binder adds that Flow has no need for (the script page, cue markup, calling mode, the cue editor), and
- where Binder deliberately differs, each with the reason.

When this document is silent, Flow's is the answer. When a mockup and Flow's registry disagree on a component's shape or size (buttons are the main case: the mockups drew small rounded rectangles, the registry has pills), **the registry wins**: Binder must sit beside Flow as one family.

## 1. Product context

Binder is the stage manager's binder, digital: script and score PDFs, cues per department marked on the page, cue lists, documents, history with revert, revisions with re-anchoring, and an MCP surface for agents. It is used in four situations, in order of time spent: marking up a script (hours, laptop then iPad), calling or following a show (in the dark, one hand, no edits), building and checking lists and exports (minutes, between sessions), and collaborating (who changed what, revert). The interface gives design effort in that order.

## 2. Aesthetic direction: "Prompt corner"

The prompt corner is where the stage manager sits with the book, the cue lights and the headset: dark, calm, everything in reach, the script lit and everything else dimmed. Confident, quick, quiet. The RVLT voice (dry, warm) appears only in greetings and empty states.

Three rules are Binder's own and outrank everything below:

1. **The page is paper.** A script page always renders as the PDF's own white (`--page`), in both themes, and is the brightest thing on screen. Chrome never competes with it: no bright panels beside the page, and controls stay muted until hovered or focused.
2. **Department colour is the only colour on the page.** Markup is drawn in department colours tuned to read as ink on white. Chrome around the page stays monochrome espresso plus RVLT red for the one primary action. Presence uses a person's colour, never a department's.
3. **Two modes, one layout.** *Markup* is the full shell. *Calling* strips it to the page, the page number and a floating strip; nothing in Calling is editable. Both draw the page identically, so what you mark is what you call and what you print.

## 3. Typography

Flow's stack, unchanged: Archivo 800 (display, `--disp`), Hanken Grotesk (UI, `--sans`), Geist Mono (`--mono`), Kalam (`--hand`, personality only). Binder self-hosts all four (no font CDN) so the installed app renders correctly offline.

Binder additions:

- **Every cue number, page number, version, time, count, file name and key cap is Geist Mono with tabular figures**, everywhere: tags on screen, tables, cards, the palette, the keypad, history rows. Columns of numbers must line up.
- **The script's own text is never restyled.** Binder draws over the PDF; it never reflows or re-fonts it.
- **Markup type on the page** (tag lead and number, stamps, notes) is Helvetica-metric (`helveticaWidth` in core) on screen and Helvetica in print, so screen and paper measure identically. This is the one place Binder's UI fonts are not used, by design.
- 11 px floor, sentence case everywhere, uppercase only for over-labels with letter-spacing (Flow §Type Rules).

## 4. Colour

### 4.1 Chrome

Flow's espresso tokens verbatim (`--paper #141210`, `--paper-2 #1A1613`, `--card #211C17`, `--elev #2A241D`, `--ink #F5EFE2`, `--ink-2`, `--muted`, `--faint`, `--line`, `--line-2`, `--red #E0363D`, `--red-700`, status `--ok`/`--warn`, module hues, `--sh-card`, `--sh-hover`, `--sh-stk`, `--lit`). Dark is the default because Binder's working condition is the dark (tech table, FOH, a bio box). Flow's light "Paper" theme is the opt-in for daytime prep and print-adjacent review; it changes chrome only, never the page.

Red is the single primary action per view, live/active state ("Calling", the active phone tab, the selected cue), and alerts. **Red is never a department colour** and never decoration.

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

- **Rail** 56 px, `--paper-2`, right rule `--line`. Top: the Binder mark (28 px). Items 44 × 44, icon over an 10 px label. Module hues: Script blue, Cues amber, Docs teal, Activity purple, Exports green; the active item takes its hue's soft fill and colour with `--sh-card`. Foot: Shows, then the user's avatar.
- **Top bar** 44 px, `--paper`, bottom rule `--line`: breadcrumbs (show / document, current item bold), version chip, then on the right sync state, presence avatars, secondary actions, and the one red primary.
- **Content** on `--paper`, 28–32 px padding, sections labelled with Flow's section-label (over-label plus rule).
- **Script screen**: thumbnails column (96 px) · the page centred on a `#0E0C0A` stage with a floating tool strip at its left edge · the right panel (340 px, `--paper-2`, tabs Cue / Layers / History / Review). A 28 px status bar at the bottom: page n of N, snap state, active layer, the four shortcuts people forget (`c` `]` `g` `⌘K`).

### 6.3 Tablet

Rail drops its labels (52 px). Thumbnails hide by default (toggle in the top bar). The page centres with equal margins. The panel opens as a 360 px sheet over the right of the page when something is selected, with a hard shadow and no scrim, so the page stays bright.

### 6.4 Phone

- **Shows list** sits above the tab level: top bar (title, sync, avatar), greeting, show cards one per row. No tab bar.
- **Inside a show**: bottom tab bar, 56 px plus the home-indicator inset, five tabs — Script · Cues · Docs · Activity · More. Active tab: icon and 11 px label in red (Flow's mobile convention). Inactive: `--muted` (not `--faint`; contrast in the venue matters more than quiet).
- Top bar 56 px (back chevron, title, one action) so 44 px targets fit.
- The page fills the width with the tags still in its margins. The tool strip becomes a single "Place cue" floating button, shown when nothing is selected. Selecting a cue opens the cue editor as a **bottom sheet** (20 px top radius, grab handle, covers the tab bar while open).
- Tables become cards (one row, one card: big mono number, label, page and trigger, flag pill). Swipe left on an activity row reveals Revert.
- Every target ≥ 44 px; nothing depends on hover; safe-area insets respected (Flow §15).

## 7. Navigation

- Desktop and tablet: the rail is the whole navigation. Show-level destinations: Script, Cues, Docs, Activity, Exports; Shows and the account at the foot. Settings, members and tokens are reached from the show overview's footer links and the avatar menu.
- Phone: the tab bar inside a show; *More* holds Exports, Settings, Members, Personal access tokens, Shows, the offline card and the account.
- **⌘K** (desktop and tablet with a keyboard) jumps to a cue number, a page, a line of script or an action, in four fixed groups: Go to · Cues · In the script · Actions. Results never reshuffle into one ranked list.

## 8. Components

Binder uses the RVLT registry primitives (copied into `apps/web/src/components/ui`, shadcn convention): Button, Input, Textarea, Label, Select, Checkbox, Switch, Tabs, Dialog, Sheet, Drawer (vaul), Popover, DropdownMenu, Tooltip, Kbd, Badge, Skeleton, Avatar, toasts (sonner). Icons are lucide, 18 px in the rail, 16 px inline, stroke 1.8.

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
| **DocumentRow** | thumbnail, title, version and page count, status pills, actions; processing rows show a progress bar and the four steps (Upload → Extract text → Build word layer → Re-anchor) |
| **SyncState** | dot plus word: Synced (ok), Syncing… n (warn), Offline (muted), Conflict n (red) |
| **Presence** | stacked avatars; "In the binder now" list with document and page |
| **CommandPalette** | 640 px, 20 px radius, groups as in §7, current result with the red edge and ↵ hint, footer of keys in mono |
| **CallingStrip** | page ‹ n / N ›, next cue on the active department (swatch, code, mono number, label), Go to…, Exit |
| **GoToKeypad** | Cue / Page segmented, 40 px mono readout, live match line, 3 × 4 keys ≥ 64 px, wide red Go, Recent chips |
| **OfflineBanner, ConflictCard, Toast, EmptyState, Skeleton** | as in the gallery's States sheet; skeleton is a solid `--elev` pulse with no gradient (Flow) |

Required states for every interactive element are Flow's §9.1 (rest, hover, focus-visible red ring, active press, disabled, loading).

## 9. Modes

- **Markup**: everything above.
- **Calling**: entered from the top bar ("Calling mode") or ⇧C. Shows only a slim status line (red "Calling" pill, show · document · version, time, sync state) and the page at reading size, with the CallingStrip floating at the bottom. Page turn by tap on the page's left or right third, swipe, or ←/→. Nothing is editable. The keypad (GoToKeypad) is the only overlay. Offline and cached is the normal state here and reads as calm.

## 10. Keyboard

Global: ⌘K palette, `g` go to page, `]` / `[` next / previous cue, `esc` closes the top overlay or clears selection. Script tools: `v` select, `c` cue, `h` highlight, `n` note, `r` rectangle, `a` arrow, `s` stamp, `/` search. Calling: ←/→ page, `g` keypad, ⇧C toggles Calling. Shortcuts are shown as key caps (`.kbd`) next to the actions they trigger.

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
| 2026-10-16 | Registry components win over mockup shapes (pill buttons) | Binder sits beside Flow as one family |
| 2026-10-16 | New department defaults retuned for ink on paper; red refused in the picker | Red is RVLT's alert colour and the M1 SM default was red |
| 2026-10-16 | Inactive phone tab labels use `--muted`, not `--faint` | ~3:1 contrast is too low in a dark venue |
| 2026-10-16 | Fonts self-hosted | the installed app must render correctly offline |
