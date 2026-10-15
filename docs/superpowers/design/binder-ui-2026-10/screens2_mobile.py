#!/usr/bin/env python3
"""Binder UI mockup, theme: mobile. Phone (390 x 844) and iPad portrait (834 x 1194) layouts.
Eight phone screens plus one tablet screen. CSS prefix: mb-. Preview with: python3 _preview.py screens2_mobile"""
from _parts import *  # noqa: F401,F403
from _build import screen_markup
import re

CSS = """
/* ── mobile (mb-) ── */
.mb-ic{display:inline-grid;place-items:center;flex:none;width:20px;height:20px}
.mb-ic svg{width:100%;height:100%;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}

/* phone frame: same device as phone-calling and phone-home */
.mb-phone{border-radius:44px;overflow:hidden;background:var(--paper)}
.mb-bezel{position:absolute;left:0;top:0;right:0;bottom:0;border-radius:44px;box-shadow:inset 0 0 0 3px #1E1915;pointer-events:none;z-index:70}
.mb-island{position:absolute;left:145px;top:12px;width:100px;height:28px;border-radius:14px;background:#000;border:1px solid #1E1915;z-index:71}
.mb-homebar{position:absolute;left:135px;bottom:8px;width:120px;height:4px;border-radius:2px;background:var(--ink-2);opacity:.5;z-index:71}
.mb-stat{position:absolute;left:34px;right:34px;top:14px;height:24px;display:flex;align-items:center;justify-content:space-between;font-family:var(--mono);font-size:12px;color:var(--ink-2);z-index:5}
.mb-stat .sync{font-family:var(--sans);font-size:11px}

/* top bar, 56 px, buttons 44 px */
.mb-top{position:absolute;left:0;right:0;top:52px;height:56px;display:flex;align-items:center;gap:6px;padding:0 10px 0 4px;background:var(--paper);border-bottom:1px solid var(--line);z-index:5}
.mb-top.mb-pad{padding-left:16px}
.mb-back{display:inline-flex;align-items:center;gap:0;height:44px;padding:0 6px 0 2px;color:var(--ink-2);font-size:15px;font-weight:600;flex:none}
.mb-back .mb-ic{width:24px;height:24px}
.mb-ttl{font-family:var(--disp);font-weight:800;font-size:19px;letter-spacing:-.02em;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.mb-ib{width:44px;height:44px;display:grid;place-items:center;border-radius:12px;color:var(--ink-2);flex:none}
.mb-ib .mb-ic{width:22px;height:22px}
.mb-pg{font-family:var(--mono);font-size:13px;color:var(--ink-2);font-variant-numeric:tabular-nums;white-space:nowrap}
.mb-pg b{color:var(--ink);font-weight:500}
.frame .btn.mb-t{height:44px;padding:0 16px;font-size:14px;border-radius:12px;justify-content:center}
.frame .btn.mb-t .mb-ic{width:16px;height:16px}
.frame .btn.mb-block{width:100%}
.mb-av{width:32px;height:32px;font-size:12px}
.mb-av36{width:36px;height:36px;font-size:13px}

/* body and tab bar */
.mb-body{position:absolute;left:0;right:0;top:108px;bottom:90px;overflow:hidden;z-index:1}
.mb-scroll{padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.mb-fade{position:absolute;left:0;right:0;bottom:90px;height:32px;background:linear-gradient(rgba(20,18,16,0),var(--paper));z-index:4;pointer-events:none}
.mb-tabs{position:absolute;left:0;right:0;bottom:0;height:90px;background:var(--paper-2);border-top:1px solid var(--line);display:grid;grid-template-columns:repeat(5,1fr);z-index:6}
.mb-tab{height:56px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:var(--faint);font-size:11px;font-weight:600;line-height:1.2}
.mb-tab .mb-ic{width:22px;height:22px}
.mb-tab.on{color:var(--red)}

/* shared bits */
.mb-grow{flex:1;min-width:0}
.mb-row{display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 8px 8px 14px;border-top:1px solid var(--line)}
.mb-row:first-child{border-top:0}
.mb-row .t{font-size:15px;font-weight:600;color:var(--ink);line-height:1.3}
.mb-row .s{font-size:12.5px;color:var(--muted);line-height:1.4}
.mb-chev{width:20px;height:20px;color:var(--faint);flex:none}
.mb-sec{display:flex;flex-direction:column;gap:10px}
.mb-sec>.section-label{margin-bottom:0}
.mb-chip{font-size:11px;font-weight:600;padding:2px 9px;border-radius:999px;border:1px solid var(--line-2);color:var(--muted);height:20px;display:inline-flex;align-items:center}
.mb-fchip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 13px;border-radius:999px;border:2px solid var(--line-2);font-size:12.5px;font-weight:600;color:var(--ink-2);background:var(--paper);white-space:nowrap}
.mb-fchip.on{background:var(--elev);color:var(--ink)}
.mb-fchip .mono{color:var(--muted);font-weight:500}
.mb-fchip .sw{width:9px;height:9px}
.mb-fchips{display:flex;gap:8px;align-items:center;min-height:44px}
.mb-unres{background:var(--red-soft);color:#F26F73}
.mb-seg{display:flex;border:2px solid var(--line-2);border-radius:12px;overflow:hidden;background:var(--paper)}
.mb-seg button{flex:1;height:44px;padding:0 6px;font-size:14px;font-weight:600;color:var(--muted);display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap}
.mb-seg button.on{background:var(--elev);color:var(--ink)}
.mb-seg button .mono{font-size:12px;color:var(--faint);font-weight:500}
.mb-seg.mb-m button{font-family:var(--mono);font-weight:500}
.mb-sel{display:flex;align-items:center;justify-content:space-between;gap:6px;height:36px;padding:0 10px 0 12px;border:2px solid var(--line-2);border-radius:10px;background:var(--paper);font-size:13px;font-weight:600;color:var(--ink-2)}
.mb-sel .mb-ic{width:14px;height:14px;color:var(--muted)}
.field .in.mb-in{height:48px;font-size:16px;border-radius:12px;padding:0 14px}
.mb-code{display:inline-flex;align-items:center;justify-content:center;height:24px;min-width:46px;padding:0 10px;border-radius:7px;font-family:var(--mono);font-size:12.5px;font-weight:600}
.mb-code.lx{background:var(--warn-soft);color:var(--amber)}
.mb-code.snd{background:var(--blue-soft);color:var(--blue)}
.mb-code.tm{background:var(--purple-soft);color:var(--purple)}

/* login */
.mb-login{position:absolute;left:16px;right:16px;top:132px;display:flex;flex-direction:column;gap:18px}
.mb-lcard{padding:28px 24px 24px;display:flex;flex-direction:column;gap:22px;border-radius:var(--r-lg)}
.mb-lockup{display:flex;align-items:center;gap:12px}
.mark.mb-mark{width:44px;height:44px;border-radius:12px;font-size:25px;box-shadow:0 3px 0 var(--red-700)}
.mb-word{font-family:var(--disp);font-weight:800;font-size:30px;letter-spacing:-.03em;line-height:1}
.mb-quiet{color:var(--muted);font-size:16px;line-height:1.2;margin-top:-2px}
.mb-link{display:inline-flex;align-items:center;justify-content:center;height:44px;padding:0 12px;color:var(--ink-2);text-decoration:underline!important;text-decoration-color:var(--line-2)!important;text-underline-offset:3px;font-size:14px;font-weight:600}
.mb-center{text-align:center}

/* show overview */
.mb-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.mb-dept{padding:10px 14px;min-height:62px;display:flex;flex-direction:column;justify-content:space-between}
.mb-add{display:grid;place-items:center;min-height:62px;font-size:14px;font-weight:600}
.mb-who{display:flex;align-items:center;gap:10px;min-height:56px;padding:8px 12px}
.mb-note{display:flex;align-items:center;gap:12px;padding:12px 14px;border:2px solid var(--line);border-radius:var(--r);background:var(--paper-2);font-size:12.5px;color:var(--muted);line-height:1.4}
.mb-note .mb-ic{color:var(--faint);width:20px;height:20px}

/* script page */
.mb-stage{position:absolute;left:0;right:0;top:108px;bottom:0;background:#0E0C0A;overflow:hidden}
.mb-sheet{position:absolute;left:0;right:0;bottom:0;background:var(--card);border-top:2px solid var(--line-2);border-radius:20px 20px 0 0;box-shadow:0 -6px 0 rgba(0,0,0,.5);padding:8px 16px 34px;display:flex;flex-direction:column;gap:12px;z-index:30}
.mb-grab{width:40px;height:5px;border-radius:3px;background:var(--line-2);align-self:center;margin-bottom:2px}
.mb-sh-head{display:flex;align-items:center;justify-content:space-between;height:32px}
.mb-sheet .field{gap:5px}
.mb-sheet .field .in.mb-in{height:44px;font-size:15px}
.mb-sheet .quote{font-size:12px;padding:8px 12px}
.mb-acts{display:flex;gap:10px;margin-top:2px}

/* cue list */
.mb-sub{padding:10px 16px 6px;display:flex;flex-direction:column;gap:6px;border-bottom:1px solid var(--line);background:var(--paper);position:relative;z-index:3}
.mb-cue{display:grid;grid-template-columns:64px 1fr auto;column-gap:8px;align-items:center;padding:6px 12px 6px 14px;min-height:58px}
.mb-cue.mb-sel{border-color:var(--red);background:color-mix(in srgb,var(--red) 9%,var(--card))}
.mb-cn{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:22px;font-weight:600;line-height:1.1;color:var(--ink)}
.mb-cy{font-family:var(--mono);font-size:11px;color:var(--faint);line-height:1.2;margin-top:1px}
.mb-cl{font-size:15px;font-weight:600;line-height:1.3;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mb-trig{font-family:var(--mono);font-size:11.5px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.4}
.mb-trig .p{color:var(--faint)}

/* activity */
.mb-act{display:grid;grid-template-columns:36px 1fr auto;gap:12px;align-items:start;padding:12px 14px}
.mb-act .lbl{font-size:14px;line-height:1.35;color:var(--ink)}
.mb-act .lbl b{font-weight:600}
.mb-act .agent{color:var(--purple)}
.mb-act .tm{font-family:var(--mono);font-size:11.5px;color:var(--faint);white-space:nowrap;padding-top:2px}
.mb-swipe{overflow:hidden;margin:0 -16px;padding-bottom:3px}
.mb-swipe-in{display:flex;width:calc(100% + 72px);padding-left:16px;transform:translateX(-72px)}
.mb-swipe-in .card{flex:0 0 358px}
.mb-swipe-act{flex:1;display:flex;align-items:stretch;padding-bottom:3px;margin-left:-2px}
.frame .btn.mb-dark{flex:1;height:auto;border-radius:0 var(--r) var(--r) 0;border-left:0;background:#0E0C0A;border-color:var(--line-2);flex-direction:column;justify-content:center;gap:4px;padding-right:12px;font-size:13px;color:var(--ink)}
.frame .btn.mb-dark .mb-ic{width:20px;height:20px}

/* documents */
.mb-doc{padding:14px;display:flex;flex-direction:column;gap:12px}
.mb-name{font-weight:600;font-size:16px;color:var(--ink);line-height:1.3}
.mb-cache{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px 0 6px;border:1px solid var(--line-2);border-radius:999px;font-size:11px;font-weight:500;color:var(--muted)}
.mb-cache svg{width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.mb-bar{height:8px;border-radius:999px;background:var(--paper);border:1px solid var(--line-2);overflow:hidden}
.mb-bar i{display:block;height:100%;background:var(--ink-2);border-radius:999px}
.mb-steps{display:flex;flex-wrap:wrap;gap:8px 14px}
.mb-step{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--faint);white-space:nowrap}
.mb-step.done{color:var(--ink-2)}
.mb-step.cur{color:var(--ink);font-weight:600}
.mb-ring{width:16px;height:16px;border-radius:50%;border:2px solid var(--line-2);flex:none}
.mb-step.cur .mb-ring{border-top-color:var(--ink);border-right-color:var(--ink)}
.mb-tick{width:16px;height:16px;border-radius:50%;background:var(--elev);border:2px solid var(--line-2);display:grid;place-items:center;flex:none;color:var(--ink-2)}
.mb-tick svg{width:9px;height:9px;stroke:currentColor;fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}

/* more */
.mb-mi{width:36px;height:36px;border-radius:10px;background:var(--paper-2);border:2px solid var(--line-2);display:grid;place-items:center;color:var(--ink-2);flex:none}
.mb-mi .mb-ic{width:18px;height:18px}
.mb-tog{display:flex;align-items:center;gap:10px;flex:none}
.mb-tog .w{font-size:12px;font-weight:600;color:var(--ok)}
.mb-tog .tr{width:52px;height:32px;border-radius:999px;background:var(--ok);position:relative;border:2px solid var(--ok)}
.mb-tog .tr::after{content:"";position:absolute;right:2px;top:2px;width:24px;height:24px;border-radius:50%;background:#0E0C0A}
.mb-out{display:inline-flex;align-items:center;height:44px;color:var(--ink-2);font-size:14px;font-weight:600;text-decoration:underline!important;text-decoration-color:var(--line-2)!important;text-underline-offset:3px}

/* settings */
.mb-dcard{padding:10px 14px 12px;display:flex;flex-direction:column;gap:6px}
.mb-dcard .lab{font-size:11px;font-weight:600;color:var(--muted);margin-bottom:3px}
.mb-ctl{display:grid;grid-template-columns:44px 1.05fr 1fr;gap:8px;align-items:end}
.mb-swb{width:44px;height:44px;border-radius:12px;border:2px solid var(--line-2);background:var(--paper);display:grid;place-items:center}
.mb-swb i{width:16px;height:16px;border-radius:5px;display:block}
.mb-ctl .mb-seg button{height:40px;font-size:13px;padding:0 4px}
.mb-ctl .mb-seg{border-radius:11px}
.mb-ctl .mb-swb{height:44px}
.mb-ctl>div{min-width:0}
.mb-mem{display:flex;align-items:center;gap:12px;min-height:46px;padding:8px 6px 8px 14px;border-top:1px solid var(--line)}
.mb-mem:first-child{border-top:0}
.mb-mem .nm{font-weight:600;font-size:15px;flex:1;min-width:0}
.mb-arch{padding:12px 12px 12px 14px;display:flex;align-items:center;gap:12px}
.mb-arch h3{margin:0 0 3px;font-size:15px;font-weight:700;color:var(--ink)}
.mb-arch p{margin:0;font-size:12.5px;color:var(--muted);line-height:1.45}

/* iPad portrait */
.mb-tab-frame{border-radius:28px;overflow:hidden;background:var(--paper)}
.mb-tab-frame .mb-bezel{border-radius:28px}
.rail.mb-rail{width:52px}
.rail-item.mb-ri{grid-template-rows:1fr;padding-top:0}
.rail-item.mb-ri svg{width:20px;height:20px}
.tool.mb-tt{width:44px;height:44px}
.tool.mb-tt svg{width:19px;height:19px}
.tools.mb-tools{gap:4px;padding:6px}
.mb-tsheet{border-radius:20px 0 0 20px;border-left:2px solid var(--line-2);box-shadow:-8px 0 0 rgba(0,0,0,.55),-28px 0 48px rgba(0,0,0,.45);z-index:20}
.mb-tsheet .panel-tabs button{padding:13px 12px 11px;font-size:13px}
.mb-tsheet .panel-tabs{padding-top:10px}
.mb-tsheet .field .in{height:40px;font-size:14px}
.mb-tsheet .field .in.area{height:auto;min-height:60px}
.mb-tsheet .seg button{padding:9px 9px;font-size:12.5px}
.mb-tsheet .layer-row{height:38px}
.mb-tsheet .panel-body{padding:14px 16px;gap:14px}
"""

