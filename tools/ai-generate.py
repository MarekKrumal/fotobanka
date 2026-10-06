#!/usr/bin/env python3
"""Vygeneruje AI fotky přes Higgsfield (Soul 2.0) podle tools/ai-prompts.json.

    python3 tools/ai-generate.py            # vygeneruje, co ještě chybí (navazuje)
    python3 tools/ai-generate.py --merge    # přidá hotové fotky do data/banka.json (tag „ai“)

Soubory: public/ai/<id>.jpg (plné ~2016 px) + public/ai/t/<id>.jpg (náhled 900 px),
záznam o každé fotce v data/ai/manifest.jsonl.
"""
import json, os, subprocess, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFGN = sys.argv[sys.argv.index('--cfg') + 1] if '--cfg' in sys.argv else 'ai-prompts.json'
CFG = json.load(open(os.path.join(ROOT, 'tools', CFGN)))
OUT = os.path.join(ROOT, 'public', 'ai'); os.makedirs(os.path.join(OUT, 't'), exist_ok=True)
MAN = os.path.join(ROOT, 'data', 'ai', 'manifest.jsonl'); os.makedirs(os.path.dirname(MAN), exist_ok=True)
MODEL = CFG.get('model', 'text2image_soul_v2')
EXTRA = CFG.get('params', ['--quality', '2k'])

def done(path=MAN):
    try: return [json.loads(l) for l in open(path)]
    except FileNotFoundError: return []

def job(args):
    i, k, (cat, sub, tags, prompt) = args
    ar = '16:9' if k == 2 else '3:2'
    full = f"{prompt}. {CFG['style']}"
    r = subprocess.run(['higgsfield', 'generate', 'create', MODEL, '--prompt', full, '--aspect_ratio', ar, *EXTRA, '--wait', '--json'],
                       capture_output=True, text=True, timeout=900)
    try: j = json.loads(r.stdout[:r.stdout.rindex(']') + 1])[0]
    except Exception: print('chyba', i, k, (r.stderr or r.stdout)[-200:].strip(), flush=True); return
    url = j.get('result_url') or ((j.get('results') or {}).get('raw') or {}).get('url')
    if j.get('status') != 'completed' or not url:
        # result_url může být ve vnořené struktuře — najdi první URL obrázku
        s = json.dumps(j); import re; m = re.search(r'https://[^"]+\.(?:webp|png|jpe?g)', s)
        url = m.group(0) if (m and j.get('status') == 'completed') else None
    if not url: print('neprošlo', i, k, j.get('status'), flush=True); return
    pid = 'ai-' + j['id'][:8]
    raw = os.path.join(OUT, pid + '.src')
    urllib.request.urlretrieve(url, raw)
    subprocess.run(['magick', raw, '-quality', '90', os.path.join(OUT, pid + '.jpg')], check=True)
    subprocess.run(['magick', raw, '-resize', '900x', '-quality', '82', os.path.join(OUT, 't', pid + '.jpg')], check=True)
    os.remove(raw)
    w, h = subprocess.run(['magick', 'identify', '-format', '%w %h', os.path.join(OUT, pid + '.jpg')], capture_output=True, text=True).stdout.split()
    rec = {'cfg': CFGN, 'model': MODEL, 'i': i, 'k': k, 'id': pid, 'cat': cat, 'sub': sub, 'tags': tags, 'prompt': prompt, 'w': int(w), 'h': int(h), 'job': j['id']}
    with open(MAN, 'a') as f: f.write(json.dumps(rec, ensure_ascii=False) + '\n')
    print('ok', pid, cat, sub, flush=True)

def merge():
    bank = json.load(open(os.path.join(ROOT, 'data', 'banka.json')))
    have = {p['id'] for c in bank.values() for l in c.values() for p in l}
    n = 0
    for r in done():
        if r['id'] in have: continue
        p = {'id': r['id'], 'source': 'AI (Higgsfield)', 'w': r['w'], 'h': r['h'], 'alt': r['prompt'], 'photographer': 'Higgsfield ' + r.get('model', 'text2image_soul_v2'),
             'license': 'AI – vlastní generace', 'page': '', 'thumb': f"/ai/t/{r['id']}.jpg", 'large': f"/ai/{r['id']}.jpg", 'original': f"/ai/{r['id']}.jpg",
             'tags': sorted(set(r['tags'] + ['ai'])), 'tagsManual': True}
        bank.setdefault(r['cat'], {}).setdefault(r['sub'], []).append(p); n += 1
    json.dump(bank, open(os.path.join(ROOT, 'data', 'banka.json'), 'w'), ensure_ascii=False)
    print('přidáno do banky', n)

if __name__ == '__main__':
    if '--merge' in sys.argv: merge(); sys.exit()
    got = {(r['i'], r['k']) for r in done() + done(os.path.join(ROOT, 'data', 'ai', 'rejected.jsonl')) if r.get('cfg', 'ai-prompts.json') == CFGN}
    todo = [(i, k, it) for i, it in enumerate(CFG['items']) for k in range(CFG['per']) if (i, k) not in got]
    lim = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
    todo = todo[:lim] if lim else todo
    print('k vygenerování', len(todo), flush=True)
    with ThreadPoolExecutor(6) as ex: list(ex.map(job, todo))
