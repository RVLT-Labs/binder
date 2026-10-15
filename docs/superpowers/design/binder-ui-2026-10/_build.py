#!/usr/bin/env python3
"""Assemble index.html for the Binder UI direction mockup from _head.html plus the screens below (shared pieces in _parts.py)."""
from _parts import *  # noqa: F401,F403

def screen_home():
    f = ['<div class="frame" style="width:1280px;height:800px">', rail("", foot=True)]
    f.append(topbar('<b>Shows</b>', '<span class="sync"><span class="dot"></span>Synced</span><button class="btn primary">New show</button>'))
    f.append('''<main class="content" style="padding:28px 32px;overflow:hidden">
  <div class="row" style="justify-content:space-between;align-items:flex-end;margin-bottom:22px">
    <div><div class="t-over">Two Toned Productions</div><div class="t-title" style="font-size:30px">Good evening, Jayden.</div>
    <div class="muted" style="margin-top:4px">Three shows in prep. One opens in 9 days.</div></div>
    <div class="row"><span class="kbd">⌘K</span><span class="muted small">jump to a show, a cue or a page</span></div>
  </div>
  <div class="section-label" style="margin-bottom:12px">Active</div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:26px">
    <div class="show-card" style="position:relative">
      <div class="row" style="justify-content:space-between"><span class="pill live"><span class="dot"></span>Running</span><span class="muted small">opened 3 Oct</span></div>
      <div class="name">The Pirates of Penzance</div>
      <div class="meta"><span>Libretto v3</span><span>Piano-vocal v1</span><span class="mono">412 cues</span></div>
      <div class="foot">''' + presence(("av-amber", "JN", "Jayden"), ("av-blue", "MK", "Mikaela, LX"), ("av-purple", "AR", "Alex R")) + '''<span class="small muted">LX relabelled 3 cues · 12 min ago</span></div>
    </div>
    <div class="show-card">
      <div class="row" style="justify-content:space-between"><span class="pill warn"><span class="dot"></span>Rehearsal</span><span class="muted small">opens 24 Oct</span></div>
      <div class="name">Songs for a New World</div>
      <div class="meta"><span>Libretto v2</span><span class="mono">96 cues</span><span class="pill blue" style="height:18px">4 to review</span></div>
      <div class="foot">''' + presence(("av-amber", "JN", "Jayden"), ("av-teal", "OL", "Oli, SND")) + '''<span class="small muted">revision uploaded · 1 h ago</span></div>
    </div>
    <div class="show-card">
      <div class="row" style="justify-content:space-between"><span class="pill rep"><span class="dot"></span>Prep</span><span class="muted small">opens 14 Nov</span></div>
      <div class="name">Little Women</div>
      <div class="meta"><span>Libretto v1</span><span class="mono">0 cues</span></div>
      <div class="foot"><span class="empty" style="padding:6px 10px;box-shadow:none;border-width:1px"><span class="hand">script in, nothing placed yet</span></span></div>
    </div>
  </div>
  <div class="section-label" style="margin-bottom:12px">Archived</div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
    <div class="show-card archived" style="min-height:0">
      <div class="row" style="justify-content:space-between"><span class="pill rep">Archived</span><span class="muted small">closed Aug</span></div>
      <div class="name" style="font-size:16px">American Idiot</div>
      <div class="meta"><span>read-only</span><span>exports still work</span></div>
    </div>
    <div class="show-card archived" style="min-height:0">
      <div class="row" style="justify-content:space-between"><span class="pill rep">Archived</span><span class="muted small">closed Jun</span></div>
      <div class="name" style="font-size:16px">The Hunger Games</div>
      <div class="meta"><span>read-only</span></div>
    </div>
  </div>
</main>''')
    f.append("</div>")
    return "\n".join(f)