# ---------- icons local to this module ----------
MBI = {
    "back": '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    "chev": '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    "down": '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    "check": '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    "gear": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>',
    "people": '<svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9.5" r="2.4"/><path d="M17 14.2c2.4 0 4 1.8 4 4.3"/></svg>',
    "key": '<svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/></svg>',
}


def ic(name, size=None):
    src = ICON.get(name) or MBI[name]
    st = f' style="width:{size}px;height:{size}px"' if size else ""
    return f'<span class="mb-ic"{st}>{src}</span>'


# ---------- phone frame ----------
TABS = [("script", "Script"), ("cues", "Cues"), ("docs", "Docs"), ("activity", "Activity"), ("more", "More")]


def tabbar(active):
    out = ['<nav class="mb-tabs" aria-label="Binder">']
    for k, lab in TABS:
        on = k == active
        out.append(f'<a class="mb-tab{" on" if on else ""}" href="#"{" aria-current=\"page\"" if on else ""}>{ic(k, 22)}<span>{lab}</span></a>')
    out.append("</nav>")
    return "".join(out)


def phone(inner, tab=None, right=None, fade=False, bg="var(--paper)"):
    right = right or '<span class="sync"><span class="dot"></span>Synced</span>'
    f = [f'<div class="frame mb-phone" style="width:390px;height:844px;background:{bg}">', '<div class="mb-island"></div>',
         f'<div class="mb-stat"><span>21:14</span>{right}</div>', inner]
    if fade:
        f.append('<div class="mb-fade"></div>')
    if tab:
        f.append(tabbar(tab))
    f.append('<div class="mb-homebar"></div><div class="mb-bezel"></div></div>')
    return "\n".join(f)


