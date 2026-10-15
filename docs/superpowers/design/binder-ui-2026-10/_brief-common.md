# Binder UI mockup — common brief for screen modules

You are adding screens to an existing, approved UI direction for Binder (by RVLT), a script-markup app for musical theatre: stage managers and designers mark cues on a PDF script, call the show from it, and keep cue lists. Jayden (the owner, a theatre sound designer) has seen the first seven screens and said "I like the design so far. Keep building other surfaces." Match them exactly in look, density and voice. React to the direction, don't invent a new one.

## Read first, in this order
1. `research.md` — the direction ("Prompt corner") and the rules.
2. `_head.html` — every CSS class that exists. Use these classes; they are the system. Skim all of it.
3. `_parts.py` — shared helpers: `ICON` (inline SVG icons), `rail(active, foot)`, `topbar(crumbs, right)`, `presence(...)`, `script_page(...)` (the marked-up script page), `wrap(...)`.
4. `_build.py` — the seven existing screens. Read `screen_home`, `screen_show`, `screen_markup` and `screen_cuelist` closely: that is the pattern (a `frame` div, the rail, a topbar, a `content` main, cards, tables, the right `panel`). Screen functions are importable: `from _build import screen_markup` etc.

## The rules (from research.md and RVLT Flow's DESIGN.md), non-negotiable
- Dark espresso chrome by default (`--paper`, `--card`, `--elev`), warm ink, hard offset shadows (`--sh-card`, `--sh-stk`), 2 px outlines, 14 px radius on cards, 20 px on sheets.
- One accent: RVLT red (`--red`) for the single primary action, live/active states, and alerts. Red is never a department colour and never decoration.
- Department colour is the only colour on a script page: LX amber, SND blue, TM purple (page-ink variants `--lx`, `--snd`, `--tm`; chrome tints `--amber`, `--blue`, `--purple`). Chrome otherwise stays monochrome.
- Type: Archivo 800 for display (`--disp`), Hanken Grotesk for UI (`--sans`), Geist Mono for every number, id, cue number, time and key (`--mono`, tabular). Kalam (`.hand`) only for personality in empty states and onboarding; never in alerts, conflicts or destructive confirmations.
- Sentence case everywhere. 11 px floor. 4 px grid. Status is always colour plus a word (a pill with text), never colour alone.
- The page is the brightest thing on screen; chrome never competes. Presence is quiet: initials in the person's colour, never animated.
- Voice: plain and direct wherever a cue is involved; dry and warm in empty states and greetings.
- Real content only. No lorem ipsum, no placeholder boxes with an X through them, no fake brand logos.

## The world (use these names and numbers, consistently)
- Company: Two Toned Productions. People: Jayden (JN, `av-amber`, owner), Oli (OL, `av-teal`, SND, editor), Mikaela (MK, `av-blue`, LX, editor), Alex R (AR, `av-purple`, viewer). Agents: "Claude Code" (shown as "via Claude Code" in purple, acting as Jayden).
- Shows: The Pirates of Penzance (Running, opened 3 Oct, Libretto v3, Piano-vocal v1, 412 cues); Songs for a New World (Rehearsal, opens 24 Oct, Libretto v2 current 43 pages + v1, Piano-vocal score v1 188 pages scanned with OCR layer, 96 cues: LX 61 with 2 duplicate numbers, SND 28, TM 7, 4 cues to review after the v2 revision); Little Women (Prep, opens 14 Nov, Libretto v1, 0 cues). Archived: American Idiot, The Hunger Games.
- Departments available to add: SM, VID, STG, FLY, PYRO. Number formats: `10.5` (decimal) or `10.50` (point). Marker side per department: left or right (default left). Roles: Owner, Editor, Viewer.
- Cue types: go, standby, warn. Flags: duplicate, approximate, unresolved. Times are 24 h (`14:02`), today's date is 15 Oct 2026.
- Binder works offline: documents are cached on the device, edits queue and sync, exports made offline are "waiting to upload".
- Sign-in is email + password, with "email me a link instead" when the server can send mail.

## Module contract
- Write one file, `screens2_<theme>.py`, next to `_build.py`. Start with `from _parts import *`. You may also `from _build import <screen fn>` to reuse a whole existing screen as a base layer under an overlay.
- Define `CSS = """..."""`: only NEW rules, every new class prefixed with your theme prefix (given in your task). Never redefine or restyle an existing class from `_head.html`; compose with them.
- Define `SCREENS = [(id, kicker, title, blurb, notes, fn, w, h), ...]` using the ids and sizes given in your task. `kicker` is like `"08 · 1280 × 800"`. `blurb` is one or two sentences for Jayden. `notes` is a list of 3–5 short HTML strings starting with a `<b>bold lead.</b>` explaining a decision, exactly like the existing screens.
- Each `fn()` returns the frame: `'<div class="frame" style="width:{w}px;height:{h}px">' ... '</div>'`. Desktop screens are 1280 × 800 and use `rail(...)` + `topbar(...)` + `<main class="content">`. iPad frames are 992 × 744 on `background:#0A0908` (see `screen_calling`). Phone frames are 390 × 844.
- Do not edit `_build.py`, `_parts.py`, `_head.html`, `index.html`, or anything outside this folder. Do not commit. Do not spawn subagents.

## Check your work by looking at it
1. `cd /Users/jayden/cueapp/docs/superpowers/design/binder-ui-2026-10 && python3 _preview.py screens2_<theme>` → `_preview_screens2_<theme>.html`.
2. `mkdir -p <outdir> && node _shot.mjs /Users/jayden/cueapp/docs/superpowers/design/binder-ui-2026-10/_preview_screens2_<theme>.html <outdir>` → one PNG per screen id.
3. Open every PNG with the Read tool and look hard: overlapping or clipped text, text invisible against its background, misaligned columns, elements outside the frame, a red element that is not the one primary action, a number not in mono, a Kalam line in an alert. Fix, rebuild, re-shoot, look again. Do at least two passes. Your report must say what you saw and fixed.

## Report
Write `<outdir>/report.md`: the screens, the decisions you made where the brief left a choice, anything you could not resolve. Return only: status (DONE / DONE_WITH_CONCERNS / BLOCKED), the module path, the PNG paths, one line of what you checked, and concerns.
