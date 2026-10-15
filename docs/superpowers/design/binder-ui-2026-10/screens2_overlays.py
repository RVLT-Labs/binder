#!/usr/bin/env python3
"""Binder UI mockup, theme: overlays, phone and states. Five screens: palette, goto, phone-calling, phone-home, states.
CSS prefix: ov-. Preview with: python3 _preview.py screens2_overlays"""
from _parts import *  # noqa: F401,F403
from _build import screen_markup, screen_calling
import re

CSS = """
/* shared */
.ov-ic{display:inline-grid;place-items:center;flex:none;width:18px;height:18px}
.ov-ic svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.ov-scrim{position:absolute;left:0;top:0;right:0;bottom:0;background:rgba(10,8,6,.68)}
.ov-code{font-family:var(--mono);font-weight:600;font-variant-numeric:tabular-nums}
.ov-code.lx{color:var(--amber)} .ov-code.snd{color:var(--blue)} .ov-code.tm{color:var(--purple)}

/* palette */
.ov-pal{position:absolute;left:320px;top:72px;width:640px;background:var(--card);border:2px solid var(--line-2);border-radius:20px;box-shadow:0 6px 0 #0C0A08,0 30px 60px rgba(0,0,0,.45);overflow:hidden}
.ov-pal-in{display:flex;align-items:center;gap:12px;height:60px;padding:0 18px;border-bottom:1px solid var(--line);color:var(--muted)}
.ov-pal-in .ov-ic{width:20px;height:20px} .ov-pal-in .ov-ic svg{width:20px;height:20px}
.ov-typed{font-family:var(--mono);font-size:18px;color:var(--ink);display:inline-flex;align-items:center}
.ov-caret{display:inline-block;width:2px;height:24px;background:var(--ink);margin-left:1px}
.ov-lab{padding:10px 18px 4px;font-size:11px;font-weight:600;color:var(--muted)}
.ov-res{display:flex;align-items:center;gap:12px;height:38px;padding:0 18px;font-size:14px;color:var(--ink)}
.ov-res .ov-ic{color:var(--muted)}
.ov-res.cur{background:rgba(224,54,61,.12);box-shadow:inset 3px 0 0 var(--red)}
.ov-res.cur .ov-ic{color:var(--ink)}
.ov-res .grow{flex:1;min-width:0;display:flex;align-items:center;gap:8px;white-space:nowrap}
.ov-res .dotsep{color:var(--faint)}
.ov-res .lbl2{color:var(--ink-2)}
.ov-res .pg{font-family:var(--mono);font-size:12px;color:var(--muted)}
.ov-foot{display:flex;align-items:center;height:38px;padding:0 18px;border-top:1px solid var(--line);background:var(--paper-2);font-family:var(--mono);font-size:11px;color:var(--muted);margin-top:6px}

/* go to (iPad) */
.ov-gt-wrap{position:absolute;left:0;top:0;right:0;bottom:0;display:grid;place-items:center}
.ov-gt{width:384px;padding:22px;background:var(--card);border:2px solid var(--line-2);border-radius:20px;box-shadow:0 6px 0 #050403,0 30px 60px rgba(0,0,0,.55);display:flex;flex-direction:column;gap:14px}
.ov-gt-seg{display:flex;border:2px solid var(--line-2);border-radius:12px;overflow:hidden}
.ov-gt-seg button{flex:1;height:44px;font-size:16px;font-weight:700;color:var(--muted)}
.ov-gt-seg button.on{background:var(--elev);color:var(--ink);box-shadow:inset 0 -3px 0 var(--red)}
.ov-read{display:flex;align-items:center;height:76px;padding:0 18px;border:2px solid var(--line-2);border-radius:14px;background:var(--paper)}
.ov-read .big{font-family:var(--mono);font-size:40px;line-height:1;color:var(--ink);font-variant-numeric:tabular-nums}
.ov-read .ov-caret{height:42px;width:3px;margin-left:3px}
.ov-match{display:flex;align-items:center;justify-content:center;gap:8px;height:22px;font-size:15px;color:var(--ink-2);white-space:nowrap}
.ov-keys{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.ov-key{height:64px;border-radius:16px;background:var(--elev);border:2px solid var(--line-2);box-shadow:var(--sh-card);display:grid;place-items:center;font-family:var(--mono);font-size:28px;color:var(--ink);font-variant-numeric:tabular-nums}
.ov-key.alt{background:var(--paper-2);color:var(--ink-2)}
.ov-acts{display:flex;gap:10px}
.frame .ov-big{height:56px;border-radius:14px;font-size:18px;font-weight:700;justify-content:center}
.ov-lab-big{font-size:12px;font-weight:600;color:var(--muted);margin-bottom:6px}
.ov-chips{display:flex;gap:10px}
.ov-chip{display:inline-flex;align-items:center;height:40px;padding:0 14px;border-radius:999px;border:2px solid var(--line-2);font-family:var(--mono);font-size:15px;color:var(--ink);background:var(--paper-2)}

/* phones */
.ov-phone{border-radius:44px;overflow:hidden;background:#0A0908;box-shadow:inset 0 0 0 3px #1E1915}
.ov-island{position:absolute;left:145px;top:12px;width:100px;height:28px;border-radius:14px;background:#000;border:1px solid #1E1915}
.ov-homebar{position:absolute;left:135px;bottom:8px;width:120px;height:4px;border-radius:2px;background:var(--ink-2);opacity:.5}
.ov-pstatus{position:absolute;left:18px;right:18px;top:52px;height:22px;display:flex;align-items:center;justify-content:space-between;font-family:var(--mono);font-size:11px;color:var(--faint);white-space:nowrap}
.ov-pstatus .live{display:inline-flex;align-items:center;gap:6px;color:var(--ink-2)}
.ov-pstatus .live i{width:7px;height:7px;border-radius:50%;background:var(--red);display:inline-block}
.ov-pstrip{position:absolute;left:12px;right:12px;bottom:30px;padding:10px 12px;background:rgba(33,28,23,.94);border:2px solid var(--line-2);border-radius:16px;box-shadow:var(--sh-card);display:flex;flex-direction:column;gap:8px}
.ov-prow{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ov-pnav{display:flex;align-items:center;gap:4px}
.ov-pbtn{height:40px;min-width:40px;padding:0 12px;border-radius:12px;display:inline-grid;place-items:center;font-size:20px;color:var(--ink-2)}
.ov-pbtn.go{font-size:14px;font-weight:700;color:var(--ink);background:var(--elev);border:2px solid var(--line-2);padding:0 18px;height:40px}
.ov-pnext{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-2);white-space:nowrap;overflow:hidden}
.ov-pnext .ov-code{font-size:14px}
.ov-pnext .lbl3{overflow:hidden;text-overflow:ellipsis;color:var(--muted)}

.ov-ptop{position:absolute;left:0;right:0;top:52px;height:48px;padding:0 18px;display:flex;align-items:center;justify-content:space-between}
.ov-ptop .ttl{font-family:var(--disp);font-weight:800;font-size:20px;letter-spacing:-.02em}
.ov-ph-body{position:absolute;left:16px;right:16px;top:108px;bottom:86px;overflow:hidden;display:flex;flex-direction:column;gap:10px}
.ov-greet{font-family:var(--disp);font-weight:800;font-size:24px;letter-spacing:-.025em;line-height:1.15}
.ov-tabs{position:absolute;left:0;right:0;bottom:0;height:86px;background:var(--paper-2);border-top:1px solid var(--line);display:grid;grid-template-columns:repeat(4,1fr);padding:8px 8px 0}
.ov-tab{display:flex;flex-direction:column;align-items:center;gap:3px;color:var(--muted);font-size:11px;font-weight:600;height:46px;justify-content:center}
.ov-tab .ov-ic,.ov-tab .ov-ic svg{width:24px;height:24px}
.ov-tab.on{color:var(--red)}

/* states sheet */
.frame .ov-btn{display:inline-flex;align-items:center;height:34px;padding:0 16px;border:2px solid var(--line-2);border-radius:10px;background:var(--elev);color:var(--ink);font-size:13px;font-weight:600}
.frame .ov-btn.primary{background:var(--red);border-color:var(--red);color:#fff;box-shadow:var(--sh-stk),var(--lit)}
.ov-cap{font-family:var(--mono);font-size:11px;color:var(--faint);margin-bottom:8px}
.ov-banner{display:flex;align-items:center;gap:12px;height:44px;padding:0 16px;background:var(--elev);border:2px solid var(--line-2);border-radius:12px;font-size:13.5px;color:var(--ink-2)}
.ov-banner .ov-ic{color:var(--muted)}
.ov-hand{font-family:var(--hand);font-size:18px;color:var(--ink-2);line-height:1.3}
.ov-toast{display:flex;align-items:center;gap:12px;padding:12px 14px 12px 16px;background:var(--elev);border:2px solid var(--line-2);border-radius:12px;box-shadow:var(--sh-stk);font-size:13.5px}
.ov-toast .x{width:24px;height:24px;display:grid;place-items:center;color:var(--muted);font-size:18px;line-height:1}
.ov-toast a{color:var(--blue);font-weight:600;font-size:13px}
.ov-sk{height:12px;border-radius:6px;background:var(--elev)}
.ov-skrow{display:grid;grid-template-columns:52px 1fr 44px;gap:16px;align-items:center;height:46px;padding:0 16px;border-top:1px solid var(--line)}
.ov-skrow:first-child{border-top:0}
.ov-bar{display:flex;align-items:center;gap:22px;height:46px;padding:0 16px;background:var(--paper-2);border:2px solid var(--line-2);border-radius:12px}
.ov-bar .dot.amber{background:var(--amber);box-shadow:0 0 0 2px var(--warn-soft)}
.ov-bar .dot.muted{background:var(--muted);box-shadow:0 0 0 2px rgba(158,148,131,.18)}
.ov-bar .dot.red{background:var(--red);box-shadow:0 0 0 2px var(--red-soft)}
.ov-bar .sync{color:var(--ink-2)}
.ov-h{font-family:var(--disp);font-weight:800;font-size:18px;letter-spacing:-.02em;line-height:1.2}
"""


