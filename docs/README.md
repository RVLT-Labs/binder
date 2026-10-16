# Binder docs

A map of everything under `docs/` and where the other documents live. For an overview of the repo and how to
work in it, start with `CLAUDE.md` at the repo root.

## Where to look

| You want | Go to |
|---|---|
| What Binder is and why | `superpowers/specs/2026-10-14-binder-platform-design.md` |
| What changed, and what is open | `../CHANGELOG.md` |
| Why something is the way it is | `superpowers/records/` (one record per milestone: rulings, deferred items, final reviews) |
| The design system and its decisions | `../DESIGN.md` (decisions log at the end) |
| How to connect an agent or client over MCP | `mcp.md` |
| How an agent should use Binder (cues, revisions, exports, safety) | `../skills/binder/SKILL.md` and its `references/` (also served as `binder://skill/index`) |
| House cue style, mic and DCA practice, the `.tmix` format | `guides/` (served as `binder://guides/*`) |
| Deploying, secrets, backups, smoke tests | `../deploy/README.md` |
| The UI mockups | `superpowers/design/binder-ui-2026-10/` (see its README) |

## Specs, plans and records

Work moves through three kinds of document:

| Kind | Folder | What it holds |
|---|---|---|
| Spec | `superpowers/specs/` | What to build and why. The platform spec, then one per feature. |
| Plan | `superpowers/plans/` | The task-by-task plan for a milestone, written from a spec. |
| Record | `superpowers/records/` | What actually happened: the rulings made while building, deferred items, the final review, known issues. |

| Milestone | Spec | Plan | Record |
|---|---|---|---|
| M0 foundation | `2026-10-14-binder-platform-design.md` | `2026-10-14-m0-foundation.md` | `2026-10-15-m0-rulings.md`, `2026-10-15-m0-final-review.md` |
| M1 script markup | (platform spec) | `2026-10-15-m1-script-markup.md` | `2026-10-15-m1-rulings.md` |
| Cue margin markers | `2026-10-15-cue-margin-markers.md` | (small, no plan) | (in the spec) |
| UI restyle and four features | `2026-10-16-ui-restyle.md`, `2026-10-16-mockup-features.md` | `2026-10-16-ui-restyle.md` | `2026-10-16-ui-restyle-rulings.md` |

The roadmap after M1 is in section 10 of the platform spec: M2 the show graph (people, characters, casting, mics,
the mic plot, book of faces, contact sheet, snapshots), M3 TheatreMix (allocator, `.tmix` writer and reader,
export records), M4 polish and exports (run sheets, share links, duplicate show, OSC, Eos and QLab export as
scope allows). Per-department cue sheets already shipped in M1. The next milestone starts with a spec.

## Conventions

- A decision that a future session needs belongs in a record or in `DESIGN.md`'s log, never only in a
  git-ignored scratch folder (`.superpowers/`).
- Ruling IDs (`R1`, `M1-R7`...) are stable: refer to them by ID, and say "supersedes Rn" on both entries when
  one changes another.
- Real shows (and anything with real cast names) are never committed. Examples use the public-domain
  Gilbert and Sullivan fixtures.