# ---------- Screen 2: Show overview ----------
def screen_show():
    f = ['<div class="frame" style="width:1280px;height:800px">', rail("script")]
    f.append(topbar('<span>Shows</span><span class="sep">/</span><b>Songs for a New World</b><span class="pill warn" style="margin-left:6px"><span class="dot"></span>Rehearsal</span>',
                    '<span class="sync"><span class="dot"></span>Synced</span>' + presence(("av-amber", "JN", "Jayden"), ("av-teal", "OL", "Oli, SND")) + '<button class="btn">Make available offline</button><button class="btn primary">Upload document</button>'))
    f.append('''<main class="content" style="padding:24px 32px;display:grid;grid-template-columns:1fr 340px;gap:28px;overflow:hidden">
  <div class="col" style="gap:22px;min-width:0">
    <div>
      <div class="section-label" style="margin-bottom:10px">Scripts</div>
      <div class="card" style="padding:0;overflow:hidden">
        <div class="row" style="padding:14px 16px;gap:14px;border-bottom:1px solid var(--line)">
          <div class="thumb" style="width:44px;height:58px;flex:none"><i style="top:8px"></i><i style="top:14px"></i><i style="top:20px;right:20px"></i><i style="top:30px"></i><i style="top:36px"></i></div>
          <div class="col" style="gap:2px;min-width:0;flex:1"><div style="font-weight:600;font-size:15px">Libretto</div>
            <div class="muted small">v2 current · 43 pages · searchable · <span class="pill blue" style="height:18px">4 to review</span></div></div>
          <div class="row"><button class="btn sm">Cue lists</button><button class="btn sm">Compare v1 → v2</button><button class="btn sm primary">Open</button></div>
        </div>
        <div class="row" style="padding:14px 16px;gap:14px">
          <div class="thumb" style="width:44px;height:58px;flex:none"><i style="top:8px"></i><i style="top:12px"></i><i style="top:16px"></i><i style="top:20px"></i><i style="top:24px"></i><i style="top:28px"></i></div>
          <div class="col" style="gap:2px;min-width:0;flex:1"><div style="font-weight:600;font-size:15px">Piano-vocal score</div>
            <div class="muted small">v1 current · 188 pages · scanned, OCR layer added</div></div>
          <div class="row"><button class="btn sm">Cue lists</button><button class="btn sm primary">Open</button></div>
        </div>
      </div>
    </div>
    <div>
      <div class="section-label" style="margin-bottom:10px">Cue lists by department</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
        <div class="card" style="padding:12px 14px"><div class="row" style="justify-content:space-between"><span class="dept"><span class="sw lx"></span>LX</span><span class="mono small muted">61</span></div><div class="small muted" style="margin-top:6px">2 duplicates</div></div>
        <div class="card" style="padding:12px 14px"><div class="row" style="justify-content:space-between"><span class="dept"><span class="sw snd"></span>SND</span><span class="mono small muted">28</span></div><div class="small muted" style="margin-top:6px">clean</div></div>
        <div class="card" style="padding:12px 14px"><div class="row" style="justify-content:space-between"><span class="dept"><span class="sw tm"></span>TM</span><span class="mono small muted">7</span></div><div class="small muted" style="margin-top:6px">mic cues, M3</div></div>
        <div class="ghost-card" style="padding:12px 14px;display:grid;place-items:center;font-size:12.5px">+ SM, VID, STG, FLY</div>
      </div>
    </div>
    <div>
      <div class="section-label" style="margin-bottom:10px">Recent activity</div>
      <div class="feed-row" style="border-top:0"><span class="avatar av-teal">OL</span><span class="lbl"><b>Oli</b> placed 6 SND cues and relabelled 1</span><span class="meta">14:02</span></div>
      <div class="feed-row"><span class="avatar av-amber">JN</span><span class="lbl"><b>Jayden</b> <span class="agent">via Claude Code</span> placed 42 LX cues</span><span class="meta">13:40</span></div>
      <div class="feed-row"><span class="avatar" style="background:var(--elev);color:var(--muted)">B</span><span class="lbl"><b>Binder</b> re-anchored 96 cues to Libretto v2 · 4 need review</span><span class="meta">13:12</span></div>
    </div>
  </div>
  <aside class="col" style="gap:16px">
    <div class="card" style="padding:14px 16px">
      <div class="t-over" style="margin-bottom:8px">In the binder now</div>
      <div class="col" style="gap:8px">
        <div class="row"><span class="avatar av-amber">JN</span><div class="col" style="gap:0"><span style="font-weight:600">Jayden</span><span class="small muted">Libretto · p.14</span></div></div>
        <div class="row"><span class="avatar av-teal">OL</span><div class="col" style="gap:0"><span style="font-weight:600">Oli</span><span class="small muted">Libretto · p.3 · SND 2.20 selected</span></div></div>
        <div class="row" style="opacity:.6"><span class="avatar av-blue">MK</span><div class="col" style="gap:0"><span style="font-weight:600">Mikaela</span><span class="small muted">in the show</span></div></div>
      </div>
    </div>
    <div class="card" style="padding:14px 16px">
      <div class="t-over" style="margin-bottom:8px">Needs you</div>
      <div class="col" style="gap:6px;font-size:13px">
        <div class="row" style="justify-content:space-between"><span>4 cues to review after the revision</span><button class="btn sm">Review</button></div>
        <div class="row" style="justify-content:space-between"><span>LX has 2 duplicate numbers</span><button class="btn sm">Fix</button></div>
      </div>
    </div>
    <div class="card" style="padding:14px 16px">
      <div class="t-over" style="margin-bottom:8px">Offline</div>
      <div class="small muted">Libretto v1, v2 and the score are cached on this device. <span class="mono">311 files</span>.</div>
    </div>
    <div class="row small muted" style="gap:14px;padding:0 4px"><a href="#" style="color:inherit">Settings</a><a href="#" style="color:inherit">Members</a><a href="#" style="color:inherit">Tokens</a></div>
  </aside>
</main>''')
    f.append("</div>")
    return "\n".join(f)