def back(label=""):
    lab = f"<span>{label}</span>" if label else ""
    return f'<a class="mb-back" href="#" aria-label="Back">{ic("back", 24)}{lab}</a>'


def pill_flag(flag):
    return {
        "approximate": '<span class="pill rep">approx.</span>',
        "duplicate": '<span class="pill warn">duplicate</span>',
        "unresolved": '<span class="pill mb-unres">unresolved</span>',
    }.get(flag, "")


# ---------- 1. m-login ----------
def screen_login():
    inner = '''<div class="mb-login">
  <div class="card mb-lcard">
    <div class="col" style="gap:10px">
      <div class="mb-lockup"><span class="mark mb-mark" aria-hidden="true">B</span><span class="mb-word">Binder</span><span class="mb-chip">by RVLT</span></div>
      <div class="hand mb-quiet">the book is where you left it</div>
    </div>
    <div class="col" style="gap:14px">
      <div class="field"><label>Email</label><div class="in mb-in">jayden@twotoned.example</div></div>
      <div class="field"><label>Password</label><div class="in mb-in" style="letter-spacing:.12em;color:var(--ink-2)">••••••••••••</div></div>
    </div>
    <div class="col" style="gap:6px;align-items:stretch">
      <button class="btn primary mb-t mb-block" style="height:48px;font-size:16px">Sign in</button>
      <div class="mb-center"><a class="mb-link" href="#">Email me a link instead</a></div>
    </div>
  </div>
  <div class="muted small mb-center" style="padding:0 12px;line-height:1.5">Stays signed in on this device, so the book opens offline.</div>
</div>'''
    return phone(inner)