# ---------- helpers ----------
def ic(name):
    return f'<span class="ov-ic">{ICON[name]}</span>'


def under(base_html):
    """A whole existing screen, pinned at the frame's origin as the layer under an overlay."""
    return base_html.replace('<div class="frame"', '<div class="frame" data-base="1"', 1)


# ---------- 8: command palette ----------
def screen_palette():
    def res(icon, main, right="", cur=False):
        return f'<div class="ov-res{" cur" if cur else ""}">{ic(icon)}<span class="grow">{main}</span>{right}</div>'

    sep = '<span class="dotsep">·</span>'
    lx = lambda n: f'<span class="ov-code lx">LX {n}</span>'
    snd = lambda n: f'<span class="ov-code snd">SND {n}</span>'
    f = ['<div class="frame" style="width:1280px;height:800px">']
    f.append('<div style="position:absolute;left:0;top:0;width:1280px;height:800px">' + screen_markup() + "</div>")
    f.append('<div class="ov-scrim"></div>')
    f.append('<div class="ov-pal" role="dialog" aria-label="Command palette">')
    f.append(f'<div class="ov-pal-in">{ic("search")}<span class="ov-typed">lx 12<span class="ov-caret"></span></span><span class="spacer"></span><span class="kbd">esc</span></div>')
    f.append('<div class="ov-lab">Go to</div>')
    f.append(res("cue", f'{lx("12")}{sep}<span>Ship deck wash in</span>', '<span class="pg">p.1</span><span class="kbd" style="margin-left:6px">↵</span>', cur=True))
    f.append(res("script", '<span>Page</span><span class="ov-code" style="font-weight:600">12</span>', '<span class="pg">of 43</span>'))
    f.append('<div class="ov-lab">Cues</div>')
    f.append(res("cue", f'{lx("12.5")}{sep}<span class="lbl2">Deck wash build</span>', '<span class="pg">p.2</span>'))
    f.append(res("cue", f'{lx("120")}{sep}<span class="lbl2">Finale wash</span>', '<span class="pg">p.41</span>'))
    f.append('<div class="ov-lab">In the script</div>')
    f.append(res("search", '<span><span class="mono">3</span> lines contain “<span class="mono">12</span>”</span>', '<span class="pg">search</span>'))
    f.append('<div class="ov-lab">Actions</div>')
    f.append(res("script", "<span>Switch to calling mode</span>", '<span class="kbd">⇧C</span>'))
    f.append(res("print", "<span>Print…</span>", '<span class="kbd">⌘P</span>'))
    f.append(res("cues", "<span>Renumber from script order</span>"))
    f.append(res("eye-off", "<span>Hide SND layer</span>"))
    f.append('<div class="ov-foot">↑↓ move · ↵ open · esc close</div>')
    f.append("</div></div>")
    return "\n".join(f)


