#!/usr/bin/env python3
"""Access and setup: sign in, new show wizard, show settings, personal access tokens. Prefix: ac-"""
from _parts import *  # noqa: F401,F403
from _build import screen_home

CSS = """
/* ── access and setup (ac-) ── */
.ac-ic{display:inline-grid;place-items:center;flex:none}
.ac-ic svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.ac-ic.ac-fill svg{fill:currentColor;stroke:none}

/* `.frame button{border:0;background:none;padding:0;font:inherit}` out-ranks the bare .btn rules, so inside an ac- frame
   buttons get their padding, weight, border and fill back. Scoped to .ac-frame; nothing global changes. */
.ac-frame .btn{padding:0 12px;font-size:13px;font-weight:600}
.ac-frame .btn.sm{padding:0 9px;font-size:12px}
.ac-frame .btn:not(.primary):not(.ghost){border:2px solid var(--line-2);background:var(--card)}
.ac-frame .btn:not(.primary):not(.ghost).ac-solid{background:#0E0C0A;border-color:var(--ink-2)}
.ac-frame .btn.ac-block{width:100%;justify-content:center;height:40px;font-size:14px}
.ac-frame .ac-rm{color:var(--muted);font-size:12px;font-weight:600;justify-self:end}
.ac-frame .ac-swbtn{width:24px;height:24px;border-radius:7px;border:2px solid var(--line-2);background:var(--paper);display:grid;place-items:center}
.ac-frame .ac-close{color:var(--muted)}

/* sign in */
.ac-stage{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px}
.ac-login{width:400px;padding:32px 32px 28px;display:flex;flex-direction:column;gap:18px;border-radius:var(--r-lg)}
.ac-lockup{display:flex;align-items:center;gap:12px}
.mark.ac-mark-lg{width:44px;height:44px;border-radius:12px;font-size:25px;box-shadow:0 3px 0 var(--red-700)}
.ac-wordmark{font-family:var(--disp);font-weight:800;font-size:30px;letter-spacing:-.03em;line-height:1}
.ac-chip{font-size:11px;font-weight:600;padding:2px 9px;border-radius:999px;border:1px solid var(--line-2);color:var(--muted);height:20px;display:inline-flex;align-items:center}
.ac-quiet{color:var(--muted);font-size:16px;line-height:1.2;margin-top:-6px}
.field .in.ac-lg{height:38px;font-size:14px}
.ac-link{color:var(--ink-2);text-decoration:underline!important;text-decoration-color:var(--line-2)!important;text-underline-offset:3px;font-size:13px;font-weight:600}
.ac-center{text-align:center}
.ac-dots{letter-spacing:.12em;color:var(--ink-2)}

/* segmented, compact */
.ac-dgrid .seg{justify-self:start}
.seg.ac-sm button{padding:3px 9px;font-size:11.5px}
.seg.ac-mono button{font-family:var(--mono);font-weight:400;font-size:11.5px}
.seg.ac-mono button.on{font-weight:500}

/* colour swatch button and code pill */
.ac-swbtn i{width:12px;height:12px;border-radius:4px;display:block}
.ac-sw-lx{background:var(--amber)} .ac-sw-snd{background:var(--blue)} .ac-sw-tm{background:var(--purple)}
.ac-sw-sm{background:var(--teal)} .ac-sw-vid{background:var(--pink)} .ac-sw-stg{background:var(--coral)} .ac-sw-fly{background:var(--lime)} .ac-sw-pyro{background:var(--green)}
.ac-code{display:inline-flex;align-items:center;justify-content:center;height:22px;min-width:44px;padding:0 9px;border-radius:7px;font-family:var(--mono);font-size:12px;font-weight:600}
.ac-code.lx{background:var(--warn-soft);color:var(--amber)}
.ac-code.snd{background:var(--blue-soft);color:var(--blue)}
.ac-code.tm{background:var(--purple-soft);color:var(--purple)}
.ac-grip{color:var(--faint);width:16px;height:20px}
.ac-grip svg{width:12px;height:16px}

/* department rows (shared by the wizard and settings) */
.ac-dgrid{display:grid;align-items:center;column-gap:12px}
.ac-dhead{padding:0 12px 6px;font-size:11px;font-weight:600;color:var(--muted)}
.ac-drow{padding:0 12px;border-top:1px solid var(--line);font-size:13px}
.ac-dname{color:var(--ink);font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ac-cnt{font-family:var(--mono);font-size:12.5px;color:var(--ink-2);text-align:right}
.ac-cnt span{font-family:var(--sans);font-size:11px;color:var(--faint);margin-left:4px}

/* wizard */
.ac-scrim{position:absolute;inset:0;background:rgba(10,8,6,.76)}
.ac-sheet{position:absolute;left:150px;top:150px;width:980px;height:500px;background:var(--card);border:2px solid var(--line-2);border-radius:var(--r-lg);box-shadow:0 6px 0 #0C0A08,0 30px 60px rgba(0,0,0,.45);display:grid;grid-template-columns:236px 1fr;overflow:hidden}
.ac-steps{background:var(--paper-2);border-right:1px solid var(--line);padding:24px 14px;display:flex;flex-direction:column;gap:6px}
.ac-steps .ac-sh{padding:0 10px 14px}
.ac-step{display:grid;grid-template-columns:26px 1fr;gap:10px;padding:10px;border-radius:12px;position:relative}
.ac-step .ac-n{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-family:var(--mono);font-size:12px;font-weight:600;border:2px solid var(--line-2);color:var(--muted)}
.ac-step .ac-t{font-weight:600;font-size:13.5px;color:var(--ink-2);line-height:26px}
.ac-step .ac-s{grid-column:2;font-size:12px;color:var(--muted);margin-top:-4px;line-height:1.4}
.ac-step.done .ac-n{background:var(--ok-soft);border-color:transparent;color:var(--ok)}
.ac-step.on{background:var(--card);box-shadow:var(--sh-card)}
.ac-step.on::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:var(--red)}
.ac-step.on .ac-n{background:var(--ink);border-color:var(--ink);color:#0E0C0A}
.ac-step.on .ac-t{color:var(--ink)}
.ac-step.next .ac-t{color:var(--muted)}
.ac-step.next .ac-n{color:var(--faint)}
.ac-main{display:flex;flex-direction:column;min-width:0;position:relative}
.ac-mbody{padding:26px 30px 0;flex:1;min-height:0}
.ac-mfoot{display:flex;align-items:center;gap:14px;padding:16px 30px;border-top:1px solid var(--line);background:var(--paper-2)}
.ac-close{position:absolute;right:14px;top:14px;width:28px;height:28px;display:grid;place-items:center;color:var(--muted);border-radius:8px}
.ac-tbl{border:2px solid var(--line-2);border-radius:var(--r);background:var(--paper);overflow:hidden}
.ac-tbl .ac-dhead{background:var(--paper-2);padding-top:8px;border-bottom:1px solid var(--line)}
.ac-tbl .ac-drow:first-of-type{border-top:0}
.ac-addchip{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 12px;border-radius:999px;border:2px dashed var(--line-2);font-size:12.5px;font-weight:600;color:var(--ink-2)}
.ac-addchip .sw{width:9px;height:9px}
.ac-addchip.ac-other{color:var(--muted)}

/* settings */
.ac-set{padding:18px 32px 0;max-width:1000px}
.ac-sec{margin-top:18px}
.ac-sec .section-label{margin-bottom:8px}
.ac-set .ac-dhead{padding-bottom:4px}
.ac-set .ac-drow{height:40px}
.ac-addrow{display:flex;align-items:flex-end;gap:12px;margin-top:8px;padding:10px 12px;border:2px dashed var(--line-2);border-radius:var(--r)}
.ac-addrow .field label{color:var(--muted)}
.ac-addrow .in{background:var(--paper)}
.ac-ph{color:var(--faint)}
.ac-sel{justify-content:space-between;gap:8px}
.ac-sel .ac-ic{color:var(--muted)}
.ac-mrow{display:grid;grid-template-columns:26px 150px 1fr 118px 72px;column-gap:12px;align-items:center;height:42px;border-top:1px solid var(--line);padding:0 12px;font-size:13px}
.ac-mrow:first-of-type{border-top:0}
.ac-email{color:var(--muted);font-size:12.5px}
.ac-you{justify-self:end;font-size:12px;color:var(--faint)}
.ac-arch{display:flex;align-items:center;gap:20px;padding:14px 18px}
.ac-arch h3{margin:0 0 2px;font-size:14.5px;font-weight:700;color:var(--ink)}
.ac-arch p{margin:0;font-size:12.5px;color:var(--muted)}

/* tokens */
.ac-tok{padding:18px 32px 0;max-width:940px}
.ac-create{display:flex;align-items:flex-end;gap:12px;margin-top:16px}
.ac-create .field{flex:1;max-width:440px}
.ac-new{margin-top:16px;border-color:var(--red);padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.ac-new h3{margin:0;font-size:14.5px;font-weight:700;color:var(--ink)}
.ac-secret{display:flex;gap:10px;align-items:center}
.ac-secret .in{flex:1;font-family:var(--mono);font-size:13px;letter-spacing:.02em;height:34px}
.ac-confirm td{background:var(--elev)!important}
.ac-confirm .row{gap:14px}
"""

