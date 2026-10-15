#!/usr/bin/env python3
"""Build mark.html: icon concepts for Binder, each drawn once as SVG geometry and shown at every size it has to work at.

Geometry is in a 512 × 512 tile. The letter is a monoline B with round caps, the same construction as the RVLT wordmark's
letters (stem 74/450 ≈ 0.16 of cap height), so the mark and the wordmark read as one family.
"""
from pathlib import Path

HERE = Path(__file__).parent
head = (HERE / "_head.html").read_text().replace("<title>Binder UI direction</title>", "<title>Binder mark</title>", 1)

RED = "#E0363D"
INK = "#F5EFE2"
ESP = "#141210"
PAPER = "#F5EFE2"

# ---------- the letter, as reusable symbols (all stroke/fill = currentColor) ----------
# Stem centreline x=170, y 131→381 (visual 106→406 with the 50 cap). Top bowl r=60, bottom bowl r=65.
SYMBOLS = f'''
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <clipPath id="sq"><rect width="512" height="512" rx="116"/></clipPath>
    <clipPath id="sq-sm"><rect width="512" height="512" rx="128"/></clipPath>

    <!-- A · Rings: the stem is the spine, the bowls are two D-rings hung on it -->
    <symbol id="b-stem" viewBox="0 0 512 512"><path d="M150 131V381" fill="none" stroke="currentColor" stroke-width="50" stroke-linecap="round"/></symbol>
    <symbol id="b-rings" viewBox="0 0 512 512"><path d="M202 131H262A60 60 0 0 1 262 251H202ZM202 251H282A65 65 0 0 1 282 381H202Z" fill="none" stroke="currentColor" stroke-width="40" stroke-linejoin="round"/></symbol>
    <!-- the same B with the rings fused to the stem: the plain monoline letter, used where the slit would be noise -->
    <symbol id="b-rings-fused" viewBox="0 0 512 512"><path d="M170 131H262A60 60 0 0 1 262 251H170M170 251H282A65 65 0 0 1 282 381H170" fill="none" stroke="currentColor" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/></symbol>

    <!-- B · Punched: the fused B with three holes down the stem, where the rings go -->
    <symbol id="b-holes" viewBox="0 0 512 512"><circle cx="170" cy="152" r="12" fill="currentColor"/><circle cx="170" cy="256" r="12" fill="currentColor"/><circle cx="170" cy="360" r="12" fill="currentColor"/></symbol>

    <!-- C · Wire: one bent wire, open at the spine, like a ring mechanism -->
    <symbol id="b-wire" viewBox="0 0 512 512"><path d="M160 388V131H262A60 60 0 0 1 262 251H186M160 251H282A65 65 0 0 1 282 381H190" fill="none" stroke="currentColor" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/></symbol>

    <!-- D · Page: two punched holes on the left edge of a paper tile -->
    <symbol id="page-holes" viewBox="0 0 512 512"><circle cx="64" cy="166" r="20" fill="currentColor"/><circle cx="64" cy="346" r="20" fill="currentColor"/></symbol>
  </defs>
</svg>
'''


def tile(parts: str, bg: str, size: int, rx: int = 116, label: str = "") -> str:
    """One icon tile at a CSS size. parts is inner SVG drawn over the background; rx 116 is the app-icon squircle."""
    return (
        f'<svg viewBox="0 0 512 512" width="{size}" height="{size}" role="img" aria-label="{label}" class="tile">'
        f'<rect width="512" height="512" rx="{rx}" fill="{bg}"/>{parts}</svg>'
    )


def use(sym: str, color: str, extra: str = "") -> str:
    return f'<use href="#{sym}" width="512" height="512" color="{color}" {extra}/>'


# ---------- the concepts: (key, name, one-line idea, parts builder taking (fg, bg) → inner svg) ----------
def rings(fg, bg):
    return use("b-stem", fg) + use("b-rings", fg)


def rings_two_tone(fg, bg):
    # two-tone: the spine in one colour, the rings in the other
    return use("b-stem", fg) + use("b-rings", bg)