# ---------- 9: go to (iPad) ----------
def screen_goto():
    base = screen_calling()
    open_tag = '<div class="ipad" style="width:1024px;margin:0 auto">'
    assert base.startswith(open_tag)
    t = base[len(open_tag):]
    t = t[: t.rfind("</div>")]          # drop the bezel's closing div
    t = t[: t.rfind("</div>")]          # now t is the frame without its closing div
    keys = "".join(f'<div class="ov-key">{k}</div>' for k in "123456789") + '<div class="ov-key">.</div><div class="ov-key">0</div><div class="ov-key alt">⌫</div>'
    overlay = f'''<div class="ov-scrim" style="background:rgba(6,5,4,.78)"></div>
<div class="ov-gt-wrap"><div class="ov-gt" role="dialog" aria-label="Go to">
  <div class="ov-gt-seg"><button class="on">Cue</button><button>Page</button></div>
  <div class="ov-read"><span class="big">2.2</span><span class="ov-caret"></span></div>
  <div class="ov-match"><span class="ov-code snd" style="font-size:16px">SND 2.20</span><span class="faint">·</span><span>Verse 2 swell</span><span class="faint">·</span><span class="mono" style="color:var(--muted)">p.1</span></div>
  <div class="ov-keys">{keys}</div>
  <div class="ov-acts"><button class="btn ghost ov-big" style="width:112px;flex:none">Cancel</button><button class="btn primary ov-big" style="flex:1">Go</button></div>
  <div><div class="ov-lab-big">Recent</div><div class="ov-chips"><span class="ov-chip">LX 12</span><span class="ov-chip">p.14</span><span class="ov-chip">SND 2.45</span></div></div>
</div></div>'''
    return t.replace('<div class="frame" style="width:992px;height:744px;background:#0A0908">', '<div class="frame" style="width:992px;height:744px;background:#0A0908;border-radius:14px;overflow:hidden">', 1) + overlay + "</div>"