AC = {
    "grip": '<svg viewBox="0 0 12 16"><circle cx="3.5" cy="3" r="1.3"/><circle cx="8.5" cy="3" r="1.3"/><circle cx="3.5" cy="8" r="1.3"/><circle cx="8.5" cy="8" r="1.3"/><circle cx="3.5" cy="13" r="1.3"/><circle cx="8.5" cy="13" r="1.3"/></svg>',
    "chev": '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    "check": '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    "x": '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    "copy": '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/></svg>',
}


def ic(name, cls=""):
    return f'<span class="ac-ic {cls}">{AC[name]}</span>'


def seg(items, on, mono=False):
    cls = "seg ac-sm" + (" ac-mono" if mono else "")
    return f'<div class="{cls}">' + "".join(f'<button class="{"on" if i == on else ""}">{t}</button>' for i, t in enumerate(items)) + "</div>"


# ---------- 1. Sign in ----------
def screen_login():
    return f'''<div class="frame ac-frame" style="width:1280px;height:800px">
  <div class="ac-stage">
    <div class="card ac-login">
      <div class="col" style="gap:10px">
        <div class="ac-lockup"><span class="mark ac-mark-lg" aria-hidden="true">B</span><span class="ac-wordmark">Binder</span><span class="ac-chip">by RVLT</span></div>
        <div class="hand ac-quiet">the book is where you left it</div>
      </div>
      <div class="col" style="gap:14px">
        <div class="field"><label>Email</label><div class="in ac-lg">jayden@twotoned.example</div></div>
        <div class="field"><label>Password</label><div class="in ac-lg ac-dots">••••••••••••</div></div>
      </div>
      <div class="col" style="gap:14px;align-items:stretch">
        <button class="btn primary ac-block">Sign in</button>
        <div class="ac-center"><a class="ac-link" href="#">Email me a link instead</a></div>
      </div>
    </div>
    <div class="muted small ac-center">Stays signed in on this device, so the book opens offline.</div>
  </div>
</div>'''