# ---------- 2. m-show ----------
def screen_show():
    top = f'''<header class="mb-top">{back("Shows")}
  <span class="mb-ttl mb-grow" style="font-size:16px">Songs for a New World</span>
  <span class="pill warn"><span class="dot"></span>Rehearsal</span><span class="avatar av-amber mb-av" title="Jayden">JN</span></header>'''
    needs = f'''<div class="mb-sec"><div class="section-label">Needs you</div>
  <div class="card" style="padding:0">
    <div class="mb-row" style="min-height:52px;padding-top:4px;padding-bottom:4px"><span class="mb-grow t" style="font-size:14px;font-weight:500"><span class="mono">4</span> cues to review after the revision</span><button class="btn mb-t">Review {ic("chev", 16)}</button></div>
    <div class="mb-row" style="min-height:52px;padding-top:4px;padding-bottom:4px"><span class="mb-grow t" style="font-size:14px;font-weight:500">LX has <span class="mono">2</span> duplicate numbers</span><button class="btn mb-t">Fix {ic("chev", 16)}</button></div>
  </div></div>'''
    scripts = f'''<div class="mb-sec"><div class="section-label">Scripts</div>
  <div class="card" style="padding:0">
    <div class="mb-row"><div class="mb-grow col" style="gap:3px"><div class="row" style="gap:8px"><span class="t">Libretto</span><span class="pill blue" style="height:18px">4 to review</span></div><div class="s">v2 current · <span class="mono">43</span> pages</div></div><span class="mb-chev">{ic("chev", 20)}</span></div>
    <div class="mb-row"><div class="mb-grow col" style="gap:3px"><span class="t">Piano-vocal score</span><div class="s">v1 · <span class="mono">188</span> pages</div></div><span class="mb-chev">{ic("chev", 20)}</span></div>
  </div></div>'''
    cl = f'''<div class="mb-sec"><div class="section-label">Cue lists</div>
  <div class="mb-grid2">
    <div class="card mb-dept"><div class="row" style="justify-content:space-between"><span class="dept"><span class="sw lx"></span>LX</span><span class="mono" style="font-size:18px;font-weight:600">61</span></div><div class="small muted">2 duplicates</div></div>
    <div class="card mb-dept"><div class="row" style="justify-content:space-between"><span class="dept"><span class="sw snd"></span>SND</span><span class="mono" style="font-size:18px;font-weight:600">28</span></div><div class="small muted">clean</div></div>
    <div class="card mb-dept"><div class="row" style="justify-content:space-between"><span class="dept"><span class="sw tm"></span>TM</span><span class="mono" style="font-size:18px;font-weight:600">7</span></div><div class="small muted">mic cues</div></div>
    <div class="ghost-card mb-add">+ add</div>
  </div></div>'''
    now = '''<div class="mb-sec"><div class="section-label">In the binder now</div>
  <div class="mb-grid2">
    <div class="card mb-who"><span class="avatar av-amber mb-av">JN</span><div class="col" style="gap:0;min-width:0"><span style="font-weight:600;font-size:14px">Jayden</span><span class="small muted" style="white-space:nowrap">Libretto · p.<span class="mono">14</span></span></div></div>
    <div class="card mb-who"><span class="avatar av-teal mb-av">OL</span><div class="col" style="gap:0;min-width:0"><span style="font-weight:600;font-size:14px">Oli</span><span class="small muted" style="white-space:nowrap">Libretto · p.<span class="mono">3</span></span></div></div>
  </div></div>'''
    off = f'<div class="mb-note">{ic("wifi-off", 20)}<span>Offline: cached on this device · <span class="mono" style="color:var(--ink-2)">311</span> files</span></div>'
    body = f'<div class="mb-body"><div class="mb-scroll">{needs}{scripts}{cl}{now}{off}</div></div>'
    return phone(top + body, tab="script", fade=True)


# ---------- 3. m-markup ----------
# At 366 px the free-floating stamps and notes overrun the SND tags, so the phone page keeps tags, highlights and leaders only.
PHONE_PAGE = re.sub(r'<div class="(?:stamp|note) [^"]*"[^>]*>.*?</div>', "",
                    script_page(w=366, h=560, left=56, scale_text=0.9, selected="lx12"))


def screen_markup_phone():
    top = f'''<header class="mb-top">{back()}
  <span class="mb-ttl mb-grow">Libretto v2</span><span class="mb-pg">p.<b>1</b> / 43</span>
  <button class="mb-ib" aria-label="More">{ic("more", 22)}</button></header>'''
    stage = f'<div class="mb-stage"><div style="position:absolute;left:12px;top:10px">{PHONE_PAGE}</div></div>'
    sheet = f'''<div class="mb-sheet" role="dialog" aria-label="Cue LX 12">
  <div class="mb-grab"></div>
  <div class="mb-sh-head"><span class="dept"><span class="sw lx"></span>LX <span class="mono" style="font-size:22px;font-weight:600;margin-left:4px">12</span></span><span class="pill ok"><span class="dot"></span>ok</span></div>
  <div class="field"><label>Label</label><div class="in mb-in">Ship deck wash in</div></div>
  <div class="field"><label>Type</label><div class="mb-seg"><button class="on">Go</button><button>Standby</button><button>Warn</button></div></div>
  <div class="field"><label>Trigger</label><div class="quote">“A new world calls across the ocean,” <span class="faint">p.<span class="mono">1</span></span></div></div>
  <div class="mb-acts"><button class="btn mb-t" style="width:112px">Delete</button><button class="btn primary mb-t" style="flex:1">Done</button></div>
</div>'''
    return phone(top + stage + sheet, bg="#0E0C0A")