# ---------- 10: phone, calling ----------
# At 366 px the free-floating stamps and notes would collide with the SND tags, so the phone page keeps tags, highlights and leaders only.
PHONE_PAGE = re.sub(r'<div class="(?:stamp|note) [^"]*"[^>]*>.*?</div>', "", script_page(w=366, h=620, left=56, scale_text=0.9))

def screen_phone_calling():
    f = ['<div class="frame ov-phone" style="width:390px;height:844px;background:#0A0908">', '<div class="ov-island"></div>']
    f.append('<div class="ov-pstatus"><span class="live"><i></i>Calling · Libretto v2</span><span>21:14 · offline, cached</span></div>')
    f.append('<div style="position:absolute;left:12px;top:82px">' + PHONE_PAGE + "</div>")
    f.append('''<div class="ov-pstrip">
  <div class="ov-prow"><div class="ov-pnav"><span class="ov-pbtn">‹</span><span class="mono" style="font-size:15px;color:var(--ink)">p.1</span><span class="faint mono" style="font-size:13px">/ 43</span><span class="ov-pbtn">›</span></div>
  <span class="ov-pbtn go">Go to…</span></div>
  <div class="ov-pnext"><span class="dept" style="color:var(--amber)"><span class="sw lx"></span>Next LX</span><span class="ov-code" style="color:var(--ink)">12</span><span class="lbl3">Ship deck wash in</span></div>
</div>''')
    f.append('<div class="ov-homebar"></div></div>')
    return "\n".join(f)


