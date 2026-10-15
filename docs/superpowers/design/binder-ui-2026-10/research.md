# Binder UI/UX research brief

Date: 2026-10-15. For Jayden. Input to the first design pass after M1 went live.

## What Binder is today

Every M1 capability works and is tested, but the interface is functional scaffolding: system font on a near-white page, a one-line header, plain lists and links, unstyled forms. There is no visual identity, no navigation structure beyond links in paragraphs, and screens do not share a layout. Someone opening it does not know where to start.

## Where the design comes from

### 1. RVLT Flow is the sibling, and it already has a design system

Flow (`~/rvltflow/gearflow`, `DESIGN.md` v1.1.1, registry `rvlt-labs.github.io/rvlt-designlanguage`) defines the RVLT product look. Binder should read as the same family without being a copy of a logistics tool.

Inherited as law:
- Dark espresso surfaces by default (`--paper #141210` → `--card #211C17` → `--elev #2A241D`), light "Paper" as opt-in.
- One brand accent, RVLT red `#E0363D`, for primary, live, active and alert. Red is never a department or module colour.
- Warm off-white text (`--ink #F5EFE2`), hard offset shadows (no blur), 2 px outlines, 14 px radius.
- Type: Archivo (display, 800), Hanken Grotesk (UI), Geist Mono (numbers, ids, cue numbers), Kalam only for handwritten personality moments.
- 11 px floor, sentence case everywhere, 4 px grid, status encoded by colour and label.
- Personality allowed in empty states and onboarding; banned in alerts, conflicts, destructive confirmations.
- Eight module hues for wayfinding and avatars: blue, purple, amber, teal, coral, green, pink, lime.

Where Binder must differ:
- The script page is paper. The page always renders as the PDF's own white, with the dark chrome around it. Markup colours are department colours and must read against white paper, so the department palette is tuned for ink-on-paper, not for dark UI.
- Binder is used in the dark (tech table, FOH, a bio box) more than Flow is. Dark default is not a brand choice here, it is the working condition. Light "Paper" mode is for printing-adjacent review and daytime prep.
- Flow's module hues map to Binder's departments only loosely. Departments keep their own user-set colours (LX amber, SND blue, TM purple… as seeded in M1), and those are the colours on the page, in the layer panel and on cue tags. The nav uses a smaller set of module hues: Script (blue), Cues (amber), Documents (teal, M2), Activity (purple), Exports (green).

### 2. Cuelist, the thing to beat

Jayden's four rendered scripts show the house style of a calling script, now reproduced in M1's margin markers: a tag in the margin (bar, code, number), the trigger words highlighted, a leader joining them, departments on their own side. Cuelist's weaknesses, in Jayden's words and from using it: no real-time collaboration, no versioning, scanned PDFs are dumb images, documentation lives elsewhere. Its strength is that the marked page looks like the paper a stage manager would hand you. Binder keeps that. On screen the page must look like the printout.

### 3. Mobbin patterns worth adopting (structure only, never their styling)

- **Editor shell**: Magnific, Jitter, Riverside, Descript — a slim icon rail on the left, the canvas in the middle, one context panel on the right that changes with the selection, a small top bar with breadcrumbs, collaborators and the primary action. Binder's document screen adopts this.
- **Layers with visibility and lock**: VEED and Jitter's track lists — a row per layer with a colour swatch, name, eye and lock. Binder's layer panel is this with department colours.
- **Version history as a side panel**: Framer, Fibery, Sana — a list of changes on the right with a Restore action per entry, never a separate page for row history. Binder's History tab already does this; the activity feed becomes the same panel at show level.
- **Review queue with before/after thumbnails**: Figma's compare changes, Semrush's side-by-side — exactly the re-anchoring review panel M1 built, now given a visual row layout.
- **Dense table with a detail side panel**: Twenty, Neon, Airwallex — the cue list becomes a table with inline editing and a right-hand detail panel for the selected cue, instead of a page per cue.
- **Command palette**: Superhuman, Magnific, Vapi — one ⌘K for jump to cue number, jump to page, search text, run actions. Binder has `g` for page and `]`/`[` already; a palette unifies them.
- **Projects home as cards**: Vercel, Obvious, Frame.io — shows as cards with status, who is in, last activity. Binder's home becomes this.
- **iPad reading**: Apple Books, Matter — chrome fades, the page is the whole screen, a floating tool strip. This informs the "Calling" mode for use in the venue.

### 4. The job to be done, in order of time spent

1. Mark up a script: read, place cues, move them, note things. Hours. Mostly on a laptop at a desk during prep, then an iPad in the room.
2. Call or follow the show: read the marked script at speed, in the dark, with one hand. Must never lose the page. No edits.
3. Build and check: cue lists, renumbering, printing, exports, revisions. Minutes at a time, between sessions.
4. Collaborate: see what LX changed, revert the thing that broke, know who is in the binder.

The interface is ordered the same way: the script view gets the most design effort, then a "Calling" mode, then the lists and panels, then the home.

## The design direction (for Jayden to react to)

**"Prompt corner."** The place in a theatre where the stage manager sits with the book, the cue lights and the headset. Dark, calm, everything within reach, the script lit and everything else dimmed. Confident and quick. The same dry RVLT voice as Flow in empty states and tooltips, plain and direct everywhere a cue is involved.

Concrete rules proposed on top of Flow's:
- The page is the brightest thing on screen. Chrome never competes with it: no bright panels beside the page, controls are muted until hovered or focused.
- Department colour is the only colour on the page. UI chrome stays monochrome espresso plus red for the one primary action.
- Cue numbers are always Geist Mono, tabular, so columns of numbers line up on the page, in tags, in lists and in sheets.
- A "Calling" mode strips the chrome to the page, the page number, and a floating go-to strip. Keyboard and a single-tap page turn. Nothing editable.
- Presence is quiet: avatar initials in the department's colour tint on thumbnails and page corners, never animated, never a toast.

## Screens in the first pass (mockups attached)

1. Shows home
2. Show overview (documents, cue lists, who is in, recent activity)
3. Script markup (the main screen), desktop
4. Script markup, iPad "Calling" mode
5. Cue list with detail panel
6. Activity and row history panel
7. Revision review panel

Out of this pass: settings, tokens, login, exports screen (they take the system once it exists).