# ---------- 4. m-cues ----------
def screen_cues():
    top = f'''<header class="mb-top mb-pad"><span class="mb-ttl mb-grow" style="font-size:22px">Cue lists</span>
  <button class="mb-ib" aria-label="Search">{ic("search", 22)}</button><button class="mb-ib" aria-label="More">{ic("more", 22)}</button></header>'''
    sub = '''<div class="mb-sub" style="position:absolute;left:0;right:0;top:108px">
  <div class="mb-seg"><button><span class="dept"><span class="sw lx"></span>LX</span><span class="mono">61</span></button><button class="on"><span class="dept"><span class="sw snd"></span>SND</span><span class="mono">28</span></button><button><span class="dept"><span class="sw tm"></span>TM</span><span class="mono">7</span></button></div>
  <div class="mb-fchips"><span class="mb-fchip"><span class="mono">1</span> duplicate</span><span class="mb-fchip"><span class="mono">1</span> approximate</span><span class="mb-fchip"><span class="mono">1</span> unresolved</span></div>
</div>'''
    rows = [
        ("2.10", "go", "Band in", "1", "MAN 2", None, False),
        ("2.20", "go", "Verse 2 swell", "1", "And the road will end", None, True),
        ("2.30", "go", "Woman 2 in", "1", "WOMAN 2", None, False),
        ("2.40", "go", "Fast pace lines", "2", "TO A NEW WORLD!", None, False),
        ("2.45", "standby", "LP in", "2", "MAN 1", "approximate", False),
        ("2.50", "go", "Harmonies", "3", "AND OH, YOU’RE SUDDENLY A STRANGER.", None, False),
        ("2.50", "go", "Harmonies (dup)", "3", "AND OH, YOU’RE SUDDENLY A STRANGER.", "duplicate", False),
        ("2.70", "go", "Harmonies fade", "3", "THEN YOU MIGHT BE FREE…", "unresolved", False),
    ]
    cards = []
    for num, typ, label, page, trig, flag, sel in rows:
        cards.append(f'''<div class="card mb-cue{" mb-sel" if sel else ""}"><div><div class="mb-cn">{num}</div><div class="mb-cy">{typ}</div></div>
  <div style="min-width:0"><div class="mb-cl">{label}</div><div class="mb-trig"><span class="p">p.{page}</span> · {trig}</div></div>{pill_flag(flag) or "<span></span>"}</div>''')
    body = f'<div class="mb-body" style="top:222px"><div class="mb-scroll" style="gap:6px;padding-top:8px">{"".join(cards)}</div></div>'
    return phone(top + sub + body, tab="cues", fade=True)


# ---------- 5. m-activity ----------
def screen_activity():
    top = '<header class="mb-top mb-pad"><span class="mb-ttl mb-grow" style="font-size:22px">Activity</span></header>'
    sub = '''<div class="mb-sub" style="position:absolute;left:0;right:0;top:108px;padding-bottom:4px">
  <div class="mb-fchips" style="gap:8px"><span class="mb-fchip on">All layers</span><span class="mb-fchip"><span class="sw lx"></span>LX</span><span class="mb-fchip"><span class="sw snd"></span>SND</span><span class="mb-fchip"><span class="sw tm"></span>TM</span></div>
  <div class="row" style="justify-content:space-between;min-height:40px"><span class="small muted">Today</span><span class="mb-sel" style="width:178px">People and agents''' + ic("down", 14) + '''</span></div>
</div>'''

    def card(av, ini, label, meta, tm, extra=""):
        return f'''<div class="card mb-act"><span class="avatar {av} mb-av36"{extra}>{ini}</span>
  <div><div class="lbl">{label}</div><div class="small faint" style="margin-top:2px">{meta}</div></div><span class="tm">{tm}</span></div>'''

    swiped = f'''<div class="mb-swipe"><div class="mb-swipe-in">{card("av-teal", "OL", "<b>Oli</b> placed <span class=mono>6</span> SND cues and relabelled <span class=mono>1</span>", "SND · p.1–3", "14:02")}
  <div class="mb-swipe-act"><button class="btn mb-dark">{ic("undo", 20)}Revert</button></div></div></div>'''
    rows = [
        swiped,
        card("av-amber", "JN", "<b>Jayden</b> <span class=agent>via Claude Code</span> placed <span class=mono>42</span> LX cues", "LX · p.1–40 · batch from the theatremix script skill", "13:40"),
        card("", "B", "<b>Binder</b> re-anchored <span class=mono>96</span> cues to Libretto v2", "92 ok · 3 approximate · 1 unresolved", "13:12", ' style="background:var(--elev);color:var(--muted)"'),
        card("av-amber", "JN", "<b>Jayden</b> uploaded Libretto v2", "43 pages · cuts in #4", "13:09"),
        card("av-blue", "MK", "<b>Mikaela</b> relabelled <span class=mono>3</span> LX cues and moved <span class=mono>1</span>", "LX · p.12", "22:51"),
    ]
    hint = f'<div class="mb-note">{ic("undo", 20)}<span>Swipe a row left to revert it. Personal layers never appear here.</span></div>'
    body = f'<div class="mb-body" style="top:228px"><div class="mb-scroll" style="gap:8px;padding-top:10px">{"".join(rows)}{hint}</div></div>'
    return phone(top + sub + body, tab="activity", fade=True)