# ---------- 11: phone, shows ----------
def screen_phone_home():
    f = ['<div class="frame ov-phone" style="width:390px;height:844px;background:var(--paper)">', '<div class="ov-island"></div>']
    f.append('<div class="ov-ptop"><span class="ttl">Shows</span><span class="row" style="gap:12px"><span class="sync"><span class="dot"></span>Synced</span><span class="avatar av-amber" style="width:32px;height:32px;font-size:12px" title="Jayden">JN</span></span></div>')
    card = 'style="min-height:0;padding:14px;gap:8px"'
    f.append('<div class="ov-ph-body">')
    f.append('<div style="margin:2px 0 8px"><div class="ov-greet">Good evening, Jayden.</div><div class="muted" style="margin-top:4px;font-size:13px">Three shows in prep. One opens in 9 days.</div></div>')
    f.append('<div class="section-label">Active</div>')
    f.append(f'''<div class="show-card" {card}>
  <div class="row" style="justify-content:space-between"><span class="pill live"><span class="dot"></span>Running</span><span class="muted small">opened 3 Oct</span></div>
  <div class="name" style="font-size:18px">The Pirates of Penzance</div>
  <div class="meta"><span>Libretto v3</span><span>Piano-vocal v1</span><span class="mono">412 cues</span></div>
  <div class="foot">{presence(("av-amber", "JN", "Jayden"), ("av-blue", "MK", "Mikaela, LX"), ("av-purple", "AR", "Alex R"))}<span class="small muted">LX relabelled 3 cues · 12 min ago</span></div>
</div>''')
    f.append(f'''<div class="show-card" {card}>
  <div class="row" style="justify-content:space-between"><span class="pill warn"><span class="dot"></span>Rehearsal</span><span class="muted small">opens 24 Oct</span></div>
  <div class="name" style="font-size:18px">Songs for a New World</div>
  <div class="meta"><span>Libretto v2</span><span class="mono">96 cues</span><span class="pill blue" style="height:18px">4 to review</span></div>
  <div class="foot">{presence(("av-amber", "JN", "Jayden"), ("av-teal", "OL", "Oli, SND"))}<span class="small muted">revision uploaded · 1 h ago</span></div>
</div>''')
    f.append(f'''<div class="show-card" {card}>
  <div class="row" style="justify-content:space-between"><span class="pill rep"><span class="dot"></span>Prep</span><span class="muted small">opens 14 Nov</span></div>
  <div class="name" style="font-size:18px">Little Women</div>
  <div class="meta"><span>Libretto v1</span><span class="mono">0 cues</span></div>
  <div class="foot"><span class="empty" style="padding:6px 10px;box-shadow:none;border-width:1px"><span class="hand">script in, nothing placed yet</span></span></div>
</div>''')
    f.append('<div class="section-label" style="margin-top:6px">Archived</div>')
    f.append('<div class="show-card archived" style="min-height:0;padding:12px 14px;gap:4px"><div class="row" style="justify-content:space-between"><span class="name" style="font-size:16px">American Idiot</span><span class="muted small">closed Aug</span></div></div>')
    f.append('<div class="show-card archived" style="min-height:0;padding:12px 14px;gap:4px;margin-top:10px"><div class="row" style="justify-content:space-between"><span class="name" style="font-size:16px">The Hunger Games</span><span class="muted small">closed Jun</span></div></div>')
    f.append("</div>")
    f.append('<div class="ov-homebar"></div></div>')
    return "\n".join(f)