# ---------- Screen 3: Script markup (desktop) ----------
def screen_markup():
    f = ['<div class="frame" style="width:1280px;height:800px">', rail("script")]
    f.append(topbar('<span>Songs for a New World</span><span class="sep">/</span><b>Libretto</b><span class="pill rep" style="margin-left:4px">v2</span>',
                    '<span class="sync"><span class="dot"></span>Synced</span>' + presence(("av-amber", "JN", "Jayden"), ("av-teal", "OL", "Oli, SND")) + '<button class="btn ghost sm">' + ICON["undo"] + '</button><button class="btn ghost sm">' + ICON["redo"] + '</button><button class="btn sm">' + ICON["print"] + ' Print</button><button class="btn sm">Calling mode</button><button class="btn ghost sm">' + ICON["more"] + '</button>'))
    # thumbnails
    th = ['<div class="thumbs">']
    for n in range(1, 8):
        on = " on" if n == 1 else ""
        pa = '<span class="pa"><span class="avatar av-teal">OL</span></span>' if n == 3 else ""
        tags = ""
        if n == 1:
            tags = '<span class="ptag c-snd" style="right:3px;top:12px;width:9px"></span><span class="ptag c-lx" style="left:3px;top:20px;width:9px"></span><span class="ptag c-lx" style="left:3px;top:42px;width:9px"></span><span class="ptag c-snd" style="right:3px;top:50px;width:9px"></span>'
        elif n in (2, 4, 5):
            tags = '<span class="ptag c-snd" style="right:3px;top:30px;width:9px"></span>'
        th.append(f'<div class="thumb{on}"><i style="top:10px"></i><i style="top:18px;right:26px"></i><i style="top:26px"></i><i style="top:34px"></i><i style="top:46px;right:20px"></i><i style="top:54px"></i><i style="top:62px"></i>{tags}{pa}<span class="pn">{n}</span></div>')
    th.append("</div>")
    f.append("\n".join(th))
    # page area
    f.append('<div style="position:absolute;left:148px;right:300px;top:44px;bottom:26px;background:#0E0C0A;overflow:hidden">'
             '<div style="position:absolute;left:50%;top:22px;transform:translateX(-50%)">' + script_page(selected="lx12", peer="lx13") + "</div></div>")
    # floating tools
    f.append('<div class="tools" style="left:160px;top:62px" role="toolbar" aria-label="Markup tools">'
             + ''.join(f'<button class="tool{" on" if k=="cue" else ""}" title="{t}">{ICON[k]}<span class="k">{key}</span></button>' for k, t, key in
                       [("select", "Select", "v"), ("cue", "Cue", "c"), ("hilite", "Highlight", "h"), ("note", "Note", "n"), ("rect", "Box", "r"), ("arrow", "Arrow", "a"), ("stamp", "Stamp", "s")])
             + '<div class="tool-sep"></div><button class="tool" title="Search">' + ICON["search"] + '<span class="k">/</span></button></div>')
    # right panel
    f.append('''<aside class="panel" style="right:0;width:300px;top:44px;bottom:26px">
  <div class="panel-tabs"><button class="on">Cue</button><button>Layers</button><button>History</button><button>Review <span class="pill blue" style="height:16px;padding:0 6px;margin-left:4px">4</span></button></div>
  <div class="panel-body">
    <div class="row" style="justify-content:space-between"><span class="dept"><span class="sw lx"></span>LX <span class="mono" style="font-size:18px;font-weight:600;margin-left:4px">12</span></span><span class="pill ok"><span class="dot"></span>ok</span></div>
    <div class="field"><label>Number</label><div class="in mono">12</div></div>
    <div class="field"><label>Label</label><div class="in">Ship deck wash in</div></div>
    <div class="row" style="gap:12px"><div class="field" style="flex:1"><label>Type</label><div class="seg"><button class="on">Go</button><button>Standby</button><button>Warn</button></div></div>
      <div class="field" style="flex:1"><label>Layer</label><div class="in"><span class="dept"><span class="sw lx"></span>LX</span></div></div></div>
    <div class="field"><label>Trigger</label><div class="quote">“A new world calls across the ocean,” <span class="faint">p.1</span></div></div>
    <div class="field"><label>Notes</label><div class="in area">Follow the pad. Hold until the key change.</div></div>
    <div class="row" style="justify-content:space-between;margin-top:4px"><button class="btn sm ghost" style="color:var(--muted)">Delete</button><span class="small faint">edited by you · 2 min ago</span></div>
    <div class="section-label" style="margin-top:6px">Layers</div>
    <div class="col" style="gap:2px">
      <div class="layer-row active"><span class="sw lx"></span><span class="name">LX</span><span class="count">61</span><span class="ic"><span>''' + ICON["eye"] + '''</span><span>''' + ICON["unlock"] + '''</span></span></div>
      <div class="layer-row"><span class="sw snd"></span><span class="name">SND</span><span class="count">28</span><span class="ic"><span>''' + ICON["eye"] + '''</span><span style="color:var(--amber)">''' + ICON["lock"] + '''</span></span></div>
      <div class="layer-row"><span class="sw tm"></span><span class="name">TM</span><span class="count">7</span><span class="ic"><span>''' + ICON["eye"] + '''</span><span>''' + ICON["unlock"] + '''</span></span></div>
      <div class="layer-row" style="opacity:.55"><span class="sw sm"></span><span class="name">SM</span><span class="count">0</span><span class="ic"><span>''' + ICON["eye-off"] + '''</span><span>''' + ICON["unlock"] + '''</span></span></div>
      <div class="layer-row"><span class="sw me"></span><span class="name">Personal <span class="faint small">only you</span></span><span class="count">3</span><span class="ic"><span>''' + ICON["eye"] + '''</span><span>''' + ICON["unlock"] + '''</span></span></div>
    </div>
  </div>
</aside>''')
    f.append('<div class="statusbar"><span>Page <span class="mono">1</span> of <span class="mono">43</span></span><span class="sep-v"></span><span>Snap to text <span class="mono" style="color:var(--ok)">on</span></span><span class="sep-v"></span><span>Active layer <span class="dept" style="color:var(--amber)"><span class="sw lx"></span>LX</span></span><span class="spacer"></span><span><span class="kbd">c</span> place <span class="kbd">]</span> next cue <span class="kbd">g</span> go to page <span class="kbd">⌘K</span> anything</span></div>')
    f.append("</div>")
    return "\n".join(f)