# ---------- 2. New show ----------
def _wiz_row(sw, code, cls, name, fmt, side):
    return f'''<div class="ac-dgrid ac-drow" style="grid-template-columns:16px 24px 56px 1fr 128px 128px 60px;height:46px">
      <span class="ac-ic ac-grip ac-fill">{AC["grip"]}</span>
      <span class="ac-swbtn"><i class="ac-sw-{sw}"></i></span>
      <span class="ac-code {cls}">{code}</span>
      <span class="ac-dname">{name}</span>
      {seg(["10.5", "10.50"], fmt, mono=True)}
      {seg(["Left", "Right"], side)}
      <button class="ac-rm">Remove</button>
    </div>'''


def screen_newshow():
    chips = [("sm", "SM"), ("vid", "VID"), ("stg", "STG"), ("fly", "FLY"), ("pyro", "PYRO")]
    chips_html = "".join(f'<span class="ac-addchip"><span class="sw ac-sw-{k}"></span><span class="mono">{c}</span></span>' for k, c in chips)
    return f'''<div class="frame ac-frame" style="width:1280px;height:800px">
  {screen_home().replace('<div class="frame" style="width:1280px;height:800px">', '<div style="position:absolute;inset:0">', 1)}
  <div class="ac-scrim"></div>
  <div class="ac-sheet" role="dialog" aria-label="New show">
    <aside class="ac-steps">
      <div class="ac-sh"><div class="t-over">New show</div><div class="t-title" style="font-size:18px;margin-top:2px">Set it up</div></div>
      <div class="ac-step done"><span class="ac-n">{ic("check")}</span><span class="ac-t">Name</span><span class="ac-s">Little Women · Two Toned Productions · opens 14 Nov</span></div>
      <div class="ac-step on" aria-current="step"><span class="ac-n">2</span><span class="ac-t">Departments</span></div>
      <div class="ac-step next"><span class="ac-n">3</span><span class="ac-t">Script</span></div>
    </aside>
    <section class="ac-main">
      <button class="ac-close" aria-label="Close">{ic("x")}</button>
      <div class="ac-mbody">
        <div class="t-title" style="font-size:22px">Departments</div>
        <div class="muted" style="margin:4px 0 18px;max-width:60ch">Each one gets its own layer on the page and its own cue list. The number format and the margin side can change later in Show settings.</div>
        <div class="ac-tbl">
          <div class="ac-dgrid ac-dhead" style="grid-template-columns:16px 24px 56px 1fr 128px 128px 60px"><span></span><span></span><span>Code</span><span>Name</span><span>Number format</span><span>Marker side</span><span></span></div>
          {_wiz_row("lx", "LX", "lx", "Lighting", 0, 0)}
          {_wiz_row("snd", "SND", "snd", "Sound", 1, 1)}
          {_wiz_row("tm", "TM", "tm", "TheatreMix", 1, 0)}
        </div>
        <div class="section-label" style="margin:22px 0 10px">Add another</div>
        <div class="row" style="gap:8px;flex-wrap:wrap">{chips_html}<span class="ac-addchip ac-other">+ other</span></div>
        <div class="small faint" style="margin-top:14px">Drag the handle to reorder. The order is the order of the layers and the cue lists.</div>
      </div>
      <div class="ac-mfoot">
        <button class="btn ghost">Back</button>
        <div class="spacer"></div>
        <a class="ac-link" href="#">Skip, add later</a>
        <button class="btn primary">Continue</button>
      </div>
    </section>
  </div>
</div>'''