# ---------- 6. m-docs ----------
def screen_docs():
    top = '''<header class="mb-top mb-pad"><span class="mb-ttl mb-grow" style="font-size:22px">Documents</span><button class="btn primary mb-t">Upload</button></header>'''
    cached = f'<span class="mb-cache">{MBI["check"]}cached</span>'
    lib = f'''<div class="card mb-doc"><div class="col" style="gap:5px">
  <div class="row" style="justify-content:space-between"><span class="mb-name">Libretto</span><span class="row" style="gap:6px"><span class="pill blue" style="height:18px">4 to review</span>{cached}</span></div>
  <div class="muted small">v2 current · <span class="mono">43</span> pages · searchable</div></div>
  <div class="row" style="gap:8px"><button class="btn mb-t" style="flex:1">Open</button><button class="btn mb-t" style="flex:1">Cue lists</button><button class="btn mb-t" style="width:44px;padding:0" aria-label="More">{ic("more", 20)}</button></div></div>'''
    pvs = f'''<div class="card mb-doc"><div class="col" style="gap:5px">
  <div class="row" style="justify-content:space-between"><span class="mb-name">Piano-vocal score</span>{cached}</div>
  <div class="muted small">v1 · <span class="mono">188</span> pages · scanned, OCR layer added</div></div>
  <div class="row" style="gap:8px"><button class="btn mb-t" style="flex:1">Open</button><button class="btn mb-t" style="flex:1">Cue lists</button><button class="btn mb-t" style="width:44px;padding:0" aria-label="More">{ic("more", 20)}</button></div></div>'''
    v3 = f'''<div class="card mb-doc"><div class="col" style="gap:5px">
  <div class="row" style="justify-content:space-between"><span class="mb-name">Libretto v3</span><span class="pill rep" style="height:18px">Processing</span></div>
  <div class="row" style="justify-content:space-between;font-size:12.5px"><span class="muted"><span class="mono">12</span> MB uploaded, now extracting text</span><span class="mono" style="color:var(--ink-2)">64 %</span></div>
  <div class="mb-bar" role="progressbar" aria-valuenow="64" aria-valuemin="0" aria-valuemax="100"><i style="width:64%"></i></div></div>
  <div class="mb-steps">
    <span class="mb-step done"><span class="mb-tick">{MBI["check"]}</span>Upload</span>
    <span class="mb-step cur"><span class="mb-ring"></span>Extract text</span>
    <span class="mb-step"><span class="mb-ring"></span>Build word layer</span>
    <span class="mb-step"><span class="mb-ring"></span>Re-anchor <span class="mono">96</span> cues</span>
  </div>
  <div class="muted small" style="line-height:1.45">You can keep working on v2. Cues move to v3 when it is ready, and anything uncertain goes to review.</div>
  <button class="btn ghost mb-t" style="align-self:flex-start;padding:0 10px">Cancel</button></div>'''
    body = f'<div class="mb-body"><div class="mb-scroll"><div class="small muted"><span class="mono">2</span> current · <span class="mono">1</span> processing</div>{lib}{pvs}{v3}</div></div>'
    return phone(top + body, tab="docs", fade=True)


# ---------- 7. m-more ----------
def screen_more():
    top = '<header class="mb-top mb-pad"><span class="mb-ttl mb-grow" style="font-size:22px">More</span></header>'

    def item(icon, label):
        return f'<div class="mb-row"><span class="mb-mi">{ic(icon, 18)}</span><span class="mb-grow t">{label}</span><span class="mb-chev">{ic("chev", 20)}</span></div>'

    lst = '<div class="card" style="padding:0">' + item("exports", "Exports") + item("gear", "Settings") + item("people", "Members") + item("key", "Personal access tokens") + item("shows", "Shows") + "</div>"
    off = '''<div class="card" style="padding:14px;display:flex;flex-direction:column;gap:12px">
  <div class="col" style="gap:3px"><div class="t-over">Offline</div><div class="muted" style="font-size:13px;line-height:1.5">Libretto v1, v2 and the score are cached on this device. <span class="mono" style="color:var(--ink-2)">311</span> files.</div></div>
  <div class="row" style="justify-content:space-between;min-height:44px;border-top:1px solid var(--line);padding-top:10px"><span style="font-weight:600;font-size:14px">Make available offline</span><span class="mb-tog"><span class="w">On</span><span class="tr"></span></span></div>
</div>'''
    acct = '''<div class="card" style="padding:12px 14px;display:flex;align-items:center;gap:12px"><span class="avatar av-amber mb-av36">JN</span>
  <div class="col mb-grow" style="gap:0"><span style="font-weight:600;font-size:15px">Jayden</span><span class="small muted mono" style="font-size:12px">jayden@twotoned.example</span></div>
  <a class="mb-out" href="#">Sign out</a></div>'''
    body = f'<div class="mb-body"><div class="mb-scroll">{lst}{off}{acct}</div></div>'
    return phone(top + body, tab="more")


# ---------- 8. m-settings ----------
def screen_settings():
    top = f'''<header class="mb-top">{back("More")}<span class="mb-ttl mb-grow" style="text-align:center;margin-right:56px">Show settings</span></header>'''

    def dept(code, cls, name, sw, fmt, side, count):
        f1 = "".join(f'<button class="{"on" if i == fmt else ""}">{t}</button>' for i, t in enumerate(["10.5", "10.50"]))
        s1 = "".join(f'<button class="{"on" if i == side else ""}">{t}</button>' for i, t in enumerate(["Left", "Right"]))
        return f'''<div class="card mb-dcard">
  <div class="row" style="justify-content:space-between"><span class="row" style="gap:10px"><span class="mb-code {cls}">{code}</span><span style="font-weight:600;font-size:15px">{name}</span></span><span class="mono small muted">{count} cues</span></div>
  <div class="mb-ctl"><div><div class="lab">Colour</div><button class="mb-swb" aria-label="Colour"><i style="background:var(--{sw})"></i></button></div>
    <div><div class="lab">Number format</div><div class="mb-seg mb-m">{f1}</div></div>
    <div><div class="lab">Marker side</div><div class="mb-seg">{s1}</div></div></div>
</div>'''

    def mem(av, ini, name, role, owner=False):
        sel = (f'<span class="mb-sel" style="width:96px"><span>{role}</span></span>' if owner else
               f'<span class="mb-sel" style="width:96px"><span>{role}</span>{ic("down", 14)}</span>')
        chev = '<span class="mb-chev" style="visibility:hidden">' + ic("chev", 20) + "</span>" if owner else f'<span class="mb-chev">{ic("chev", 20)}</span>'
        return f'<div class="mb-mem"><span class="avatar {av} mb-av">{ini}</span><span class="nm">{name}</span>{sel}{chev}</div>'

    inner = f'''<div class="mb-sec"><div class="section-label">Departments</div>
  {dept("LX", "lx", "Lighting", "amber", 0, 0, 61)}
  {dept("SND", "snd", "Sound", "blue", 1, 1, 28)}
  {dept("TM", "tm", "TheatreMix", "purple", 1, 0, 7)}
  <button class="btn mb-t mb-block">+ Add department</button></div>
<div class="mb-sec"><div class="section-label">Members</div>
  <div class="card" style="padding:0">{mem("av-amber", "JN", "Jayden", "Owner", True)}{mem("av-teal", "OL", "Oli", "Editor")}{mem("av-blue", "MK", "Mikaela", "Editor")}{mem("av-purple", "AR", "Alex R", "Viewer")}</div></div>
<div class="card mb-arch"><div class="mb-grow"><h3>Archive this show</h3><p>Read-only for everyone. Exports still work.</p></div><button class="btn mb-t" style="flex:none">Archive show</button></div>'''
    # shown scrolled to the bottom of the page, so members and archive are on screen
    body = f'<div class="mb-body"><div class="mb-scroll" style="margin-top:-172px">{inner}</div></div>'
    return phone(top + body, tab="more")