# ---------- Screen 4: iPad calling mode ----------
def screen_calling():
    f = ['<div class="ipad" style="width:1024px;margin:0 auto"><div class="frame" style="width:992px;height:744px;background:#0A0908">']
    f.append('<div style="position:absolute;left:0;right:0;top:0;height:30px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;font-size:12px;color:var(--faint)">'
             '<span class="row"><span class="pill live" style="height:18px"><span class="dot"></span>Calling</span><span>Songs for a New World · Libretto v2</span></span>'
             '<span class="row"><span class="mono">21:14</span><span class="sync" style="color:var(--faint)"><span class="dot" style="background:var(--muted);box-shadow:none"></span>offline, cached</span></span></div>')
    f.append('<div style="position:absolute;left:50%;top:40px;transform:translateX(-50%)">' + script_page(w=640, h=846, left=110, scale_text=1.16) + "</div>")
    # floating strip
    f.append('<div style="position:absolute;left:50%;bottom:22px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(33,28,23,.92);border:2px solid var(--line-2);border-radius:16px;box-shadow:var(--sh-card);backdrop-filter:blur(8px)">'
             '<button class="btn sm ghost" style="font-size:16px;padding:0 10px">‹</button>'
             '<span class="mono" style="font-size:14px;color:var(--ink)">p.1</span><span class="faint">/ 43</span>'
             '<button class="btn sm ghost" style="font-size:16px;padding:0 10px">›</button>'
             '<span class="sep-v"></span>'
             '<span class="row" style="gap:6px"><span class="dept" style="color:var(--amber)"><span class="sw lx"></span>Next LX</span><span class="mono" style="color:var(--ink);font-size:14px">12</span><span class="muted small">Ship deck wash in</span></span>'
             '<span class="sep-v"></span><button class="btn sm">Go to…</button><button class="btn sm ghost">Exit</button></div>')
    f.append("</div></div>")
    return "\n".join(f)


# ---------- Screen 5: Cue list ----------
def screen_cuelist():
    rows = [
        ("2", "go", "Preshow bed out", "1", "#1 — The New World", "", "ok"),
        ("2.10", "go", "Band in", "1", "MAN 2", "Q in decent gap", "ok"),
        ("2.20", "go", "Verse 2 swell", "1", "And the road will end", "singing overlaps", "ok"),
        ("2.30", "go", "Woman 2 in", "1", "WOMAN 2", "Q in short gap", "ok"),
        ("2.40", "go", "Fast pace lines", "2", "TO A NEW WORLD!", "", "ok"),
        ("2.45", "standby", "LP in", "2", "MAN 1", "Q in super short gap", "approximate"),
        ("2.50", "go", "Harmonies", "3", "AND OH, YOU’RE SUDDENLY A STRANGER.", "", "ok"),
        ("2.50", "go", "Harmonies (dup)", "3", "", "", "duplicate"),
        ("2.60", "go", "", "3", "’TIL YOU SOMEHOW FIND A WAY", "", "ok"),
        ("2.70", "go", "Harmonies fade", "3", "THEN YOU MIGHT BE FREE…", "", "unresolved"),
        ("3", "go", "Spanish ship", "4", "#2 — On the Deck of a Spanish Sailing Ship", "", "ok"),
        ("3.10", "go", "Beggin’ you Lord", "4", "SO I’M BEGGIN’ YOU, LORD,", "", "ok"),
    ]
    f = ['<div class="frame" style="width:1280px;height:800px">', rail("cues")]
    f.append(topbar('<span>Songs for a New World</span><span class="sep">/</span><b>Cue lists</b>',
                    '<span class="sync"><span class="dot"></span>Synced</span><button class="btn sm">Renumber from script order…</button><button class="btn sm">' + ICON["exports"] + ' Export</button>'))
    tbl = ['<div class="content" style="display:grid;grid-template-columns:1fr 340px;overflow:hidden">',
           '<div style="padding:18px 24px;overflow:hidden">',
           '<div class="row" style="gap:10px;margin-bottom:14px"><div class="seg"><button>LX <span class="mono faint">61</span></button><button class="on">SND <span class="mono faint">28</span></button><button>TM <span class="mono faint">7</span></button></div>'
           '<span class="sep-v"></span><span class="pill warn">1 duplicate</span><span class="pill rep">1 approximate</span><span class="pill" style="background:var(--red-soft);color:#F26F73">1 unresolved</span><span class="spacer"></span><span class="row small muted"><span class="kbd">/</span> filter</span></div>',
           '<table class="table"><thead><tr><th style="width:70px">Cue</th><th style="width:70px">Type</th><th>Label</th><th style="width:52px" class="right">Page</th><th>Trigger</th><th>Notes</th><th style="width:90px"></th></tr></thead><tbody>']
    for i, (num, typ, label, page, trig, notes, flag) in enumerate(rows):
        sel = ' class="sel"' if i == 2 else ""
        flagcell = {"ok": "", "approximate": '<span class="pill rep">approx.</span>', "duplicate": '<span class="pill warn">duplicate</span>', "unresolved": '<span class="pill" style="background:var(--red-soft);color:#F26F73">unresolved</span>'}[flag]
        tbl.append(f'<tr{sel}><td class="n" style="font-weight:600">{num}</td><td class="muted">{typ}</td><td>{label or "<span class=faint>—</span>"}</td><td class="n right muted">{page}</td><td class="mono small" style="color:var(--ink-2);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{trig}</td><td class="small muted">{notes}</td><td>{flagcell}</td></tr>')
    tbl.append("</tbody></table></div>")
    tbl.append('''<aside class="panel" style="position:relative;top:0;bottom:0">
  <div class="panel-tabs"><button class="on">Cue</button><button>History</button></div>
  <div class="panel-body">
    <div class="row" style="justify-content:space-between"><span class="dept"><span class="sw snd"></span>SND <span class="mono" style="font-size:18px;font-weight:600;margin-left:4px">2.20</span></span><button class="btn sm">Show on page</button></div>
    <div class="field"><label>Label</label><div class="in">Verse 2 swell</div></div>
    <div class="field"><label>Trigger</label><div class="quote" style="border-color:var(--blue)">“And the road will end” <span class="faint">p.1, line 23</span></div></div>
    <div class="field"><label>Notes</label><div class="in area">singing overlaps — ride the pad under the harmony</div></div>
    <div class="section-label" style="margin-top:4px">History</div>
    <div class="hist">
      <div class="hist-row"><span class="avatar av-teal" style="width:20px;height:20px;font-size:8px">OL</span><div><div class="who">Oli <span class="what">relabelled “V2 swell” → “Verse 2 swell”</span></div><a class="rev" href="#">Revert this change</a></div><span class="when">14:02</span></div>
      <div class="hist-row"><span class="avatar av-amber" style="width:20px;height:20px;font-size:8px">JN</span><div><div class="who">Jayden <span class="what">moved on p.1</span></div><a class="rev" href="#">Revert this change</a></div><span class="when">13:40</span></div>
      <div class="hist-row"><span class="avatar av-amber" style="width:20px;height:20px;font-size:8px">JN</span><div><div class="who">Jayden <span class="agent" style="color:var(--purple)">via Claude Code</span> <span class="what">placed on p.1</span></div></div><span class="when">13:12</span></div>
    </div>
  </div>
</aside></div>''')
    f.append("\n".join(tbl))
    f.append("</div>")
    return "\n".join(f)