# ---------- 3. Show settings ----------
def _set_row(sw, code, name, fmt, side, count):
    return f'''<div class="ac-dgrid ac-drow" style="grid-template-columns:16px 24px 56px 1fr 128px 128px 74px 64px">
      <span class="ac-ic ac-grip ac-fill">{AC["grip"]}</span>
      <button class="ac-swbtn" title="Change colour"><i class="ac-sw-{sw}"></i></button>
      <span class="ac-code {sw}">{code}</span>
      <span class="ac-dname">{name}</span>
      {seg(["10.5", "10.50"], fmt, mono=True)}
      {seg(["Left", "Right"], side)}
      <span class="ac-cnt">{count}<span>cues</span></span>
      <button class="ac-rm">Remove</button>
    </div>'''


def _member(av, ini, name, email, role, you=False):
    right = '<span class="ac-you">You</span>' if you else '<button class="ac-rm">Remove</button>'
    return f'''<div class="ac-mrow">
      <span class="avatar {av}">{ini}</span>
      <span class="ac-dname">{name}</span>
      <span class="ac-email">{email}</span>
      <div class="field"><div class="in ac-sel" style="height:28px"><span>{role}</span>{ic("chev")}</div></div>
      {right}
    </div>'''


def screen_settings():
    return f'''<div class="frame ac-frame" style="width:1280px;height:800px">
  {rail("", foot=True)}
  {topbar('<span>Songs for a New World</span><span class="sep">/</span><b>Settings</b>', '<span class="sync"><span class="dot"></span>Synced</span>')}
  <main class="content ac-set">
    <div class="row" style="justify-content:space-between;align-items:baseline">
      <div class="t-title">Show settings</div>
      <div class="small muted">Only the owner can change these.</div>
    </div>

    <section class="ac-sec" style="margin-top:14px">
      <div class="section-label">Departments</div>
      <div class="ac-dgrid ac-dhead" style="grid-template-columns:16px 24px 56px 1fr 128px 128px 74px 64px"><span></span><span></span><span>Code</span><span>Name</span><span>Number format</span><span>Marker side</span><span style="text-align:right">Cues</span><span></span></div>
      {_set_row("lx", "LX", "Lighting", 0, 0, 61)}
      {_set_row("snd", "SND", "Sound", 1, 1, 28)}
      {_set_row("tm", "TM", "TheatreMix", 1, 0, 7)}
      <div class="ac-addrow">
        <div class="field" style="width:96px"><label>Code</label><div class="in mono"><span class="ac-ph">PYRO</span></div></div>
        <div class="field" style="flex:1"><label>Name</label><div class="in"><span class="ac-ph">Pyrotechnics</span></div></div>
        <div class="field"><label>Colour</label><button class="ac-swbtn" style="height:30px;width:34px"><i class="ac-sw-pyro"></i></button></div>
        <div class="field"><label>Number format</label>{seg(["10.5", "10.50"], 0, mono=True)}</div>
        <div class="field"><label>Marker side</label>{seg(["Left", "Right"], 0)}</div>
        <button class="btn">Add</button>
      </div>
    </section>

    <section class="ac-sec">
      <div class="section-label">Members</div>
      {_member("av-amber", "JN", "Jayden", "jayden@twotoned.example", "Owner", you=True)}
      {_member("av-teal", "OL", "Oli", "oli@twotoned.example", "Editor")}
      {_member("av-blue", "MK", "Mikaela", "mikaela@twotoned.example", "Editor")}
      {_member("av-purple", "AR", "Alex R", "alex@twotoned.example", "Viewer")}
      <div class="ac-addrow" style="margin-top:6px">
        <div class="field" style="flex:1;max-width:400px"><label>Invite by email</label><div class="in"><span class="ac-ph">name@twotoned.example</span></div></div>
        <div class="field" style="width:118px"><label>Role</label><div class="in ac-sel"><span>Editor</span>{ic("chev")}</div></div>
        <button class="btn">Invite</button>
      </div>
      <div class="small muted" style="margin-top:8px">Editors place and move cues on any layer. Viewers read and export.</div>
    </section>

    <section class="ac-sec">
      <div class="section-label">Archive</div>
      <div class="card ac-arch">
        <div style="flex:1"><h3>Archive this show</h3><p>It becomes read-only for everyone. Exports still work and nothing is deleted.</p></div>
        <button class="btn">Archive show</button>
      </div>
    </section>
  </main>
</div>'''


