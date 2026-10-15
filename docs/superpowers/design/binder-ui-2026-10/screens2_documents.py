#!/usr/bin/env python3
"""Binder UI mockup, documents and exports: the Documents list, Compare v1 -> v2, Exports and the Print sheet.
Prefix dx-. Preview with: python3 _preview.py screens2_documents"""
from _parts import *  # noqa: F401,F403
from _build import screen_markup

CSS = """
/* ── dx: documents and exports ── */
/* the shared rule .frame button{padding:0} beats .btn, so buttons lose their padding; restore it inside dx frames only */
.dx .btn{padding:0 12px}
.dx .btn.sm{padding:0 9px}
.dx .btn.ghost{padding:0 10px}
.dx-row .btn:not(.ghost),.dx-ex .btn:not(.ghost){background:var(--elev)}
.dx-opt .seg{justify-self:start}
.dx-wrap{padding:24px 32px;display:flex;flex-direction:column;gap:12px;overflow:hidden}
.dx-head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:6px}
.dx-row{display:grid;grid-template-columns:44px 1fr auto;gap:16px;align-items:center;padding:14px 16px}
.dx-row.dx-top{align-items:start}
.dx-name{font-weight:600;font-size:15px;color:var(--ink)}
.dx-chip{display:inline-flex;align-items:center;gap:5px;height:18px;padding:0 8px 0 6px;border:1px solid var(--line-2);border-radius:999px;font-size:11px;font-weight:500;color:var(--muted)}
.dx-chip svg{width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.dx-bar{height:8px;border-radius:999px;background:var(--paper);border:1px solid var(--line-2);overflow:hidden}
.dx-bar i{display:block;height:100%;background:var(--ink-2);border-radius:999px}
.dx-steps{display:flex;align-items:center;gap:0;margin-top:2px}
.dx-step{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--faint);white-space:nowrap}
.dx-step.done{color:var(--ink-2)}
.dx-step.cur{color:var(--ink);font-weight:600}
.dx-join{width:28px;height:1px;background:var(--line-2);margin:0 10px;flex:none}
.dx-ring{width:16px;height:16px;border-radius:50%;border:2px solid var(--line-2);flex:none}
.dx-step.cur .dx-ring{border-color:var(--line-2);border-top-color:var(--ink);border-right-color:var(--ink)}
.dx-tick{width:16px;height:16px;border-radius:50%;background:var(--elev);border:2px solid var(--line-2);display:grid;place-items:center;flex:none;color:var(--ink-2)}
.dx-tick svg{width:9px;height:9px;stroke:currentColor;fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.dx-bad{background:var(--red-soft);color:#F26F73}
.dx-failed{border-color:color-mix(in srgb,var(--red) 38%,var(--line-2))}
.dx-link{color:var(--blue);font-size:12.5px;font-weight:600;text-decoration:none}
.dx-drop{display:flex;align-items:center;justify-content:center;gap:10px;height:56px;font-size:13px}

/* compare */
.dx-stage{position:absolute;left:56px;right:360px;top:44px;bottom:0;background:#0E0C0A;overflow:hidden}
.dx-strip{position:absolute;left:0;right:0;top:0;height:38px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:18px;padding:0 24px;font-size:12px;color:var(--muted)}
.dx-key{display:inline-flex;align-items:center;gap:6px}
.dx-key i{width:14px;height:10px;border-radius:2px;display:inline-block;border:1px solid var(--line-2)}
.dx-cols{position:absolute;left:0;right:0;top:50px;display:flex;justify-content:center;gap:24px}
.dx-col{width:400px}
.dx-cap{display:flex;justify-content:space-between;align-items:baseline;height:26px;font-size:12px;color:var(--muted)}
.dx-cap .mono{color:var(--ink);font-size:13px}
.dx-band{position:absolute;left:34px;right:20px}
.dx-band.cut{background:color-mix(in srgb, var(--red) 10%, #fff)}
.dx-band.add{background:color-mix(in srgb, var(--green) 12%, #fff)}
.page .dx-cutline{text-decoration:line-through;text-decoration-color:#8C8474;color:#4A443B}
.page .dx-g{font-family:var(--mono);font-size:11px;color:#6B6355;font-weight:600}
.dx-chg{padding:10px 12px 10px 14px;border-radius:10px;border:2px solid transparent;display:grid;gap:2px}
.dx-chg.on{background:var(--card);border-color:var(--line-2);box-shadow:inset 3px 0 0 var(--red),var(--sh-card)}
.dx-chg .t{font-size:13px;font-weight:600;color:var(--ink)}
.dx-chg .m{font-size:12px;color:var(--muted)}
.dx-chg:not(.on){border-color:var(--line)}
.dx-cuerow{display:grid;grid-template-columns:1fr auto;gap:8px;padding:8px 0;border-top:1px solid var(--line);align-items:center}
.dx-cuerow:first-of-type{border-top:0}
.dx-cuerow .n{font-family:var(--mono);font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}
.dx-cuerow .q{font-size:12px;color:var(--muted);margin-top:1px}
.dx-vs{display:inline-flex;align-items:center;gap:8px}
.dx-vchip{display:inline-flex;align-items:center;height:26px;padding:0 10px;border-radius:8px;border:2px solid var(--line-2);font-family:var(--mono);font-size:12px;color:var(--muted);background:var(--card)}
.dx-vchip.on{color:var(--ink);background:var(--elev)}

/* exports */
.dx-ex{display:grid;grid-template-columns:36px 1fr auto;gap:14px;align-items:center;padding:16px 16px;border-top:1px solid var(--line)}
.dx-ex:first-child{border-top:0}
.dx-fi{width:36px;height:44px;border-radius:5px;border:2px solid var(--line-2);background:var(--paper-2);display:grid;place-items:center;font-family:var(--mono);font-size:9.5px;font-weight:600;color:var(--muted);letter-spacing:.02em}
.dx-file{font-family:var(--mono);font-size:13px;color:var(--ink);font-variant-numeric:tabular-nums}
.dx-off{color:var(--muted)}
.dx-off .dot{background:var(--faint);box-shadow:0 0 0 2px var(--line)}
.dx-off svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}

/* print sheet */
.dx-scrim{position:absolute;inset:0;background:rgba(10,8,6,.66)}
.dx-sheet{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:860px;background:var(--card);border:2px solid var(--line-2);border-radius:var(--r-lg);box-shadow:0 6px 0 #0C0A08, 0 24px 48px rgba(0,0,0,.45);padding:22px 26px 18px;display:flex;flex-direction:column;gap:16px}
.dx-sh-head{display:flex;justify-content:space-between;align-items:flex-start}
.dx-opt{display:grid;gap:8px}
.dx-opt-h{display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:600;color:var(--muted)}
.dx-opt-h .l{display:flex;gap:12px}
.dx-cb-row{display:flex;align-items:center;gap:10px;height:28px;font-size:13px;color:var(--ink)}
.dx-cb{width:16px;height:16px;border-radius:5px;border:2px solid var(--line-2);display:grid;place-items:center;flex:none;background:var(--paper)}
.dx-cb.on{background:var(--ink);border-color:var(--ink);color:var(--paper)}
.dx-cb svg{width:10px;height:10px;stroke:currentColor;fill:none;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round}
.dx-cb-row .count{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--muted)}
.dx-pv{width:196px;height:262px;background:#fff;border-radius:3px;position:relative;box-shadow:0 1px 0 rgba(0,0,0,.6),0 8px 18px rgba(0,0,0,.4);flex:none}
.dx-pv i{position:absolute;left:46px;right:46px;height:2px;background:#D8D4CC}
.dx-pv .tg{position:absolute;height:9px;width:28px;border-radius:5px;border:1.2px solid currentColor;background:#fff}
.dx-pv .ld{position:absolute;height:1px;background:currentColor}
.dx-sh-foot{display:flex;align-items:center;gap:10px;padding-top:14px;border-top:1px solid var(--line)}
"""

CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'


def m(s):
    return f'<span class="mono">{s}</span>'


def mini_thumb(n_lines=5, dim=False, blank=False):
    lines = "" if blank else "".join(f'<i style="top:{8 + k * 6}px;{"right:20px;" if k == 2 else ""}"></i>' for k in range(n_lines))
    style = "width:44px;height:58px;flex:none"
    if dim:
        style += ";opacity:.45"
    if blank:
        style += ";background:var(--paper-2);border:2px dashed var(--line-2);box-shadow:none"
    return f'<div class="thumb" style="{style}">{lines}</div>'


def sync_synced():
    return '<span class="sync"><span class="dot"></span>Synced</span>'


# ---------- 08: Documents ----------
def screen_docs():
    f = ['<div class="frame dx" style="width:1280px;height:800px">', rail("docs")]
    f.append(topbar('<span>Songs for a New World</span><span class="sep">/</span><b>Documents</b>',
                    sync_synced() + '<button class="btn primary">Upload document</button>'))
    cached = f'<span class="dx-chip">{CHECK}cached on this device</span>'
    f.append(f'''<main class="content dx-wrap">
  <div class="dx-head">
    <div><div class="t-over">Songs for a New World</div><div class="t-title">Documents</div></div>
    <div class="small muted">2 current · 1 processing · 1 couldn’t be read</div>
  </div>

  <div class="card dx-row">
    {mini_thumb(5)}
    <div class="col" style="gap:3px;min-width:0">
      <div class="row" style="gap:10px"><span class="dx-name">Libretto</span><span class="pill blue" style="height:18px">4 to review</span>{cached}</div>
      <div class="muted small">v2 current · {m(43)} pages · searchable</div>
      <div class="faint small">v1 kept · {m(48)} pages</div>
    </div>
    <div class="row"><button class="btn sm">Open</button><button class="btn sm">Cue lists</button><button class="btn sm">Compare v1 → v2</button><button class="btn sm">Upload new version</button></div>
  </div>

  <div class="card dx-row">
    {mini_thumb(6)}
    <div class="col" style="gap:3px;min-width:0">
      <div class="row" style="gap:10px"><span class="dx-name">Piano-vocal score</span>{cached}</div>
      <div class="muted small">v1 current · {m(188)} pages · scanned, OCR layer added</div>
    </div>
    <div class="row"><button class="btn sm">Open</button><button class="btn sm">Cue lists</button><button class="btn sm">Upload new version</button></div>
  </div>

  <div class="card dx-row dx-top" style="padding:16px">
    {mini_thumb(5, dim=True)}
    <div class="col" style="gap:10px;min-width:0">
      <div class="row" style="gap:10px"><span class="dx-name">Libretto v3</span><span class="pill rep" style="height:18px">Processing</span></div>
      <div class="col" style="gap:6px">
        <div class="row" style="justify-content:space-between;font-size:12.5px"><span class="muted">{m("12 MB")} uploaded, now extracting text</span><span class="mono" style="color:var(--ink-2)">64 %</span></div>
        <div class="dx-bar" role="progressbar" aria-valuenow="64" aria-valuemin="0" aria-valuemax="100"><i style="width:64%"></i></div>
      </div>
      <div class="dx-steps">
        <span class="dx-step done"><span class="dx-tick">{CHECK}</span>Upload</span><span class="dx-join"></span>
        <span class="dx-step cur"><span class="dx-ring"></span>Extract text</span><span class="dx-join"></span>
        <span class="dx-step"><span class="dx-ring"></span>Build word layer</span><span class="dx-join"></span>
        <span class="dx-step"><span class="dx-ring"></span>Re-anchor {m(96)} cues</span>
      </div>
      <div class="muted small">You can keep working on v2. Cues move to v3 when it is ready, and anything uncertain goes to review.</div>
    </div>
    <div class="row"><button class="btn sm ghost">Cancel</button></div>
  </div>

  <div class="card dx-row dx-failed">
    {mini_thumb(blank=True)}
    <div class="col" style="gap:4px;min-width:0">
      <div class="row" style="gap:10px"><span class="dx-name">Blocking notes.pdf</span><span class="pill dx-bad" style="height:18px"><span class="dot"></span>couldn’t read text</span></div>
      <div class="muted small" style="max-width:640px">Scanned at {m("72 dpi")}, so there is no text to search or anchor to. Try a {m("300 dpi")} scan.</div>
    </div>
    <div class="row"><button class="btn sm">Try again</button><button class="btn sm ghost">Remove</button></div>
  </div>

  <div class="ghost-card dx-drop">Drop a PDF here, or use <b style="color:var(--ink-2);font-weight:600">Upload document</b></div>
</main>''')
    f.append("</div>")
    return "\n".join(f)


