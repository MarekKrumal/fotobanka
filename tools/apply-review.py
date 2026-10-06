#!/usr/bin/env python3
"""Zapíše výsledky ruční kontroly do fotobanky (server musí běžet na :4420).
   data/review/<cat>__<sub>.json = {"tags": {"1": ["děti","venku"], ...}, "drop": [3, 7]}
   Čísla = pořadí fotky na kontaktním listu (data/sheets/index.json)."""
import json, os, glob, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
idx = json.load(open(os.path.join(ROOT, 'data', 'sheets', 'index.json')))
def post(path, body):
    r = urllib.request.Request('http://127.0.0.1:4420' + path, data=json.dumps(body).encode(), headers={'content-type': 'application/json'})
    return json.load(urllib.request.urlopen(r))
nt = nd = 0
for f in sorted(glob.glob(os.path.join(ROOT, 'data', 'review', '*.json'))):
    key = os.path.basename(f)[:-5]; rv = json.load(open(f)); meta = idx.get(key)
    if not meta: print('neznámý list', key); continue
    ids = meta['ids']
    for n, tags in (rv.get('tags') or {}).items():
        i = int(n) - 1
        if 0 <= i < len(ids) and int(n) not in (rv.get('drop') or []):
            try: post('/api/tags', {'cat': meta['cat'], 'sub': meta['sub'], 'id': ids[i], 'tags': tags}); nt += 1
            except Exception as e: print('tag', key, n, e)
    for n in rv.get('drop') or []:
        i = int(n) - 1
        if 0 <= i < len(ids):
            post('/api/toggle', {'cat': meta['cat'], 'sub': meta['sub'], 'photo': {'id': ids[i]}}); nd += 1
print('otagováno', nt, 'vyřazeno', nd)