# ---------- 9. t-markup ----------
PANEL = re.search(r'<aside class="panel".*?</aside>', screen_markup(), re.S).group(0)
PANEL = PANEL.replace('style="right:0;width:300px;top:44px;bottom:26px"', 'style="right:0;width:360px;top:44px;bottom:26px"', 1)
PANEL = PANEL.replace('<aside class="panel"', '<aside class="panel mb-tsheet" aria-label="Cue panel"', 1)


def trail():
    items = [("script", "blue", "Script", True), ("cues", "amber", "Cues", False), ("docs", "teal", "Docs", False),
             ("activity", "purple", "Activity", False), ("exports", "green", "Exports", False)]
    h = ['<nav class="rail mb-rail" aria-label="Binder"><div class="mark" aria-hidden="true">B</div>']
    for k, hue, lab, on in items:
        h.append(f'<a class="rail-item mb-ri {hue}{" on" if on else ""}" href="#" aria-label="{lab}" title="{lab}"{" aria-current=\"page\"" if on else ""}>{ICON[k]}</a>')
    h.append(f'<div class="rail-foot"><a class="rail-item mb-ri" href="#" aria-label="Shows" title="Shows">{ICON["shows"]}</a><span class="avatar av-amber" title="Jayden">JN</span></div></nav>')
    return "".join(h)


def screen_tablet_markup():
    f = ['<div class="frame mb-tab-frame" style="width:834px;height:1194px">', trail()]
    f.append('<header class="topbar" style="left:52px"><div class="crumbs"><span>Songs for a New World</span><span class="sep">/</span><b>Libretto v2</b></div><div class="spacer"></div>'
             '<span class="sync"><span class="dot"></span>Synced</span>' + presence(("av-amber", "JN", "Jayden"), ("av-teal", "OL", "Oli, SND")) +
             '<button class="btn sm">Calling mode</button><button class="btn ghost sm">' + ICON["more"] + '</button></header>')
    # page area, 782 wide; a 600 px page leaves 91 px each side
    f.append('<div style="position:absolute;left:52px;right:0;top:44px;bottom:26px;background:#0E0C0A;overflow:hidden">'
             '<div style="position:absolute;left:91px;top:24px">' + script_page(w=600, h=820, left=100, selected="lx12", peer="lx13") + "</div></div>")
    tools = [("select", "Select", "v"), ("cue", "Cue", "c"), ("hilite", "Highlight", "h"), ("note", "Note", "n"), ("rect", "Box", "r"), ("arrow", "Arrow", "a"), ("stamp", "Stamp", "s")]
    f.append('<div class="tools mb-tools" style="left:64px;top:68px" role="toolbar" aria-label="Markup tools">'
             + "".join(f'<button class="tool mb-tt{" on" if k == "cue" else ""}" title="{t}">{ICON[k]}<span class="k">{key}</span></button>' for k, t, key in tools)
             + '<div class="tool-sep"></div><button class="tool mb-tt" title="Search">' + ICON["search"] + '<span class="k">/</span></button></div>')
    f.append(PANEL)
    f.append('<div class="statusbar" style="left:52px"><span>Page <span class="mono">1</span> of <span class="mono">43</span></span><span class="sep-v"></span><span>Snap to text <span class="mono" style="color:var(--ok)">on</span></span><span class="sep-v"></span><span>Active layer <span class="dept" style="color:var(--amber)"><span class="sw lx"></span>LX</span></span><span class="spacer"></span><span><span class="kbd">c</span> place <span class="kbd">]</span> next cue <span class="kbd">g</span> go to page <span class="kbd">⌘K</span> anything</span></div>')
    f.append('<div class="mb-bezel"></div></div>')
    return "\n".join(f)