# ---------- 09: Compare ----------
V1_CUT = (296, 371)  # y of the first and last of the six cut lines


def text_page(version):
    """A plain text page, no markup. v1 p.9 carries the cut block; v2 p.8 has the cut closed up and two added lines."""
    left = 52
    out = ['<div class="page" style="width:400px;height:640px">']
    gap = 104  # six cut lines (296..371) plus the paragraph gap: what v2 pulls up
    added_y = (401, 416)
    if version == 1:
        out.append(f'<div class="dx-band cut" style="top:{V1_CUT[0] - 3}px;height:{V1_CUT[1] - V1_CUT[0] + 21}px"></div>')
        out.append(f'<div class="l dx-g" style="left:12px;top:{V1_CUT[0]}px">−6</div>')
    else:
        out.append(f'<div class="dx-band add" style="top:{added_y[0] - 3}px;height:{added_y[1] - added_y[0] + 21}px"></div>')
        out.append(f'<div class="l dx-g" style="left:12px;top:{added_y[0]}px">+2</div>')
    for item in LINES:
        y, cls, text = item[0], item[1], item[2]
        band = len(item) > 3
        if version == 2 and V1_CUT[0] <= y <= V1_CUT[1]:
            continue
        if version == 2 and y >= 400:
            y = y - gap + (31 if y >= 519 else 0)
        x = left + (110 if text in ("WOMAN 1", "MAN 2") else 0)
        cut = version == 1 and V1_CUT[0] <= item[0] <= V1_CUT[1]
        if band:
            out.append(f'<div class="l" style="left:{left - 8}px;right:20px;top:{y - 2}px;background:#1A1715;color:#fff;padding:1px 8px;font-style:italic;font-weight:700;border-radius:2px">{text}</div>')
        else:
            extra = " dx-cutline" if cut else ""
            out.append(f'<div class="l {cls}{extra}" style="left:{x}px;top:{y}px">{text}</div>')
    if version == 2:
        out.append(f'<div class="l" style="left:{left}px;top:{added_y[0]}px">A new world, a new world, and the shore is gone,</div>')
        out.append(f'<div class="l" style="left:{left}px;top:{added_y[1]}px">Only the sky and the stars to steer us on.</div>')
        # lines that moved up from the next page: unchanged, untinted
        out.append(f'<div class="l" style="left:{left + 110}px;top:536px">MAN 2</div>')
        for k, t in enumerate(["The tide is turning, the sails are full,", "Whatever we wanted, we wanted it all,", "And the road is a promise we can’t refuse,", "Nothing to gain and nothing to lose."]):
            out.append(f'<div class="l" style="left:{left}px;top:{552 + k * 15}px">{t}</div>')
    out.append(f'<div class="l" style="right:20px;top:34px;font-size:9px;color:#8C8474;letter-spacing:.14em">SONGS FOR A NEW WORLD &nbsp; · &nbsp; {"9" if version == 1 else "8"}</div>')
    out.append("</div>")
    return "\n".join(out)


