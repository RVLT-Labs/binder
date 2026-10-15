#!/usr/bin/env python3
"""Render one screens module on its own, for checking it before it joins index.html.

    python3 _preview.py screens2_access        → writes _preview_screens2_access.html

A screens module defines CSS (a string of extra rules, may be empty) and SCREENS, a list of
(id, kicker, title, blurb, notes, fn, w, h) where fn() returns the frame HTML. Screenshot the
result with _shot.mjs.
"""
import importlib
import sys

from _parts import FIT_SCRIPT, HERE, head, wrap

name = sys.argv[1]
mod = importlib.import_module(name)
css = getattr(mod, "CSS", "")
page = [head, f"<style>{css}</style>" if css else ""]
for id_, kicker, title, blurb, notes, fn, w, h in mod.SCREENS:
    page.append(wrap(id_, kicker, title, blurb, notes, fn(), w, h))
page.append(FIT_SCRIPT)
out = HERE / f"_preview_{name}.html"
out.write_text("\n".join(page))
print(out)