def punched(fg, bg):
    return f'<g transform="translate(20 0)">{use("b-stem", fg)}{use("b-rings-fused", fg)}</g>' + f'<g transform="translate(20 0)">{use("b-holes", bg)}</g>'


def wire(fg, bg):
    return use("b-wire", fg)


def page(fg, bg):
    return use("page-holes", bg) + f'<g transform="translate(44 0)">{use("b-stem", fg)}{use("b-rings", fg)}</g>'


def spine(fg, bg):
    return (
        f'<g clip-path="url(#sq)"><rect x="0" y="0" width="92" height="512" fill="{fg}"/>'
        f'<rect x="92" y="0" width="6" height="512" fill="{bg}" opacity=".35"/></g>'
        f'<g transform="translate(60 0)">{use("b-stem", INK)}{use("b-rings", INK)}</g>'
    )


CONCEPTS = [
    ("rings", "Rings", "The stem is the spine; the two bowls are D-rings hung on it. A B that is literally a binder.", rings),
    ("twotone", "Rings, two-tone", "The same spine and rings, split the way the wordmark is: ink spine, red rings. Only works where both colours are available.", rings_two_tone),
    ("punched", "Punched", "The plain monoline B with three holes down the stem, where the rings go through the page. Quieter about the rings, louder as a letter.", punched),
    ("wire", "Wire", "One bent wire, open at the spine, like the ring mechanism itself. Lightest; wants size.", wire),
    ("page", "Page", "The script page: paper tile, two punched holes on the left edge, the B in red. The binder from the inside.", page),
    ("spine", "Spine", "The binder from the shelf: a red spine band on the tile edge and the B beside it. A family pattern: any product letter beside the band.", spine),
]


def concept_card(key, name, idea, build):
    # the main tile: red mark on espresso; then the inverted tile; then the ladder of sizes
    if key == "page":
        main = tile(build(RED, ESP), PAPER, 160, label=name)
        alt = tile(build(INK, RED), RED, 160, label=f"{name}, inverted")
        ladder = "".join(tile(build(RED, ESP), PAPER, s, rx=116) for s in (64, 32, 16))
        rail = tile(build(RED, ESP), PAPER, 32, rx=116)
    elif key == "spine":
        main = tile(build(RED, ESP), ESP, 160, label=name)
        alt = tile(build(RED, PAPER), "#2A241D", 160, label=f"{name}, elevated")
        ladder = "".join(tile(build(RED, ESP), ESP, s) for s in (64, 32, 16))
        rail = tile(build(RED, ESP), ESP, 32)
    elif key == "twotone":
        main = tile(build(INK, RED), ESP, 160, label=name)
        alt = tile(build(ESP, INK), RED, 160, label=f"{name}, on red")
        ladder = "".join(tile(build(INK, RED), ESP, s) for s in (64, 32, 16))
        rail = tile(build(INK, RED), ESP, 32)
    else:
        main = tile(build(RED, ESP), ESP, 160, label=name)
        alt = tile(build(INK, RED), RED, 160, label=f"{name}, on red")
        ladder = "".join(tile(build(INK, RED), RED, s) for s in (64, 32, 16))
        rail = tile(build(INK, RED), RED, 32)
    return f'''<article class="concept" id="{key}">
  <div class="tiles">{main}{alt}</div>
  <div class="ladder" aria-label="at 64, 32 and 16 px">{ladder}</div>
  <h3>{name}</h3>
  <p>{idea}</p>
</article>'''