def screen_compare():
    f = ['<div class="frame dx" style="width:1280px;height:800px">', rail("script")]
    right = ('<span class="dx-vs" aria-label="Comparing v1 to v2"><span class="dx-vchip">v1</span><span class="muted">→</span><span class="dx-vchip on">v2</span></span>'
             '<button class="btn sm">Open review <span class="pill blue" style="height:16px;padding:0 6px">4</span></button>')
    f.append(topbar('<span>Songs for a New World</span><span class="sep">/</span><span>Libretto</span><span class="sep">/</span><b>Compare</b>', right))
    f.append(f'''<div class="dx-stage">
  <div class="dx-strip"><span>Scrolling together · {m("v1 p.9")} lines up with {m("v2 p.8")}</span><span class="spacer"></span>
    <span class="dx-key"><i style="background:color-mix(in srgb, var(--red) 10%, #fff)"></i>Cut</span>
    <span class="dx-key"><i style="background:color-mix(in srgb, var(--green) 12%, #fff)"></i>Added</span>
    <span class="faint">Moved lines are not marked</span></div>
  <div class="dx-cols">
    <div class="dx-col"><div class="dx-cap"><span class="mono">v1 · p.9</span><span>6 of the 16 cut lines are on this page</span></div>{text_page(1)}</div>
    <div class="dx-col"><div class="dx-cap"><span class="mono">v2 · p.8</span><span>2 lines added here</span></div>{text_page(2)}</div>
  </div>
</div>''')
    cues = [
        ("lx", "LX", "41", "var(--amber)", "approximate", "pill rep", "“the moment before it all”"),
        ("lx", "LX", "42", "var(--amber)", "approximate", "pill rep", "“nothing to fear”"),
        ("snd", "SND", "4.20", "var(--blue)", "unresolved", "pill dx-bad", "“when the wind starts to blow”"),
        ("tm", "TM", "12.50", "var(--purple)", "ok", "pill ok", "“the road will end”"),
    ]
    crow = "".join(
        f'<div class="dx-cuerow"><div><div class="dept" style="color:{col}"><span class="sw {k}"></span>{dept} <span class="n">{num}</span></div><div class="q">{q}</div></div><span class="{pc}"><span class="dot"></span>{flag}</span></div>'
        for k, dept, num, col, flag, pc, q in cues)
    f.append(f'''<aside class="panel" style="right:0;width:360px;top:44px;bottom:0">
  <div style="padding:16px 16px 10px"><div class="t-over">Libretto v1 → v2</div><div class="t-title" style="font-size:18px">Changes · {m(3)}</div></div>
  <div class="col" style="gap:8px;padding:0 12px">
    <div class="dx-chg on" style="padding:12px 14px 12px 16px"><span class="t">#4 cut — 16 lines</span><span class="m">v1 p.9–10 · 4 cues affected</span>
      <div class="section-label" style="margin:10px 0 2px">Cues on this change</div>
      <div>{crow}</div>
      <div style="padding-top:8px"><a href="#" class="dx-link">Open review →</a></div>
    </div>
    <div class="dx-chg"><span class="t">p.12 — 2 lines added</span><span class="m">v2 only · no cues affected</span></div>
    <div class="dx-chg"><span class="t">p.23 — 1 line reworded</span><span class="m">cues stayed in place</span></div>
  </div>
  <div class="row" style="margin-top:auto;padding:12px;border-top:1px solid var(--line);justify-content:space-between"><button class="btn sm">‹ Previous change</button><button class="btn sm">Next change ›</button></div>
</aside>''')
    f.append("</div>")
    return "\n".join(f)


