#!/usr/bin/env python3
"""Shared pieces for the Binder UI mockup: icons, rail, top bar, presence, the script page, the section wrapper and the
fit script. Imported by _build.py and by every screens2_* module, so a module can be previewed on its own with _preview.py."""
from pathlib import Path

HERE = Path(__file__).parent
head = (HERE / "_head.html").read_text()

# ---------- shared pieces ----------
ICON = {
    "script": '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 12h7M9 16h7"/></svg>',
    "cues": '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h10M4 17h13"/><circle cx="19" cy="16.5" r="2.5"/></svg>',
    "docs": '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
    "activity": '<svg viewBox="0 0 24 24"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
    "exports": '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 19h16"/></svg>',
    "shows": '<svg viewBox="0 0 24 24"><path d="M4 5h16v3H4zM5 8v10h14V8"/><path d="M9 8v10M15 8v10"/></svg>',
    "select": '<svg viewBox="0 0 24 24"><path d="M5 4l14 7-6 2-2 6z"/></svg>',
    "cue": '<svg viewBox="0 0 24 24"><rect x="3" y="8" width="12" height="8" rx="2"/><path d="M15 12h6"/></svg>',
    "note": '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    "rect": '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="1.5"/></svg>',
    "arrow": '<svg viewBox="0 0 24 24"><path d="M5 19L19 5M11 5h8v8"/></svg>',
    "stamp": '<svg viewBox="0 0 24 24"><path d="M8 11V7a4 4 0 018 0v4"/><path d="M4 11h16v4H4z"/><path d="M6 15v4h12v-4"/></svg>',
    "hilite": '<svg viewBox="0 0 24 24"><path d="M4 20h16"/><path d="M7 16l9-9 2 2-9 9H7z"/></svg>',
    "eye": '<svg viewBox="0 0 24 24"><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    "eye-off": '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10 6a10 10 0 0111 6 11 11 0 01-3 3.5M6.5 7.5A11 11 0 002 12s4 6 10 6a9 9 0 003-.5"/></svg>',
    "lock": '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
    "unlock": '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 017-2.6"/></svg>',
    "search": '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
    "undo": '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/></svg>',
    "redo": '<svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/></svg>',
    "print": '<svg viewBox="0 0 24 24"><path d="M7 8V3h10v5"/><rect x="4" y="8" width="16" height="9" rx="2"/><path d="M7 14h10v7H7z"/></svg>',
    "more": '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>',
    "wifi-off": '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 017 0M5 13a10 10 0 016-3M2 9.5a15 15 0 015.5-3.2M12 20h.01M16.5 13a10 10 0 00-2-1.5M22 9.5A15 15 0 0012 6"/></svg>',
}


def rail(active: str, foot=True) -> str:
    items = [
        ("script", "blue", "Script"),
        ("cues", "amber", "Cues"),
        ("docs", "teal", "Docs"),
        ("activity", "purple", "Activity"),
        ("exports", "green", "Exports"),
    ]
    html = ['<nav class="rail" aria-label="Binder">', '<div class="mark" aria-hidden="true">B</div>']
    for key, hue, label in items:
        on = " on" if key == active else ""
        html.append(f'<a class="rail-item {hue}{on}" href="#" aria-current="{"page" if on else "false"}">{ICON[key]}<span>{label}</span></a>')
    if foot:
        html.append('<div class="rail-foot"><a class="rail-item" href="#">' + ICON["shows"] + '<span>Shows</span></a><span class="avatar av-amber" title="Jayden">JN</span></div>')
    html.append("</nav>")
    return "\n".join(html)


def topbar(crumbs: str, right: str) -> str:
    return f'<header class="topbar"><div class="crumbs">{crumbs}</div><div class="spacer"></div>{right}</header>'


def presence(*avs) -> str:
    return '<div class="presence">' + "".join(f'<span class="avatar {c}" title="{t}">{i}</span>' for c, i, t in avs) + "</div>"


# ---------- the script page (shared between desktop markup and calling mode) ----------
LINES = [
    (54, "h", "ACT ONE"),
    (74, "", "Opening sequence. On the deck of a sailing ship, 1492."),
    (118, "h", "#1 — The New World", "band"),
    (160, "", "WOMAN 1"),
    (176, "", "A new world calls across the ocean,"),
    (191, "", "A new world calls across the sky,"),
    (206, "", "A new world whispers in the shadows:"),
    (221, "", "“Time to fly, time to fly…”"),
    (250, "", "MAN 2"),
    (266, "", "It’s about one moment —"),
    (281, "", "The moment before it all becomes clear,"),
    (296, "", "And in that one moment,"),
    (311, "", "You start to believe there’s nothing to fear."),
    (326, "", "It’s about one second —"),
    (341, "", "And just when you’re on the verge of success,"),
    (356, "", "The sky starts to change,"),
    (371, "", "And the wind starts to blow…"),
    (400, "", "And, oh, you’re suddenly a stranger."),
    (415, "", "There’s no explaining where you stand,"),
    (430, "", "And you didn’t know"),
    (445, "", "That you sometimes have to go"),
    (460, "", "’Round an unexpected bend,"),
    (475, "", "And the road will end"),
    (490, "", "In a new world."),
    (519, "", "WOMAN 1"),
    (535, "", "A new world calls for me to follow."),
    (550, "", "A new world waits for my reply."),
    (565, "", "A new world holds me to a promise,"),
    (580, "", "Standing by, standing by…"),
]