# ---------- contexts for the recommended mark ----------
def contexts():
    icon = lambda s, rx=116: tile(rings(INK, RED), RED, s, rx=rx, label="Binder")  # noqa: E731
    icon_dark = lambda s, rx=116: tile(rings(RED, ESP), ESP, s, rx=rx, label="Binder")  # noqa: E731
    neutral = lambda s, inner: f'<svg viewBox="0 0 512 512" width="{s}" height="{s}" class="tile" aria-hidden="true"><rect width="512" height="512" rx="116" fill="#3A332B"/>{inner}</svg>'  # noqa: E731
    homescreen = f'''<div class="ctx-home">
  <div class="app">{neutral(72, '<circle cx="256" cy="256" r="120" fill="#8C8474"/>')}<span>Mail</span></div>
  <div class="app">{neutral(72, '<rect x="136" y="136" width="240" height="240" rx="24" fill="#8C8474"/>')}<span>Notes</span></div>
  <div class="app">{icon(72)}<span>Binder</span></div>
  <div class="app">{neutral(72, '<path d="M136 336h240M136 256h240M136 176h160" stroke="#8C8474" stroke-width="40" stroke-linecap="round"/>')}<span>Files</span></div>
</div>'''
    rail = f'''<div class="ctx-rail"><div class="r-mark">{icon(32, 72)}</div>
  <div class="r-item on"><i></i><span>Script</span></div><div class="r-item"><i></i><span>Cues</span></div><div class="r-item"><i></i><span>Docs</span></div></div>'''
    tab = f'''<div class="ctx-tab"><div class="t-tab">{icon(16, 96)}<span>Songs for a New World · Binder</span></div><div class="t-url">binder.rvlt.app/shows/snw/docs/libretto</div></div>'''
    dock = f'''<div class="ctx-dock">{neutral(56, '<circle cx="256" cy="256" r="120" fill="#8C8474"/>')}{icon(56)}{neutral(56, '<rect x="136" y="136" width="240" height="240" rx="24" fill="#8C8474"/>')}{icon_dark(56)}</div>'''
    return f'''<div class="ctx-grid">
  <figure>{homescreen}<figcaption>iPad home screen, 72 px</figcaption></figure>
  <figure>{dock}<figcaption>macOS dock, 56 px — red tile, and the espresso alternate beside it</figcaption></figure>
  <figure>{rail}<figcaption>The rail mark in the app, 32 px</figcaption></figure>
  <figure>{tab}<figcaption>Browser tab, 16 px favicon</figcaption></figure>
</div>'''


# RVLT letterforms from Flow's wordmark (red), so the lockup matches Flow's "RVLT FLOW" exactly in construction.
RVLT_PATHS = '''<path d="M0,42C0,21.94,16.92,5.64,36.98,5.64h106.56c82.12,0,137.91,58.92,137.91,131.64,0,60.18-37.61,101.55-81.49,112.21l-8.15.63,116.59,139.16c6.9,8.15,8.78,15.67,8.78,24.45,0,20.06-16.3,36.36-36.36,36.36-11.28,0-21.31-4.39-28.83-13.79l-146.68-174.26c-5.01-6.27-11.28-16.3-11.28-28.83,0-18.81,15.04-33.22,33.22-33.22h13.79c37.61,0,63.94-28.21,63.94-62.68s-26.33-63.31-63.94-63.31h-67.07v339.12c0,20.06-16.92,36.98-36.98,36.98S0,433.15,0,413.09V42Z"/><path d="M366.7,36.98c0-20.69,16.92-36.98,36.98-36.98s36.98,16.3,36.98,36.98v282.08L697.67,12.54c6.27-8.15,16.92-12.54,26.33-12.54,19.43,0,34.48,15.04,34.48,34.48,0,6.89-1.25,14.42-8.15,21.94l-317.18,378.62c-8.78,11.28-19.43,15.04-29.46,15.04-20.06,0-36.98-16.92-36.98-36.98V36.98Z"/><path d="M804.85,36.98c0-20.69,16.92-36.98,36.98-36.98s36.98,16.3,36.98,36.98v338.5h132.26c18.81,0,33.85,15.04,33.85,34.48s-15.04,34.48-33.85,34.48h-169.25c-20.06,0-36.98-16.92-36.98-36.98V36.98Z"/><path d="M1100.72,73.97h-83.37c-19.43,0-34.48-15.04-34.48-34.48s15.04-33.85,34.48-33.85h240.71c19.43,0,34.48,15.04,34.48,33.85s-15.04,34.48-34.48,34.48h-83.37v339.12c0,20.06-16.92,36.98-36.98,36.98s-36.98-16.92-36.98-36.98V73.97Z"/>'''