# ---------- Screen 6: Activity ----------
def screen_activity():
    f = ['<div class="frame" style="width:1280px;height:620px">', rail("activity")]
    f.append(topbar('<span>Songs for a New World</span><span class="sep">/</span><b>Activity</b>', '<span class="sync"><span class="dot"></span>Synced</span>'))
    f.append('''<main class="content" style="padding:18px 32px;overflow:hidden;max-width:980px">
  <div class="filters" style="margin-bottom:10px"><div class="seg"><button class="on">All layers</button><button><span class="sw lx" style="display:inline-block;margin-right:5px"></span>LX</button><button><span class="sw snd" style="display:inline-block;margin-right:5px"></span>SND</button><button><span class="sw tm" style="display:inline-block;margin-right:5px"></span>TM</button></div>
  <div class="seg"><button class="on">People and agents</button><button>People</button><button>Agents</button></div><span class="spacer"></span><span class="small muted">Today</span></div>
  <div class="feed-row" style="border-top:0"><span class="avatar av-teal">OL</span><div><div class="lbl"><b>Oli</b> placed 6 SND cues and relabelled 1</div><div class="small faint">SND · p.1–3</div></div><div class="row"><span class="meta">14:02</span><button class="btn sm">Revert</button></div></div>
  <div class="feed-row"><span class="avatar av-amber">JN</span><div><div class="lbl"><b>Jayden</b> <span class="agent">via Claude Code</span> placed 42 LX cues</div><div class="small faint">LX · p.1–40 · batch from the theatremix script skill</div></div><div class="row"><span class="meta">13:40</span><button class="btn sm">Revert 42 rows…</button></div></div>
  <div class="feed-row"><span class="avatar" style="background:var(--elev);color:var(--muted)">B</span><div><div class="lbl"><b>Binder</b> re-anchored 96 cues to Libretto v2</div><div class="small faint">92 ok · 3 approximate · 1 unresolved · <a href="#">open review</a></div></div><div class="row"><span class="meta">13:12</span><button class="btn sm">Revert run</button></div></div>
  <div class="feed-row"><span class="avatar av-amber">JN</span><div><div class="lbl"><b>Jayden</b> uploaded Libretto v2</div><div class="small faint">43 pages · cuts in #4</div></div><div class="row"><span class="meta">13:09</span></div></div>
  <div class="feed-row"><span class="avatar av-blue">MK</span><div><div class="lbl"><b>Mikaela</b> relabelled 3 LX cues and moved 1</div><div class="small faint">LX · p.12</div></div><div class="row"><span class="meta">yesterday 22:51</span><button class="btn sm">Revert</button></div></div>
  <div class="row" style="margin-top:16px;gap:12px;padding:10px 12px;border:1px dashed var(--line-2);border-radius:10px;font-size:12.5px;color:var(--muted)">Personal layers never appear here. Your own personal notes show in your row history only.</div>
</main>''')
    f.append("</div>")
    return "\n".join(f)