def script_page(w=560, h=740, left=96, with_markup=True, scale_text=1.0, selected=None, peer=None) -> str:
    """A paper page with lines of a public-domain-style libretto and M1-style margin cue tags."""
    out = [f'<div class="page" style="width:{w}px;height:{h}px" aria-label="Script page 1">']
    for item in LINES:
        y, cls, text = item[0], item[1], item[2]
        band = len(item) > 3
        x = left
        if text in ("WOMAN 1", "MAN 2"):
            x = left + 150
        if band:
            out.append(f'<div class="l" style="left:{left-8}px;right:28px;top:{y-2}px;background:#1A1715;color:#fff;padding:1px 8px;font-style:italic;font-weight:700;border-radius:2px">{text}</div>')
        else:
            out.append(f'<div class="l {cls}" style="left:{x}px;top:{y}px;font-size:{11.2*scale_text}px">{text}</div>')
    out.append(f'<div class="l" style="right:28px;top:40px;font-size:9px;color:#8C8474;letter-spacing:.14em">SONGS FOR A NEW WORLD &nbsp; · &nbsp; 1</div>')
    if with_markup:
        # SND cues on the right; LX on the left. Tags are flush in the margin, highlights on trigger words, leaders join them.
        def tag(side, cls, lead, num, y, extra=""):
            pos = f"left:4px" if side == "l" else f"right:4px"
            return f'<div class="tag {cls} {"r" if side=="r" else ""} {extra}" style="{pos};top:{y-7}px"><span class="bar"></span><span class="lead">{lead}</span><span class="div"></span><span class="n">{num}</span></div>'

        def hl(cls, x, wdt, y):
            return f'<div class="hl {cls}" style="left:{x-2}px;width:{wdt}px;top:{y-1}px"></div>'

        def leader(cls, x1, x2, y):
            return f'<div class="lead-rule {cls}" style="left:{x1}px;width:{x2-x1}px;top:{y}px"></div>'

        # SND 2 at the song band (right), SND 2.10 at MAN 2, SND 2.20 "And the road will end", SND 2.30 at WOMAN 1 (2nd)
        out += [
            tag("r", "c-snd", "SND", "2", 118 + 6),
            tag("r", "c-snd", "SND", "2.10", 250 + 6), hl("c-snd", left + 150, 44, 250 + 6), leader("c-snd", left + 196, w - 62, 250 + 6),
            tag("r", "c-snd", "SND", "2.20", 475 + 6), hl("c-snd", left, 112, 475 + 6), leader("c-snd", left + 112, w - 62, 475 + 6),
            tag("r", "c-snd", "SND", "2.30", 519 + 6), hl("c-snd", left + 150, 56, 519 + 6), leader("c-snd", left + 208, w - 62, 519 + 6),
            # LX on the left
            tag("l", "c-lx", "LX", "12", 176 + 6, "sel" if selected == "lx12" else ""), hl("c-lx on" if selected == "lx12" else "c-lx", left, 150, 176 + 6), leader("c-lx", 58, left - 4, 176 + 6),
            tag("l", "c-lx", "SB LX", "13", 371 + 6, "sb"), hl("c-lx", left + 48, 160, 371 + 6), leader("c-lx", 72, left + 44, 371 + 6),
            tag("l", "c-lx", "LX", "13", 400 + 6, "peer-outline" if peer == "lx13" else ""), hl("c-lx", left, 190, 400 + 6), leader("c-lx", 58, left - 4, 400 + 6),
            # annotations: a stamp and a note on the SND layer, a highlight on TM
            f'<div class="stamp c-snd" style="left:{left+260}px;top:{250-4}px">Q IN GAP</div>',
            f'<div class="note c-snd" style="left:{left+270}px;top:{460}px">singing overlaps — ride the pad</div>',
            f'<div class="stamp c-lx" style="left:{left+230}px;top:{388}px;transform:rotate(2deg)">FAST PACE</div>',
        ]
    out.append("</div>")
    return "\n".join(out)


# ---------- Screen 1: Shows home ----------
def wrap(id_, kicker, title, blurb, notes, frame_html, w, h, scale_hint=""):
    notes_html = "".join(f"<li>{n}</li>" for n in notes)
    return f'''<section class="screen" id="{id_}">
  <div class="screen-head"><span class="kicker">{kicker}</span><h2>{title}</h2><p>{blurb}</p></div>
  <div class="frame-wrap" data-w="{w}" data-h="{h}"><div class="scaler">{frame_html}</div></div>
  <ul class="notes">{notes_html}</ul>
</section>'''



FIT_SCRIPT = r"""
<script>
(function(){
  // Scale each fixed-size frame to the width available, so the mockups read on any screen without horizontal scroll.
  function fit(){
    document.querySelectorAll('.frame-wrap').forEach(function(w){
      var W=+w.dataset.w, H=+w.dataset.h, par=w.parentElement, cs=getComputedStyle(par), avail=par.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight), s=Math.min(1, avail/W);
      var sc=w.querySelector('.scaler'); sc.style.transform='scale('+s+')'; sc.style.transformOrigin='top left'; sc.style.width=W+'px';
      w.style.height=Math.round(H*s)+'px'; w.style.width=Math.round(W*s)+'px'; w.style.marginInline='auto'; w.style.overflow='hidden';
    });
  }
  fit(); window.addEventListener('resize', fit);
})();
</script>
"""
