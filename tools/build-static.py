#!/usr/bin/env python3
"""Statická verze fotobanky pro GitHub Pages → _site/

    python3 tools/build-static.py [vystup]

index.html (statický režim: data.json, výběr v prohlížeči, export CSV), data.json (kategorie + banka
s relativními cestami), ai/ (AI fotky). Hledání, doplňování a úpravy tagů jsou jen v lokální verzi (node server.mjs).
"""
import json, os, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '_site')
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)

cats = json.load(open(os.path.join(ROOT, 'categories.json')))
bank = json.load(open(os.path.join(ROOT, 'data', 'banka.json')))
rel = lambda u: u[1:] if isinstance(u, str) and u.startswith('/') else u   # /ai/... → ai/... (Pages běží v podsložce)
keep = ('id', 'source', 'w', 'h', 'alt', 'photographer', 'license', 'page', 'thumb', 'large', 'original', 'tags')
for subs in bank.values():
    for lst in subs.values():
        lst[:] = [{k: rel(p[k]) for k in keep if k in p} for p in lst]
json.dump({'categories': cats, 'bank': bank}, open(os.path.join(OUT, 'data.json'), 'w'), ensure_ascii=False, separators=(',', ':'))

html = open(os.path.join(ROOT, 'public', 'index.html')).read()
html = html.replace('<script>\n', '<script>window.FOTOBANKA_STATIC = true</script>\n<script>\n', 1)
open(os.path.join(OUT, 'index.html'), 'w').write(html)
shutil.copytree(os.path.join(ROOT, 'public', 'ai'), os.path.join(OUT, 'ai'))
open(os.path.join(OUT, '.nojekyll'), 'w').close()
n = sum(len(l) for s in bank.values() for l in s.values())
print(f'{n} fotek → {OUT}')
