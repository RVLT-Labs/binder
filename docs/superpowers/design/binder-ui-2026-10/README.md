# Binder UI mockups (2026-10)

The approved visual direction ("Prompt corner") for Binder, drawn as HTML at real size. **These mockups are the
binding visual standard for the app's look and layout** (ruling R20 in
`docs/superpowers/records/2026-10-16-ui-restyle-rulings.md`; `DESIGN.md` section 0). Build to them, and record any
deliberate difference in the decisions log at the end of `DESIGN.md`.

| File | What it is |
|---|---|
| `index.html` | The gallery: 29 screens, generated. Open it in a browser. |
| `mark.html` | The app-icon concept sheet (the chosen icon is the plain "Rings B" on the red tile). |
| `research.md` | The direction and its rules. Read this first. |
| `_head.html`, `_fonts.css` | Every CSS class the mockups use: this is the system in miniature. |
| `_parts.py` | Shared helpers (icons, rail, top bar, presence, script page). |
| `_build.py` | Assembles `index.html` from `_head.html` and the screens below. |
| `screens2_access.py` | Sign in, new show, show settings, tokens. |
| `screens2_documents.py` | Documents, compare, exports, print. |
| `screens2_overlays.py` | Command palette, go-to keypad, phone calling, phone home, states. |
| `screens2_mobile.py` | Phone and tablet screens (`m-*`, `t-markup`). |
| `_preview.py`, `_shot.mjs` | Render one module on its own; screenshot every frame to PNGs. |
| `_mark.py` | Builds `mark.html`. The SVG geometry there is the master for the real icon assets (`apps/web/scripts/make-icons.mjs`). |
| `_brief-common.md` | The brief that was given to authors of new screen modules. |

## Screen ids

Desktop: `home`, `show`, `markup`, `calling`, `cues`, `activity`, `review`, `login`, `newshow`, `settings`,
`tokens`, `docs`, `compare`, `exports`, `print`, `palette`, `goto`, `states`.
Phone: `phone-calling`, `phone-home`, `m-login`, `m-show`, `m-markup`, `m-cues`, `m-activity`, `m-docs`, `m-more`,
`m-settings`. Tablet: `t-markup`.

## Rebuilding and looking at a screen

```bash
cd docs/superpowers/design/binder-ui-2026-10
python3 _build.py                                   # rewrites index.html
python3 _preview.py screens2_access                 # one module on its own -> _preview_screens2_access.html
node _shot.mjs "$PWD/index.html" /some/out/dir      # one PNG per screen id (needs `pnpm install` at the repo root)
```

`_shot.mjs` finds Playwright in this checkout's `apps/web`, so it works from any directory or worktree. Biome
ignores this folder. To compare the built app with a mockup, render the PNG at the same size and look at both
side by side; the app's responsive e2e (`apps/web/e2e/responsive.spec.ts`) covers the mechanical parts.

## Published copies

The gallery and the icon sheet were also published as private Claude artifacts ("Binder UI direction" and
"Binder mark") on Jayden's account for review. They are copies; this folder is the source.