def wordmarks():
    rvlt = f'<svg viewBox="0 0 1260 451" height="30" aria-label="RVLT" role="img"><g fill="{RED}">{RVLT_PATHS}</g></svg>'
    mark = tile(rings(INK, RED), RED, 40, rx=116, label="Binder")
    mark_bare = f'<svg viewBox="0 0 512 512" width="40" height="40" aria-hidden="true">{rings("currentColor", "none")}</svg>'
    return f'''<div class="wm-grid">
  <figure><div class="wm wm-lock">{rvlt}<span class="wm-word">BINDER</span></div><figcaption>Product lockup, built like “RVLT FLOW”: RVLT in red, the product in ink</figcaption></figure>
  <figure><div class="wm">{mark}<span class="wm-name">Binder</span><span class="chip">by RVLT</span></div><figcaption>App header lockup: the tile, the name in Archivo 800, the family chip</figcaption></figure>
  <figure><div class="wm" style="color:var(--pg-ink)">{mark_bare}<span class="wm-name">Binder</span></div><figcaption>Bare mark in ink, for print footers and monochrome places</figcaption></figure>
</div>'''


CSS = '''
<style>
.mk-wrap{max-width:1180px;margin:0 auto;padding-block:28px 60px}
.mk-wrap h1{font-family:var(--disp);font-weight:800;font-size:clamp(30px,4vw,44px);letter-spacing:-.02em;margin:6px 0 8px;text-wrap:balance}
.mk-wrap h2{font-family:var(--disp);font-weight:800;font-size:22px;letter-spacing:-.01em;margin:40px 0 6px}
.mk-wrap p.lede{color:var(--pg-mut);max-width:62ch;margin:0 0 18px}
.concepts{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:18px;margin-top:14px}
.concept{background:var(--pg-2);border:2px solid var(--pg-line);border-radius:20px;padding:18px;box-shadow:4px 4px 0 var(--pg-line)}
.concept .tiles{display:flex;gap:14px;align-items:flex-start}
.concept .ladder{display:flex;gap:12px;align-items:flex-end;margin-top:14px;height:68px}
.concept h3{font-family:var(--disp);font-weight:800;font-size:18px;margin:14px 0 4px}
.concept p{margin:0;color:var(--pg-mut);font-size:14px;line-height:1.5}
.concept.rec{border-color:var(--pg-ink)}
.concept.rec h3::after{content:"recommended";font:600 11px/1 var(--sans);letter-spacing:.04em;text-transform:uppercase;color:#fff;background:#E0363D;padding:4px 7px;border-radius:999px;margin-left:10px;vertical-align:middle}
.tile{display:block;flex:none;border-radius:22.6%;}
.ctx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}
.ctx-grid figure,.wm-grid figure{margin:0;background:var(--pg-2);border:2px solid var(--pg-line);border-radius:20px;padding:18px;display:flex;flex-direction:column;gap:12px;min-width:0}
figcaption{font-size:12px;color:var(--pg-mut)}
.ctx-home{background:#0A0908;border-radius:14px;padding:20px 18px;display:flex;gap:24px;justify-content:center}
.ctx-home .app{display:flex;flex-direction:column;align-items:center;gap:6px;color:#F5EFE2;font-size:11px}
.ctx-dock{background:linear-gradient(#2A241D,#1B1713);border:1px solid #3A332B;border-radius:18px;padding:12px 16px;display:flex;gap:16px;width:max-content}
.ctx-rail{background:#141210;border-radius:14px;padding:10px 0;width:52px;display:flex;flex-direction:column;align-items:center;gap:6px}
.ctx-rail .r-mark{margin-bottom:8px}
.ctx-rail .r-item{display:flex;flex-direction:column;align-items:center;gap:3px;width:44px;padding:5px 0;border-radius:10px;color:#8C8474;font-size:10px}
.ctx-rail .r-item i{width:16px;height:16px;border:2px solid currentColor;border-radius:4px;display:block}
.ctx-rail .r-item.on{color:#F5EFE2;background:#211C17}
.ctx-tab{background:#211C17;border-radius:12px;padding:8px 8px 10px;color:#F5EFE2;font-size:12px}
.ctx-tab .t-tab{display:flex;align-items:center;gap:8px;background:#2A241D;border-radius:8px 8px 0 0;padding:7px 12px;width:max-content;max-width:100%}
.ctx-tab .t-tab .tile{border-radius:4px}
.ctx-tab .t-url{font-family:var(--mono);font-size:11px;color:#8C8474;background:#141210;padding:6px 12px;border-radius:0 8px 8px 8px}
.wm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}
.wm{display:flex;align-items:center;gap:12px;min-height:56px}
.wm-lock{gap:10px}
.wm-word{font-family:var(--disp);font-weight:800;font-size:38px;letter-spacing:-.015em;line-height:1;color:var(--pg-ink);transform:translateY(-1px)}
.wm-name{font-family:var(--disp);font-weight:800;font-size:28px;letter-spacing:-.02em;color:var(--pg-ink)}
.wm .chip{font-size:11px;font-weight:600;letter-spacing:.03em;color:var(--pg-mut);border:1.5px solid var(--pg-line);border-radius:999px;padding:3px 8px}
.rules{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-top:14px}
.rules div{background:var(--pg-2);border:2px solid var(--pg-line);border-radius:14px;padding:14px 16px;font-size:14px;line-height:1.5;color:var(--pg-mut)}
.rules b{color:var(--pg-ink);display:block;margin-bottom:3px;font-family:var(--disp);font-weight:800}
.hand{font-family:var(--hand);color:#E0363D;font-size:16px}
</style>
'''