# ---------- 12: states ----------
def screen_states():
    def cap(t):
        return f'<div class="ov-cap">{t}</div>'

    f = ['<div class="frame" style="width:1280px;height:760px;background:var(--paper);padding:24px 28px">']
    f.append('<div class="row" style="justify-content:space-between;align-items:baseline;margin-bottom:14px"><span class="t-title" style="font-size:20px">States</span><span class="mono small faint">shown at real size, on the espresso ground</span></div>')
    # row 1: banner
    f.append(cap("offline banner") + f'<div class="ov-banner">{ic("wifi-off")}<span>Offline. Changes are saved on this device — <span class="mono">3</span> waiting to sync.</span></div>')
    f.append('<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:22px;margin-top:18px">')
    # column A: conflict, destructive confirm
    f.append('<div class="col" style="gap:18px;min-width:0"><div>' + cap("sync conflict card") + '''<div class="card" style="padding:16px">
  <div class="row" style="margin-bottom:8px"><span class="pill warn"><span class="dot"></span>Conflict</span></div>
  <div style="font-size:14px;line-height:1.5;color:var(--ink)">Oli moved <span class="mono">LX 12</span> to <span class="mono">p.2</span> while you were offline. Yours is on <span class="mono">p.1</span>.</div>
  <div class="row" style="margin-top:14px;gap:8px"><button class="ov-btn">Keep mine</button><button class="ov-btn">Keep Oli’s</button><a href="#" style="color:var(--blue);font-weight:600;font-size:13px;margin-left:6px">Show both</a></div>
</div></div>''')
    f.append('<div>' + cap("destructive confirm") + '''<div class="card" style="padding:20px;border-radius:20px">
  <div class="ov-h">Delete <span class="mono" style="font-weight:600;margin-left:3px">LX 12</span>?</div>
  <div style="font-size:13.5px;line-height:1.5;color:var(--ink-2);margin-top:8px">It goes from the page, the cue list and the cue sheet. Activity keeps a record so it can be reverted.</div>
  <div class="row" style="justify-content:flex-end;margin-top:18px;gap:8px"><button class="ov-btn">Keep</button><button class="ov-btn primary">Delete</button></div>
</div></div></div>''')
    # column B: empty list, skeleton
    f.append('<div class="col" style="gap:18px;min-width:0"><div>' + cap("empty cue list · SND") + '''<div class="empty" style="flex-direction:column;align-items:flex-start;gap:8px;padding:18px">
  <span class="dept" style="color:var(--blue)"><span class="sw snd"></span>SND <span class="mono muted" style="font-weight:400">0</span></span>
  <div style="font-size:15px;font-weight:600">No sound cues yet.</div>
  <div class="ov-hand">the quiet before the pad comes in</div>
  <button class="ov-btn" style="margin-top:4px">Place the first cue</button>
</div></div>''')
    sk = lambda w: f'<div class="ov-skrow"><span class="ov-sk"></span><span class="ov-sk" style="width:{w}%"></span><span class="ov-sk"></span></div>'
    f.append('<div>' + cap("loading skeleton") + '<div class="card" style="padding:0;overflow:hidden">' + sk(72) + sk(54) + sk(84) + "</div></div></div>")
    # column C: flags, sync
    f.append('<div class="col" style="gap:18px;min-width:0"><div>' + cap("flag pills") + '''<div class="card" style="padding:16px">
  <div class="row" style="flex-wrap:wrap;gap:8px"><span class="pill warn">duplicate</span><span class="pill rep">approximate</span><span class="pill" style="background:var(--red-soft);color:#F26F73">unresolved</span><span class="pill ok">ok</span></div>
  <div class="small muted" style="margin-top:12px">status is always colour plus a word</div>
</div></div>''')
    f.append('<div>' + cap("sync states, top bar") + '''<div class="ov-bar" style="gap:18px;padding:0 14px">
  <span class="sync"><span class="dot"></span>Synced</span>
  <span class="sync"><span class="dot amber"></span>Syncing… <span class="mono">3</span></span>
  <span class="sync"><span class="dot muted"></span>Offline</span>
  <span class="sync"><span class="dot red"></span>Conflict <span class="mono">1</span></span>
</div></div></div>''')
    f.append("</div>")
    # toast, anchored where it appears in the app: bottom-right of the window
    f.append('<div style="position:absolute;right:28px;bottom:28px;width:400px">' + cap("toast, bottom-right") + '''<div class="ov-toast"><span class="avatar av-amber" style="width:24px;height:24px;font-size:10px">JN</span><span style="flex:1"><span class="mono">42</span> LX cues placed <span style="color:var(--purple)">via Claude Code</span></span><a href="#">Review</a><span class="x" aria-label="Close">×</span></div></div>''')
    f.append("</div>")
    return "\n".join(f)