# ---------- 10: Exports ----------
def ex_row(ext, name, meta, actions):
    return f'<div class="dx-ex"><div class="dx-fi">{ext}</div><div class="col" style="gap:3px;min-width:0"><div class="dx-file">{name}</div><div class="small muted row" style="gap:8px">{meta}</div></div><div class="row" style="gap:16px">{actions}</div></div>'


def screen_exports():
    f = ['<div class="frame dx" style="width:1280px;height:800px">', rail("exports")]
    f.append(topbar('<span>Songs for a New World</span><span class="sep">/</span><b>Exports</b>',
                    f'<span class="sync dx-off"><span class="dot"></span>{ICON["wifi-off"]}Offline</span>'))
    dl = '<button class="btn sm">Download again</button>'
    chg = '<a href="#" class="dx-link">What changed since this</a>'
    dept = lambda k, n: f'<span class="dept" style="gap:5px"><span class="sw {k}"></span>{n}</span>'
    f.append(f'''<main class="content" style="padding:24px 32px;overflow:hidden;display:flex;flex-direction:column;gap:14px">
  <div><div class="t-over">Songs for a New World</div><div class="t-title">Exports</div>
    <div class="muted" style="margin-top:4px">Make one with Print in a document, or Export on a cue list.</div></div>

  <div class="section-label" style="margin-top:8px">Waiting to upload</div>
  <div class="card" style="overflow:hidden">
    {ex_row("PDF", "songs-for-a-new-world-libretto-v2-SND.pdf", f'<span class="pill rep" style="height:18px"><span class="dot"></span>Waiting to upload</span><span>{dept("snd", "SND")}</span><span class="mono">21:14</span><span>·</span><span>Downloaded to this device. Binder records it when you are back online.</span>', dl)}
  </div>

  <div class="section-label" style="margin-top:8px">Made with Binder <span class="faint">· newest first</span></div>
  <div class="card" style="overflow:hidden">
    {ex_row("PDF", "songs-for-a-new-world-libretto-v2-LX.pdf", f'{dept("lx", "LX")}<span>only</span><span>·</span><span>today <span class="mono">14:02</span></span>', dl + chg)}
    {ex_row("PDF", "songs-for-a-new-world-libretto-v2-all-layers.pdf", f'<span>All layers</span><span>·</span><span>yesterday <span class="mono">22:51</span></span>', dl + chg)}
    {ex_row("CSV", "SND cue sheet.csv", f'{dept("snd", "SND")}<span>·</span><span><span class="mono">12</span> Oct</span><span class="pill rep" style="height:18px">Only you</span>', dl + chg)}
    {ex_row("PDF", "songs-for-a-new-world-libretto-v1-all-layers.pdf", f'<span>All layers</span><span>·</span><span><span class="mono">9</span> Oct</span>', dl + chg)}
  </div>
</main>''')
    f.append("</div>")
    return "\n".join(f)