def main():
    cards = []
    for key, name, idea, build in CONCEPTS:
        card = concept_card(key, name, idea, build)
        if key == "rings":
            card = card.replace('class="concept"', 'class="concept rec"', 1)
        cards.append(card)
    body = f'''
{SYMBOLS}
<div class="mk-wrap">
  <div class="brandline"><span class="mark">B</span><span class="brandtext">Binder</span><span class="chip">by RVLT</span><span class="chip chip-draft">mark, round 1</span></div>
  <h1>A B that is a binder</h1>
  <p class="lede">Six takes on the mark, all built from the same monoline B so they share bones with the RVLT wordmark: round caps, a 0.16 stem, no serifs. Each is shown on the red tile and on espresso, then at 64, 32 and 16 px, because an app icon that only works at 512 is a poster. <span class="hand">squint at the ladder</span></p>

  <h2>Concepts</h2>
  <div class="concepts">{"".join(cards)}</div>

  <h2>Rings, in place</h2>
  <p class="lede">The recommended mark where it will actually live. Red tile with the ink B is the app icon and favicon; the espresso tile with the red B is the alternate for dark wallpapers and print.</p>
  {contexts()}

  <h2>Wordmark</h2>
  {wordmarks()}

  <h2>Why Rings</h2>
  <div class="rules">
    <div><b>It says binder without a picture of one.</b> Two D-rings on a spine is the whole object, and it happens to be a B. Nobody has to learn it.</div>
    <div><b>It survives 16 px.</b> Two open counters and a heavy stem stay legible in a browser tab; Wire thins out, Page loses its holes, Spine becomes a stripe.</div>
    <div><b>It is RVLT.</b> Same construction as the RVLT letters in Flow's wordmark, same red, same single-colour discipline. Put next to a future Flow mark it reads as one family.</div>
    <div><b>One shape, every surface.</b> The same path draws the app icon, the rail mark, the favicon, the PWA maskable icon (it sits inside the 80% safe circle) and the print footer in ink.</div>
  </div>
</div>
'''
    (HERE / "mark.html").write_text(head + CSS + body)
    print("wrote mark.html")


if __name__ == "__main__":
    main()