# ---------- Screen 7: Review ----------
def screen_review():
    f = ['<div class="frame" style="width:1280px;height:620px">', rail("script")]
    f.append(topbar('<span>Songs for a New World</span><span class="sep">/</span><b>Libretto</b><span class="pill rep" style="margin-left:4px">v2</span><span class="pill blue" style="margin-left:6px">4 to review</span>',
                    '<span class="sync"><span class="dot"></span>Synced</span><button class="btn sm">Compare v1 → v2</button>'))
    f.append('<div style="position:absolute;left:56px;right:420px;top:44px;bottom:0;background:#0E0C0A;overflow:hidden"><div style="position:absolute;left:50%;top:16px;transform:translateX(-50%) scale(.78);transform-origin:top center">' + script_page(selected="lx12") + "</div></div>")
    f.append('''<aside class="panel" style="right:0;width:420px;top:44px;bottom:0">
  <div class="panel-tabs"><button>Cue</button><button>Layers</button><button>History</button><button class="on">Review <span class="pill blue" style="height:16px;padding:0 6px;margin-left:4px">4</span></button></div>
  <div class="panel-body">
    <div class="small muted">Libretto v2 cut 16 lines in #4. Binder moved every cue; these four need a look. Everything else is <span class="pill ok" style="height:16px">ok</span>.</div>
    <div class="section-label">Pending <span class="faint">· on the current version</span></div>
    <div class="review-item" style="border-top:0"><div><div class="dept" style="color:var(--amber)"><span class="sw lx"></span>LX <span class="mono">41</span> <span class="pill rep" style="margin-left:4px">approximate</span></div><div class="small muted">“the moment before it all” · was p.9, now p.8</div></div>
      <div class="review-thumb c-lx"><i style="top:8px"></i><i style="top:14px"></i><span class="q" style="left:18px;top:19px;width:40px"></span><i style="top:28px"></i><i style="top:34px"></i><span class="lab">v1 p.9</span></div>
      <div class="review-thumb c-lx"><i style="top:8px"></i><span class="q" style="left:18px;top:13px;width:40px"></span><i style="top:22px"></i><i style="top:28px"></i><i style="top:34px"></i><span class="lab">v2 p.8</span></div>
      <div class="col" style="gap:4px"><button class="btn sm primary">Accept</button><button class="btn sm">Move</button><button class="btn sm ghost">Revert</button></div></div>
    <div class="review-item"><div><div class="dept" style="color:var(--amber)"><span class="sw lx"></span>LX <span class="mono">42</span> <span class="pill rep" style="margin-left:4px">approximate</span></div><div class="small muted">“nothing to fear” · same page, line moved</div></div>
      <div class="review-thumb c-lx"><i style="top:8px"></i><i style="top:14px"></i><i style="top:20px"></i><span class="q" style="left:18px;top:25px;width:36px"></span><i style="top:34px"></i><span class="lab">v1 p.9</span></div>
      <div class="review-thumb c-lx"><i style="top:8px"></i><i style="top:14px"></i><span class="q" style="left:18px;top:19px;width:36px"></span><i style="top:28px"></i><i style="top:34px"></i><span class="lab">v2 p.9</span></div>
      <div class="col" style="gap:4px"><button class="btn sm primary">Accept</button><button class="btn sm">Move</button><button class="btn sm ghost">Revert</button></div></div>
    <div class="review-item"><div><div class="dept" style="color:var(--snd)"><span class="sw snd"></span>SND <span class="mono">4.20</span> <span class="pill" style="background:var(--red-soft);color:#F26F73;margin-left:4px">unresolved</span></div><div class="small muted">“when the wind starts to blow” · line was cut</div></div>
      <div class="review-thumb c-snd"><i style="top:8px"></i><span class="q" style="left:18px;top:13px;width:48px"></span><i style="top:22px"></i><i style="top:28px"></i><i style="top:34px"></i><span class="lab">v1 p.10</span></div>
      <div class="review-thumb c-snd"><i style="top:8px"></i><i style="top:14px"></i><i style="top:20px"></i><i style="top:26px"></i><span style="position:absolute;left:6px;top:28px;width:1.5px;height:8px;background:currentColor"></span><i style="top:34px"></i><span class="lab">v2 p.10 · tick</span></div>
      <div class="col" style="gap:4px"><button class="btn sm">Move</button><button class="btn sm ghost">Revert</button><button class="btn sm ghost" style="color:var(--muted)">Delete</button></div></div>
    <div class="section-label">On an older version <span class="faint">· 1</span></div>
    <div class="review-item" style="border-top:0"><div><div class="dept" style="color:var(--tm)"><span class="sw tm"></span>TM <span class="mono">12.50</span></div><div class="small muted">placed offline on v1 after the switch</div></div>
      <div class="review-thumb c-tm"><i style="top:8px"></i><i style="top:14px"></i><span class="q" style="left:18px;top:19px;width:30px"></span><i style="top:28px"></i><span class="lab">v1 p.14</span></div>
      <div class="review-thumb" style="background:var(--card);border:1px dashed var(--line-2)"><span class="lab" style="color:var(--faint)">not on v2</span></div>
      <div class="col" style="gap:4px"><button class="btn sm primary">Re-anchor</button><button class="btn sm">Move</button></div></div>
  </div>
</aside>''')
    f.append("</div>")
    return "\n".join(f)


# ---------- assemble ----------

def part(kicker, title, blurb):
    return f'<div class="part"><span class="kicker">{kicker}</span><h2>{title}</h2><p>{blurb}</p></div>'