# ---------- 4. Personal access tokens ----------
def screen_tokens():
    return f'''<div class="frame ac-frame" style="width:1280px;height:800px">
  {rail("", foot=True)}
  {topbar('<span>Jayden</span><span class="sep">/</span><b>Personal access tokens</b>', '<span class="sync"><span class="dot"></span>Synced</span>')}
  <main class="content ac-tok">
    <div class="t-title">Personal access tokens</div>
    <div class="muted" style="margin-top:4px">Tokens act as you. Changes made with one show in Activity as “via &lt;its name&gt;”.</div>

    <div class="ac-create">
      <div class="field"><label>Name</label><div class="in"><span class="ac-ph">Claude Code on the laptop</span></div></div>
      <button class="btn primary">Create token</button>
    </div>

    <div class="card ac-new" role="alert">
      <h3>Copy it now. Binder will not show it again.</h3>
      <div class="ac-secret">
        <div class="field" style="flex:1"><div class="in">bndr_••••••••••••••••••••••••</div></div>
        <button class="btn">{ic("copy")} Copy</button>
      </div>
      <div class="small muted">Token “Claude Code on the laptop”, created just now.</div>
    </div>

    <div class="section-label" style="margin:24px 0 6px">Your tokens</div>
    <table class="table">
      <thead><tr><th>Name</th><th style="width:150px">Created</th><th style="width:190px">Last used</th><th style="width:100px"></th></tr></thead>
      <tbody>
        <tr><td style="font-weight:600">Claude Code on the laptop</td><td class="muted">today</td><td class="muted">today <span class="mono">13:40</span></td><td style="text-align:right"><button class="btn sm ghost">Revoke</button></td></tr>
        <tr><td style="font-weight:600">TheatreMix script skill</td><td class="muted"><span class="mono">3 Oct</span></td><td class="muted">yesterday <span class="mono">22:51</span></td><td style="text-align:right"><button class="btn sm ghost">Revoke</button></td></tr>
        <tr><td style="font-weight:600">iPad</td><td class="muted"><span class="mono">9 Oct</span></td><td class="muted">never used</td><td></td></tr>
        <tr class="ac-confirm"><td colspan="4"><div class="row" style="justify-content:space-between">
          <span>Revoke “iPad”? Anything using it stops working.</span>
          <span class="row" style="gap:8px"><button class="btn sm ac-solid">Revoke</button><button class="btn sm ghost">Keep</button></span>
        </div></td></tr>
      </tbody>
    </table>
  </main>
</div>'''