SCREENS = [
    ("m-login", "13 · 390 × 844 · phone", "Sign in, phone",
     "The desktop sign-in card at full width with 16 px gutters: fields are 48 px tall, Sign in is the one red thing, and the note about staying signed in sits under the card where a thumb will not hit it by mistake.",
     ["<b>What changed from desktop.</b> The 400 px card on a stage becomes a card that fills the width minus 16 px gutters, so the fields and the button are as wide as the thumb needs.",
      "<b>Fields at 48 px, 16 px text.</b> Under 16 px, iOS zooms the page when a field takes focus; this is the size that stops it.",
      "<b>Email me a link instead</b> is a 44 px text link, not a second button, so Sign in stays the only red and the only filled shape.",
      "<b>Kalam</b> keeps its one line from the desktop card. It is a greeting, not an alert."],
     screen_login, 390, 844),
    ("m-show", "14 · 390 × 844 · phone", "Show overview, phone",
     "The show page as one column, in the order you need it: what needs you, the scripts, the cue lists, who is in, and a quiet note that the book is cached. It is reached from the Script tab’s header, so Script stays marked.",
     ["<b>What changed from desktop.</b> The two columns collapse into one, and “Needs you” moves to the top where the right-hand aside used to be, because it is the only part that asks for something.",
      "<b>Tables become cards.</b> Each script is one row with its state under the name; thumbnails are gone to save the width for the text.",
      "<b>Department cards are a 2 × 2 grid</b> with the dashed “+ add” as the fourth tile, so adding a department stays one tap away without an extra control.",
      "<b>Back goes to Shows.</b> The Shows home has no tab bar, so this ‹ is the only way back from inside a show; the five tabs belong to the show."],
     screen_show, 390, 844),
    ("m-markup", "15 · 390 × 844 · phone", "Script, phone",
     "The page fills the width and the cue panel becomes a bottom sheet over the lower part of the screen, with LX 12 selected on the page above it. When nothing is selected the sheet is gone and a “Place cue” button floats at the bottom right.",
     ["<b>What changed from desktop.</b> The 300 px right panel is now a bottom sheet with a grab handle, a 20 px top radius and a 2 px outline; it covers the tab bar while open, so one thing is in front at a time.",
      "<b>No FAB while the sheet is open.</b> The floating “Place cue” button appears only when nothing is selected; a second floating control above a sheet would fight for the thumb.",
      "<b>The page is the brightest thing.</b> There is no scrim, so the selected tag and its highlight stay readable above the sheet. The stamps and notes are left off at this width, where they overrun the SND tags.",
      "<b>Delete is plain, Done is red.</b> Delete sits at the left, away from Done, so a slip is less likely; the sheet repeats the desktop’s fields, minus Notes and Layers, which live under ⋯."],
     screen_markup_phone, 390, 844),
    ("m-cues", "16 · 390 × 844 · phone", "Cue list, phone",
     "One row of the desktop table becomes one card: the cue number big and in mono on the left, the label and its trigger text beside it, and a flag where there is one. SND is open, and the 2.20 card is the selected one.",
     ["<b>What changed from desktop.</b> The seven-column table becomes a stack of cards, and the 340 px detail panel becomes the bottom sheet from the Script screen, opened by tapping a card. Notes and page wait in that sheet.",
      "<b>Department switch is a full-width segmented control</b> at 44 px, with the counts in mono. It stays pinned with the filters while the cards scroll.",
      "<b>Flags keep colour plus a word:</b> approx., duplicate, unresolved. The filter chips above are muted, since they only count.",
      "<b>Selected is the red outline,</b> the same mark the desktop row has, with a faint red wash so it reads on a small screen."],
     screen_cues, 390, 844),
    ("m-activity", "17 · 390 × 844 · phone", "Activity, phone",
     "The activity feed as cards, with the same people and the same sentences. Oli’s row is swiped left to show Revert, which is how a row’s action appears when there is no room for a button on every card.",
     ["<b>What changed from desktop.</b> The Revert button that sat on each desktop row is gone from the resting state; swipe a row left to reveal it. Every row would otherwise carry a 44 px button the page does not have the width for.",
      "<b>Revert is a plain dark button, not red.</b> It is undoable from the history it creates, so it is not a destructive confirmation.",
      "<b>Filters are a chip row.</b> Layers on one line, and “People and agents” as a select-looking chip underneath, because the three-way segmented control does not fit beside four layer chips.",
      "<b>Times are mono and right-aligned,</b> so a column of them still lines up down the screen."],
     screen_activity, 390, 844),
    ("m-docs", "18 · 390 × 844 · phone", "Documents, phone",
     "Each document is a card with its state and two actions, and the third card shows Libretto v3 mid-processing, with a step line you can read at a glance. Upload is the one red button.",
     ["<b>What changed from desktop.</b> The rows lose their 44 × 58 thumbnails and their four small buttons; each card keeps Open and Cue lists and puts the rest behind ⋯, so every target is 44 px.",
      "<b>The step line wraps</b> instead of scrolling: Upload ✓, Extract text, Build word layer, Re-anchor 96 cues. The current step has the ring; the bar and “64 %” are the same figures as the desktop row.",
      "<b>“cached” is a quiet chip</b> beside the state, since offline is the thing a phone user in the wings wants to know about each document.",
      "<b>Compare v1 → v2</b> is not on the card; it is behind ⋯, because a side-by-side compare is a poor fit for a phone and the review list is."],
     screen_docs, 390, 844),
    ("m-more", "19 · 390 × 844 · phone", "More, phone",
     "The tab that holds everything the rail’s footer and the show’s small links hold on desktop: exports, settings, members, tokens, Shows, the offline switch and your account. Nothing here is urgent, so nothing is red.",
     ["<b>What changed from desktop.</b> Exports left the five-item rail because the phone has five tabs and Exports is not a thing you do in the wings; it is the first line here.",
      "<b>A list with chevrons,</b> 56 px rows with a square icon at the left. It is the same shape as iOS Settings, so it needs no learning.",
      "<b>Offline is a toggle with a word.</b> “On” in green beside the switch, so the state is never the colour alone.",
      "<b>Sign out is a text link</b> in the account row, 44 px high and not a button, so it is hard to hit by accident."],
     screen_more, 390, 844),
    ("m-settings", "20 · 390 × 844 · phone", "Show settings, phone",
     "Departments become cards with their controls on one line, followed by members as rows and the archive card at the bottom. The screen is shown scrolled to the end so you can see all three kinds of block.",
     ["<b>What changed from desktop.</b> The eight-column department grid becomes one card per department with labelled controls, and the member table becomes rows with the role as a select-looking pill. Drag handles are gone; reordering goes behind a long-press.",
      "<b>No red on the page.</b> Archive show is a plain button, because it is reversible and sits at the bottom. The only red on screen is the active More tab.",
      "<b>Controls stay in two segmented groups</b> (10.5 / 10.50, Left / Right) at 40 px with their labels above, since a bare “Left / Right” means nothing without one.",
      "<b>The owner’s role is not a select,</b> and has no chevron, because it cannot change here."],
     screen_settings, 390, 844),
    ("t-markup", "21 · 834 × 1194 · iPad portrait", "Script, iPad portrait",
     "The rail keeps its icons and loses its labels, the thumbnails are hidden, the page sits in the middle, and the cue panel slides over from the right as a sheet. The page does not move when the sheet comes in.",
     ["<b>What changed from desktop.</b> The rail is 52 px with icons only, the thumbnail strip is off by default, and the 300 px side panel becomes a 360 px sheet over the page, because portrait leaves no room to put it beside one.",
      "<b>No scrim.</b> The page stays bright; the sheet has a hard shadow and a 2 px outline instead. The tags on the left half of the page, including the selected LX 12, remain visible beside it.",
      "<b>The page is centred with equal 91 px margins,</b> and the tool strip sits in the left margin with 44 px buttons rather than the desktop’s 34 px.",
      "<b>Panel content is unchanged,</b> with larger touch targets for its tabs, fields and layer rows."],
     screen_tablet_markup, 834, 1194),
]