def main():
    page = [head, '''
    <header class="mast">
      <div class="brandline"><span class="mark">B</span><span class="brandtext">Binder</span><span class="chip">by RVLT</span><span class="chip chip-draft">UI direction, draft 1</span></div>
      <h1>Prompt corner</h1>
      <p class="standfirst">The place in a theatre where the stage manager sits with the book and the cue lights: dark, calm, everything in reach, the script lit and the rest dimmed. Seven screens drawn at real size on RVLT Flow’s design system, with the page itself always paper. <span class="hand">react to the direction, not the pixels</span></p>
      <ul class="toc">
        <li><a href="#home">1 Shows</a></li><li><a href="#show">2 Show overview</a></li><li><a href="#markup">3 Script markup</a></li><li><a href="#calling">4 Calling mode (iPad)</a></li><li><a href="#cues">5 Cue list</a></li><li><a href="#activity">6 Activity</a></li><li><a href="#review">7 Revision review</a></li><li><a href="#system">The system</a></li>
      </ul>
    </header>
    ''']

    page.append(wrap("home", "01 · 1280 × 800", "Shows",
        "Home is a greeting and the shows you are in, as cards. Status, who is in the binder, and the last thing that happened. Archived shows sit below, read-only and still exportable.",
        ["<b>Cards, not a list.</b> A show is a thing you pick up; the card carries its state at a glance.",
         "<b>Rail on the left</b> is Binder’s whole navigation: Script, Cues, Docs (M2), Activity, Exports. Each has a module hue, like Flow.",
         "<b>Operator voice</b> only in the greeting and the empty card (Kalam); nowhere a cue is involved.",
         "<b>⌘K</b> jumps to a show, a cue number or a page from anywhere."],
        screen_home(), 1280, 800))

    page.append(wrap("show", "02 · 1280 × 800", "Show overview",
        "One screen per show: the scripts, the cue lists by department, recent activity, who is here now, and what needs you. The right column is sticky and the same on every show.",
        ["<b>Needs you</b> surfaces the two things M1 can tell you: cues to review after a revision, and duplicate numbers.",
         "<b>Department cards</b> carry their colour and count; clicking one opens that cue list.",
         "<b>Presence</b> lists people with their document and page; someone in the show but not on a document reads “in the show”."],
        screen_show(), 1280, 800))

    page.append(wrap("markup", "03 · 1280 × 800 · the main screen", "Script markup",
        "The page is the brightest thing on screen and the chrome stays out of its way. Thumbnails on the left, a floating tool strip, one context panel on the right that follows the selection. The markup is exactly what prints: margin tags, trigger highlights, leaders.",
        ["<b>Tags in the margin</b>, LX left and SND right per the show setting; a dashed outline is a standby. The selected cue has a red outline; Oli’s selection (purple, his colour) shows on LX 13.",
         "<b>The panel</b> edits the selected cue: number in mono, label, type as a segmented control, trigger quote from the page, notes. Layers live underneath with eye and lock.",
         "<b>Tool strip</b> carries its own key hints; the status bar repeats the four shortcuts people forget.",
         "<b>Thumbnails</b> show tag marks per side and the avatar of anyone on that page.",
         "<b>Light “Paper” mode</b> keeps this layout; only the chrome lightens."],
        screen_markup(), 1280, 800))

    page.append(wrap("calling", "04 · iPad 11″ landscape · Calling mode", "Calling mode",
        "In the room the chrome goes away. The page fills the screen at reading size, one hand turns pages, nothing can be edited. The strip at the bottom shows where you are and the next cue on your department.",
        ["<b>Nothing editable.</b> Calling mode is the version switcher’s read-only state with the chrome removed.",
         "<b>Next cue</b> reads from the cue list in page order for the active department, so the operator never hunts.",
         "<b>Offline, cached</b> is the normal state here and reads as calm, not as a warning.",
         "<b>Go to…</b> is the only overlay: a cue number or a page, big keys."],
        screen_calling(), 1024, 776))

    page.append(wrap("cues", "05 · 1280 × 800", "Cue list",
        "A dense table per department with inline editing, flags as pills, and the selected cue’s detail and history in the same right panel the script uses. Export and renumber sit in the top bar.",
        ["<b>Numbers are mono and tabular</b> everywhere, so 2.10 and 2.45 line up.",
         "<b>Flags are pills with words</b>, never colour alone: duplicate, approximate, unresolved.",
         "<b>Show on page</b> jumps to the script with the cue selected; the panel stays."],
        screen_cuelist(), 1280, 800))

    page.append(wrap("activity", "06 · 1280 × 620", "Activity",
        "The change log as sentences, grouped by batch, with Revert on each. Agents are labelled “via Claude Code” in purple so AI work is always visible. Reverting more than ten rows says so on the button.",
        ["<b>Binder’s own runs</b> (re-anchoring) are a row like any other, with a Revert run action.",
         "<b>Filters</b> by layer and by people or agents map straight onto the M1 feed API.",
         "<b>Personal layers</b> never appear; the footer says so."],
        screen_activity(), 1280, 620))

    page.append(wrap("review", "07 · 1280 × 620", "Revision review",
        "After a new script version, each cue Binder could not place with confidence is one row: old thumbnail, new thumbnail, accept or move or revert. Unresolved cues show a tick where the words used to be.",
        ["<b>Before and after</b> at a glance, with the quote and page change in words.",
         "<b>Older version</b> rows are cues someone placed offline on v1 after the switch; Re-anchor is their primary action.",
         "<b>Compare v1 → v2</b> opens the side-by-side with cut and added lines tinted."],
        screen_review(), 1280, 620))

    # ---------- parts 2 and 3: the theme modules (each previewable alone with _preview.py) ----------
    import re as _re
    import screens2_access, screens2_documents, screens2_overlays
    try:
        import screens2_mobile
    except ImportError:
        screens2_mobile = None
    modules = [m for m in (screens2_access, screens2_documents, screens2_overlays, screens2_mobile) if m]
    page.insert(1, "".join(f"<style>{m.CSS}</style>" for m in modules if getattr(m, "CSS", "")))
    small = lambda id_: id_.startswith(("phone-", "m-", "t-"))  # noqa: E731
    part2 = [s for m in modules for s in m.SCREENS if not small(s[0])]
    part3 = [s for m in modules for s in m.SCREENS if small(s[0])]
    toc = [("home", "1 Shows"), ("show", "2 Show overview"), ("markup", "3 Script markup"), ("calling", "4 Calling mode (iPad)"),
           ("cues", "5 Cue list"), ("activity", "6 Activity"), ("review", "7 Revision review")]
    n = 8

    def add(screens):
        nonlocal n
        for id_, kicker, title, blurb, notes, fn, w_, h_ in screens:
            page.append(wrap(id_, _re.sub(r"^\d+", f"{n:02d}", kicker), title, blurb, notes, fn(), w_, h_))
            toc.append((id_, f"{n} {title}"))
            n += 1

    page.append(part("Part 2", "The other surfaces",
        "Everything the first seven did not cover: the front door, setting a show up, settings and tokens, documents and what happens while one is processed, compare, exports, the print sheet, the command palette, the calling-mode keypad, and the states between the happy screens. Same system, no new rules."))
    add(part2)
    page.append(part("Part 3", "Phone and tablet",
        "Binder is fully mobile. Every surface has a phone layout and the script has a tablet one. Inside a show a bottom tab bar (Script · Cues · Docs · Activity · More) replaces the rail, the page fills the width, the right panel becomes a bottom sheet, tables become cards, targets are 44 px and nothing depends on hover. The shows list sits above the tab level."))
    add(part3)

    page.append('''<section class="screen" id="system">
      <div class="screen-head"><span class="kicker">The system</span><h2>What Binder inherits, and where it differs</h2>
      <p>Everything here uses RVLT Flow’s tokens verbatim: espresso surfaces, one red, warm ink, hard offset shadows, Archivo for display, Hanken Grotesk for UI, Geist Mono for every number. Three things are Binder’s own.</p></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:8px">
        <div class="card" style="padding:16px 18px;background:var(--pg-2);border-color:var(--pg-line);box-shadow:none;color:var(--pg-ink)"><div style="font-family:var(--disp);font-weight:800;font-size:17px;margin-bottom:6px">The page is paper</div><p class="small" style="margin:0;color:var(--pg-mut)">The PDF renders white inside dark chrome, in both themes. Department colours are tuned to read as ink on white: LX amber darkens to <span class="mono">#C9811F</span>, SND blue to <span class="mono">#2F6BD6</span>. The dark-UI tints are for chrome only.</p></div>
        <div class="card" style="padding:16px 18px;background:var(--pg-2);border-color:var(--pg-line);box-shadow:none;color:var(--pg-ink)"><div style="font-family:var(--disp);font-weight:800;font-size:17px;margin-bottom:6px">Department colour is the only colour on the page</div><p class="small" style="margin:0;color:var(--pg-mut)">Chrome stays monochrome plus red for the one primary action. Presence uses the person’s colour, never the department’s, and only as initials and a thin outline.</p></div>
        <div class="card" style="padding:16px 18px;background:var(--pg-2);border-color:var(--pg-line);box-shadow:none;color:var(--pg-ink)"><div style="font-family:var(--disp);font-weight:800;font-size:17px;margin-bottom:6px">Two modes, one layout</div><p class="small" style="margin:0;color:var(--pg-mut)">Markup is the full shell. Calling strips it to the page. The right panel is the same component on the script, the cue list and the review, so there is one place to learn.</p></div>
      </div>
          <div class="part" style="margin-top:28px;padding-top:22px"><span class="kicker">Three widths</span><h2 style="font-size:20px">One system, three layouts</h2></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:8px">
        <div class="card" style="padding:16px 18px;background:var(--pg-2);border-color:var(--pg-line);box-shadow:none;color:var(--pg-ink)"><div style="font-family:var(--disp);font-weight:800;font-size:17px;margin-bottom:6px">Phone, under 768</div><p class="small" style="margin:0;color:var(--pg-mut)">Bottom tab bar inside a show; the shows list above it. Single column, cards instead of tables, the page at full width with the tags still in the margins, the panel as a bottom sheet, a “Place cue” button instead of the tool strip. 44 px targets, no hover.</p></div>
        <div class="card" style="padding:16px 18px;background:var(--pg-2);border-color:var(--pg-line);box-shadow:none;color:var(--pg-ink)"><div style="font-family:var(--disp);font-weight:800;font-size:17px;margin-bottom:6px">Tablet, 768 to 1024</div><p class="small" style="margin:0;color:var(--pg-mut)">The rail keeps its icons and drops its labels. Thumbnails hide by default. The panel slides over the page from the right when something is selected. Calling mode is designed for this width first.</p></div>
        <div class="card" style="padding:16px 18px;background:var(--pg-2);border-color:var(--pg-line);box-shadow:none;color:var(--pg-ink)"><div style="font-family:var(--disp);font-weight:800;font-size:17px;margin-bottom:6px">Desktop, over 1024</div><p class="small" style="margin:0;color:var(--pg-mut)">The full shell: rail with labels, thumbnails, tool strip, the right panel docked. Keyboard first: c, ], g and ⌘K do most of the work.</p></div>

      </div>
  <div class="notes" style="margin-top:22px">
        <li><b>Not drawn yet:</b> the invite email, the cue sheet print layout, Paper (light) mode on every screen, the TheatreMix import flow. They take the system as it stands.</li>
        <li><b>Build path:</b> adopt Flow’s registry theme and components in apps/web (shadcn + Tailwind v4), then restyle screen by screen in the order above. Accessibility work from M1 (keyboard markers, labelled controls, live regions) stays.</li>
      </div>
    </section>

    ''' + FIT_SCRIPT + '''
    ''')

    toc_html = '<ul class="toc">' + "".join(f'<li><a href="#{i}">{l}</a></li>' for i, l in toc) + '<li><a href="#system">The system</a></li></ul>'
    mi = next(i for i, p_ in enumerate(page) if 'class="mast"' in p_)
    page[mi] = _re.sub(r'<ul class="toc">.*?</ul>', toc_html, page[mi], flags=_re.S)
    page[mi] = page[mi].replace("Seven screens drawn at real size", f"{n - 1} screens drawn at real size").replace("UI direction, draft 1", "UI direction, draft 2")
    (HERE / "index.html").write_text("\n".join(page))
    print("wrote index.html", sum(len(p) for p in page))



if __name__ == '__main__':
    main()