# ---------- 11: Print ----------
def cb(label, on=True, count="", sw="", extra=""):
    swatch = f'<span class="sw {sw}"></span>' if sw else ""
    cnt = f'<span class="count">{count}</span>' if count else ""
    return f'<div class="dx-cb-row"><span class="dx-cb{" on" if on else ""}">{CHECK if on else ""}</span>{swatch}<span>{label}</span>{extra}{cnt}</div>'


def preview_page():
    rows = "".join(f'<i style="top:{34 + k * 11}px;{"right:70px;" if k % 5 == 4 else ""}"></i>' for k in range(19))
    tags = [
        ("c-lx", "left", 52), ("c-lx", "left", 120), ("c-tm", "left", 148), ("c-lx", "left", 176),
        ("c-snd", "right", 62), ("c-snd", "right", 100), ("c-snd", "right", 166),
    ]
    out = []
    for cls, side, y in tags:
        if side == "left":
            out.append(f'<span class="tg {cls}" style="left:6px;top:{y}px"></span><span class="ld {cls}" style="left:34px;width:14px;top:{y + 4}px"></span>')
        else:
            out.append(f'<span class="tg {cls}" style="right:6px;top:{y}px"></span><span class="ld {cls}" style="right:34px;width:14px;top:{y + 4}px"></span>')
    return f'<div class="dx-pv">{rows}{"".join(out)}</div>'


def screen_print():
    base = screen_markup().rstrip()
    assert base.endswith("</div>")
    base = base[: -len("</div>")].replace('<div class="frame"', '<div class="frame dx"', 1)
    seg = lambda items: '<div class="seg">' + "".join(f'<button class="{"on" if on else ""}">{t}</button>' for t, on in items) + "</div>"
    sheet = f'''<div class="dx-scrim"></div>
<div class="dx-sheet" role="dialog" aria-label="Print Libretto v2">
  <div class="dx-sh-head"><div><div class="t-over">Songs for a New World</div><div class="t-title">Print Libretto v2</div></div><span class="small muted">{m(43)} pages</span></div>
  <div style="display:flex;gap:28px">
    <div class="col" style="gap:16px;flex:1;min-width:0">
      <div class="dx-opt">
        <div class="dx-opt-h"><span>Layers</span><span class="l"><a href="#" class="dx-link">All</a><a href="#" class="dx-link">Only mine</a></span></div>
        <div>
          {cb("LX", True, "61", "lx")}
          {cb("SND", True, "28", "snd")}
          {cb("TM", True, "7", "tm")}
          {cb("Personal", False, "3", "me", '<span class="faint small">only you</span>')}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div class="dx-opt"><div class="dx-opt-h"><span>Pages</span></div>
          <div class="row" style="gap:10px">{seg([("All 43", True), ("Range", False)])}<div class="field"><div class="in mono" style="width:84px;height:30px;color:var(--faint)">1–43</div></div></div></div>
        <div class="dx-opt"><div class="dx-opt-h"><span>Paper</span></div>{seg([("A4", True), ("Letter", False)])}</div>
      </div>
      <div class="dx-opt">
        <div class="dx-opt-h"><span>Include</span></div>
        <div>{cb("Cue notes", True)}{cb("Standby and warn tags", True)}{cb("Annotations", True)}</div>
      </div>
    </div>
    <div class="col" style="align-items:center;gap:10px;width:230px;flex:none;padding-top:4px">
      {preview_page()}
      <div class="small muted" style="text-align:center">Sides follow the show settings</div>
    </div>
  </div>
  <div class="field"><label>File name</label><div class="in mono" style="font-size:13px">songs-for-a-new-world-libretto-v2-LX-SND-TM.pdf</div></div>
  <div class="dx-sh-foot"><span class="small muted">Saved to Exports. Works offline.</span><span class="spacer"></span><button class="btn ghost">Cancel</button><button class="btn primary">Download PDF</button></div>
</div>
</div>'''
    return base + sheet