SCREENS = [
    ("login", "08 · 1280 × 800", "Sign in",
     "The front door is one card on the espresso ground and nothing else. It says who it is, takes an email and a password, and tells you the book will open offline.",
     ["<b>One card, no rail.</b> Nobody is signed in, so there is no navigation to show; the only red is the Sign in button.",
      "<b>The link is quiet.</b> “Email me a link instead” is a text link, because it only appears when the server can send mail and most people never need it.",
      "<b>The note answers a worry.</b> “Stays signed in on this device” is there because a stage manager at the tech table will not re-enter a password to open the book; it is the offline promise in one line.",
      "<b>One Kalam line</b>, muted rather than red, under the wordmark. This is the only screen in the set that greets you, so it earns the handwriting."],
     screen_login, 1280, 800),
    ("newshow", "09 · 1280 × 800", "New show",
     "A three-step sheet over the shows home: name it, choose departments, add the script. You can skip any step and come back to it in Show settings.",
     ["<b>Done steps collapse to a sentence.</b> Step 1 shows “Little Women · Two Toned Productions · opens 14 Nov” so you can check it without going back.",
      "<b>Departments are the real decision.</b> LX, SND and TM come ready-made, each with its colour, code, number format and margin side set in one row, because that is what the page will look like.",
      "<b>Chips add the rest.</b> SM, VID, STG, FLY and PYRO each bring their own colour; “+ other” opens the same row with an empty colour for anything else.",
      "<b>Red marks two things only:</b> the step you are on and Continue. Back is a ghost and “Skip, add later” is a link, so skipping never looks like the right answer or the wrong one."],
     screen_newshow, 1280, 800),
    ("settings", "10 · 1280 × 800", "Show settings",
     "Departments, members and archive on one page, in the order people change them. Nothing is red, because nothing here is the main action; it is a page you visit, fix one thing on and leave.",
     ["<b>Departments reuse the wizard row</b>, with the cue count and a clickable colour swatch added. The Add row sits at the end and stays dashed until it has a code.",
      "<b>Members read as a list.</b> Role is a select on the row, the owner row says “You” instead of Remove, and the note under the invite row explains what Editor and Viewer mean in one line.",
      "<b>Archive is plain on purpose.</b> It is reversible in spirit (read-only, nothing deleted), so the button is a normal one and the card carries the explanation.",
      "<b>“Only the owner can change these.”</b> sits top right. On a non-owner’s screen the same page renders with the controls disabled, not hidden, so editors can still see how the show is set up."],
     screen_settings, 1280, 800),
    ("tokens", "11 · 1280 × 800", "Personal access tokens",
     "Account-level, reached from the avatar. A token lets Claude Code or a script act as you; this page creates them, shows each one once, and revokes them.",
     ["<b>One red primary, one red alert.</b> Create token is the primary; the card that follows has a red outline because losing the secret is the one real failure here. It uses plain words and no handwriting.",
      "<b>The secret is masked in the mockup</b> as bndr_ and dots. In the app it shows once, then never again; Copy is a normal button.",
      "<b>No scopes column.</b> Binder tokens are all-or-nothing and act as you, which the intro line says before anyone creates one.",
      "<b>Revoke asks inline.</b> The confirmation replaces the row’s actions instead of opening a modal, and its Revoke is dark, not red, so the sentence is what carries the weight."],
     screen_tokens, 1280, 800),
]