SCREENS = [
    ("palette", "08 · 1280 × 800 · ⌘K", "Command palette",
     "One ⌘K for a cue number, a page, a line of script or an action. Typing “lx 12” puts the cue first, because that is nearly always what you meant; the page stays visible behind, dimmed.",
     ["<b>Four groups, fixed order.</b> Go to, Cues, In the script, Actions. The eye learns where each lives, so results never reshuffle into a flat ranked list.",
      "<b>Cue numbers in mono</b> and the department’s chrome colour (LX amber, SND blue), so a column of them lines up like it does in the cue list.",
      "<b>The current result</b> has the red edge and the ↵ hint, the same selected-row mark the cue table uses. Red appears nowhere else here.",
      "<b>Actions carry their shortcuts</b> (⇧C, ⌘P), so the palette teaches the keyboard instead of replacing it."],
     screen_palette, 1280, 800),
    ("goto", "09 · iPad 11″ landscape · Go to…", "Go to…, Calling mode",
     "The only overlay in Calling mode: a cue number or a page, on a keypad you can hit with one thumb in the dark. The match line resolves as you type, so you see where Go will land before you tap it.",
     ["<b>Keys are 64 px high</b>, digits in mono at 28 px on a lifted fill with a hard shadow, so each one reads as pressable in low light.",
      "<b>Live match.</b> “2.2” already finds SND 2.20; the line under the readout says the cue, label and page. No guessing, no second screen.",
      "<b>Cue or Page</b> is the segmented control at the top, Cue by default. Recent chips (LX 12, p.14, SND 2.45) cover the jumps you make most.",
      "<b>Go is the one red</b>, wide and at the bottom of the thumb’s reach. Cancel is a ghost beside it, and the dimmed page behind keeps your place."],
     screen_goto, 992, 744),
    ("phone-calling", "10 · 390 × 844 · Calling mode, phone", "Calling mode, phone",
     "The phone is for following along, not for calling: an ASM in the wings or a designer at the back of the house can see the page and the next cue. The iPad stays the device you call from.",
     ["<b>Same strip, compressed.</b> Page turn, page count, Go to… and the next cue for the active department, in two rows with 40 px targets.",
      "<b>The page fills the width</b> at 366 px with the tags still in the margins; text is scaled to 90 % so nothing runs under a tag.",
      "<b>Nothing editable</b>, as on the iPad. The status line is 11 px mono: calling, which version, the time, and “offline, cached” as a calm state.",
      "<b>One red thing</b>: the live dot. Everything else is espresso and ink."],
     screen_phone_calling, 390, 844),
    ("phone-home", "11 · 390 × 844 · Shows, phone", "Shows, phone",
     "The home cards stacked one to a row, with the same greeting and the same status pills. The shows list sits above the tab level, so it has no tab bar: inside a show, five tabs replace the rail.",
     ["<b>No tab bar here.</b> The tabs belong to a show (Script, Cues, Docs, Activity, More). Opening a card enters that level; the avatar and sync state live in the top bar.",
      "<b>Cards keep their content</b>: state pill, opening date, versions, cue count, who is in. Only the grid becomes a single column.",
      "<b>Scrolls under the bar.</b> Archived shows sit below the fold; the list is the only thing that moves.",
      "<b>Kalam</b> stays on the empty Little Women card and nowhere else."],
     screen_phone_home, 390, 844),
    ("states", "12 · 1280 × 760 · component states", "States",
     "The moments between the happy screens, at real size: offline, a sync conflict, a toast, an empty list, a delete, loading, flags and the four sync states. Plain voice everywhere except the one empty list.",
     ["<b>Offline is a muted banner</b>, not an alert. The device is fine; the banner says how many changes are waiting.",
      "<b>The conflict card</b> names who moved what and where yours is, then gives two equal buttons and a link. No Kalam, no red: it is a decision, not an error.",
      "<b>Delete is the one red</b> on the sheet, and the copy says what goes and what stays recoverable. Keep sits beside it as the default.",
      "<b>The empty list</b> is the only place Kalam appears, in ink so it does not read as an alert. Skeleton rows keep the table’s column widths.",
      "<b>Status is a dot or pill plus a word</b>, every time: Synced, Syncing… 3, Offline, Conflict 1."],
     screen_states, 1280, 760),
]
