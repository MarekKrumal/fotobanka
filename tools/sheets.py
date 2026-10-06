#!/usr/bin/env python3
"""Kontaktní listy pro ruční kontrolu tagů: jeden PNG na podkategorii, fotky očíslované 1..N.

    python3 tools/sheets.py [vystupni_slozka]

Výstup: <out>/<cat>__<sub-slug>.png + <out>/index.json  { "<cat>__<sub-slug>": {cat, sub, ids:[...]} }
Náhledy se kešují v data/thumbs/ (360 px).
"""
import json, os, re, subprocess, sys, unicodedata, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'data', 'sheets')
THUMBS = os.path.join(ROOT, 'data', 'thumbs')
os.makedirs(OUT, exist_ok=True); os.makedirs(THUMBS, exist_ok=True)

def slug(s):
    s = unicodedata.normalize('NFD', s.lower()); s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')

def small(p):
    m = re.match(r'^pexels-(\d+)$', str(p['id']))
    if m:
        base = p.get('base') or f"https://images.pexels.com/photos/{m[1]}/pexels-photo-{m[1]}.jpeg"
        return base + '?auto=compress&cs=tinysrgb&w=360'
    return p['thumb']

def fetch(p):
    f = os.path.join(THUMBS, f"{p['id']}.jpg")
    if os.path.exists(f) and os.path.getsize(f) > 0: return f
    try:
        data = urllib.request.urlopen(urllib.request.Request(small(p), headers={'User-Agent': 'Mozilla/5.0'}), timeout=30).read()
        open(f, 'wb').write(data); return f
    except Exception as e:
        print('chyba', p['id'], e); return None

bank = json.load(open(os.path.join(ROOT, 'data', 'banka.json')))
cats = json.load(open(os.path.join(ROOT, 'categories.json')))
jobs = [(c['slug'], s[0], bank.get(c['slug'], {}).get(s[0], [])) for c in cats for s in c['sub']]
with ThreadPoolExecutor(12) as ex:
    list(ex.map(fetch, [p for _, _, l in jobs for p in l]))

index = {}
for cat, sub, lst in jobs:
    if not lst: continue
    key = f"{cat}__{slug(sub)}"
    tiles = []
    for i, p in enumerate(lst, 1):
        f = os.path.join(THUMBS, f"{p['id']}.jpg")
        if not os.path.exists(f): continue
        tiles += ['(', f, '-resize', '300x200^', '-gravity', 'center', '-extent', '300x200',
                  '-gravity', 'northwest', '-fill', 'yellow', '-undercolor', '#000a', '-pointsize', '30', '-annotate', '+6+4', str(i), ')']
    cols = 4
    subprocess.run(['magick', *tiles, '-background', '#222', 'miff:-'], check=True, stdout=open(os.path.join(OUT, '_tmp.miff'), 'wb'))
    subprocess.run(['magick', 'montage', os.path.join(OUT, '_tmp.miff'), '-tile', f'{cols}x', '-geometry', '+4+4', '-background', '#222',
                    '-title', f'{cat} / {sub}', '-fill', 'white', '-pointsize', '22', os.path.join(OUT, f'{key}.png')], check=True)
    index[key] = {'cat': cat, 'sub': sub, 'ids': [p['id'] for p in lst]}
os.remove(os.path.join(OUT, '_tmp.miff'))
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), ensure_ascii=False, indent=1)
print('listů', len(index), '→', OUT)