# ---------- the list ----------
SCREENS = [
    ("docs", "08 · 1280 × 800", "Documents",
     "Every file in the show, with what state it is in: current, being processed, or couldn’t be read. A new version never interrupts the one you are working on.",
     ["<b>Processing is a row, not a modal.</b> Libretto v3 shows four named steps, with the current one as a ring, and says in plain words that v2 stays usable and that anything uncertain goes to review.",
      "<b>The failed row is an alert, so it is plain.</b> Colour plus the words “couldn’t read text”, the reason and the fix (a 300 dpi scan), no handwriting.",
      "<b>Open is a plain button.</b> The only red on the page is Upload document. The progress bar is ink, not red, because a bar filling is not an alert.",
      "<b>“Cached on this device”</b> is a quiet chip, because offline is the normal state and the row should say it works without saying it is a feature."],
     screen_docs, 1280, 800),
    ("compare", "09 · 1280 × 800", "Compare v1 → v2",
     "Two text pages side by side. Cut lines are struck through in v1, added lines are tinted in v2, and lines that merely moved are left alone. The panel lists the changes and the cues each one touches.",
     ["<b>Text, not markup.</b> This view answers “what did the script change”, so the pages carry no cue tags. The cues live in the panel, where a flag has room for words.",
      "<b>Lines that moved are not marked.</b> A cut that pulls the next page up would otherwise light the whole page; only genuinely cut and added lines are tinted.",
      "<b>The panel is the review in miniature.</b> Each cue on the selected change shows its flag; Open review takes you to the full before-and-after rows.",
      "<b>Previous and Next change</b> stay pinned at the bottom, so you can walk the revision without reaching for the page."],
     screen_compare, 1280, 800),
    ("exports", "10 · 1280 × 800", "Exports",
     "Every PDF and CSV made in this show, newest first, with what was in it. This frame is offline: an export made in the room is waiting to upload and the top bar says so calmly.",
     ["<b>Offline is muted, not red.</b> Nothing is wrong; the export is on this device and Binder records it later. The waiting row says exactly that.",
      "<b>What changed since this</b> answers the question behind every old export: do I need to print again? It is scoped to the layers that export contained.",
      "<b>“Only you”</b> marks an export that others in the show cannot see, such as one that includes a personal layer or was kept private.",
      "<b>Filenames are mono and complete</b>, because they are what ends up on the stage manager’s desk and in the email."],
     screen_exports, 1280, 800),
    ("print", "11 · 1280 × 800 · sheet over the script", "Print marked script",
     "Print opens as a sheet over the page you were on. Choose layers, pages, paper and extras; the preview shows which side each department prints on, and the file is saved to Exports whether or not you are online.",
     ["<b>Layers are checkboxes with swatches and counts</b>, the same swatches as the layer panel, so nothing new has to be learnt. Personal says “only you” and starts off.",
      "<b>The file name is built from the choices</b> (show, document, version, layers), in mono and editable.",
      "<b>The thumbnail is not a preview of the content</b>; it shows which margin each department prints in, and says the sides come from the show settings.",
      "<b>One red button.</b> Download PDF is the only action that costs anything; Cancel is a ghost, and the footer note says it works offline."],
     screen_print, 1280, 800),
]
