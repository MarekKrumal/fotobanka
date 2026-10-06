// Booqito fotobanka — lokální webová aplikace.
//   node server.mjs      → http://127.0.0.1:4420
// Zdroje bez API klíčů:
//   Pexels, Pixabay — skutečný prohlížeč na pozadí (Playwright, sdílený, zavře se po 5 min nečinnosti),
//                     stránky se načítají jedna po druhé
//   Openverse       — otevřené API (Wikimedia, Flickr, StockSnap, rawpixel…), jen licence CC0 / public domain
// Data:
//   categories.json          31 kategorií odvětví z booqito.com/o/ → podkategorie [název, anglický dotaz]
//   data/cache/              výsledky hledání (zdroj-dotaz-orientace-stránka.json)
//   data/banka.json          vybrané fotky { [catSlug]: { [subName]: [photo...] } }
//   stazene/<cat>/<sub>/     stažené soubory + stazene/kredity.tsv
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PORT = +(process.env.PORT || 4420)
const CATS = JSON.parse(fs.readFileSync(path.join(ROOT, 'categories.json'), 'utf8'))
const BANK = path.join(ROOT, 'data', 'banka.json')
const CACHE = path.join(ROOT, 'data', 'cache')
fs.mkdirSync(CACHE, { recursive: true })
const loadBank = () => {
  let b; try { b = JSON.parse(fs.readFileSync(BANK, 'utf8')) } catch { return {} }
  for (const subs of Object.values(b)) for (const [sub, list] of Object.entries(subs)) list.forEach((p) => normalize(p, sub))
  return b
}
const saveBank = (b) => fs.writeFileSync(BANK, JSON.stringify(b, null, 1))
// fotky, které někdo odebral (ručně nebo při kontrole) — hromadné doplnění je už nevrátí
const BLOCK = path.join(ROOT, 'data', 'vyrazene.json')
const loadBlock = () => { try { return new Set(JSON.parse(fs.readFileSync(BLOCK, 'utf8'))) } catch { return new Set() } }
const block = (id) => { const b = loadBlock(); b.add(id); fs.writeFileSync(BLOCK, JSON.stringify([...b])) }
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const err = (msg, status = 500) => Object.assign(new Error(msg), { status })

// ---------------------------------------------------------------- tagy
// Automaticky z popisu fotky (anglicky u Pexels/Pixabay/Openverse) + z podkategorie.
// Ruční úpravy se ukládají do photo.tags a mají přednost (photo.tagsManual = true).
const TAG_RULES = [
  ['děti', /\b(kids?|child|children|boy|girl|toddler|baby|little|school)\b/i],
  ['rodina', /\b(famil(y|ies)|parents?|mother|father|mom|dad|grand(ma|pa|parents?))\b/i],
  ['pár', /\b(couple|romantic|lovers?|boyfriend|girlfriend|husband|wife|date)\b/i],
  ['přátelé', /\b(friends?|group|team|people|crowd|together|colleagues)\b/i],
  ['žena', /\b(wom[ae]n|lady|girl|female)\b/i],
  ['muž', /\b(m[ae]n|guy|male|gentleman)\b/i],
  ['senioři', /\b(senior|elderly|old (man|woman|people)|retire)/i],
  ['luxus', /\b(luxur(y|ious)|elegant|premium|exclusive|vip|hotel|resort|gold(en)?)\b/i],
  ['relax', /\b(relax(ing|ation)?|calm|peace(ful)?|zen|rest(ing)?|meditat)/i],
  ['akce', /\b(action|jump(ing)?|run(ning)?|speed|race|racing|extreme|adrenaline|fast)\b/i],
  ['sport', /\b(sport|athlet|fitness|workout|training|play(ing|er)?|game|match|ball)\b/i],
  ['venku', /\b(outdoors?|outside|nature|park|forest|garden|beach|mountain|sky|lake|river|field|sunny|street)\b/i],
  ['uvnitř', /\b(indoors?|inside|interior|room|studio|hall|arena)\b/i],
  ['voda', /\b(water|pool|swim|sea|ocean|lake|river|wet|bath|wave)\b/i],
  ['léto', /\b(summer|sunny|sunshine|beach|tropical)\b/i],
  ['zima', /\b(winter|snow|ski|ice|frozen|cold)\b/i],
  ['noc', /\b(night|neon|dark|evening|candle(light)?s?|lights?)\b/i],
  ['detail', /\b(close[- ]?up|detail|macro)\b/i],
]
const SUB_TAGS = [
  ['děti', /dět|kids/i], ['rodina', /rodin|famil/i], ['pár', /pár|dva/i], ['luxus', /luxus|zámek|zážit/i], ['relax', /masáž|spa|sauna|wellness|relax|pára|aroma|jeskyn/i],
  ['voda', /bazén|vířiv|aquapark|tobog|koupal|lodě|rafting|akvári|lázn|koupel/i], ['venku', /venk|koupaliště|golf|pouť|zoo|statek|lanov/i],
]
function autoTags(p, sub = '') {
  const text = `${p.alt || ''}`
  const t = new Set(TAG_RULES.filter(([, re]) => re.test(text)).map(([k]) => k))
  for (const [k, re] of SUB_TAGS) if (re.test(sub)) t.add(k)
  // „bez lidí" jen když popis o lidech nic neříká a nemá žádný „lidský" tag
  const PEOPLE = /\b(person|persons|people|man|men|woman|women|kids?|child(ren)?|boys?|girls?|couple|players?|friends?|family|hands?|guy|lady|visitors?|tourists?|crowd|group|team|someone|person's|athletes?|swimmer|skier|rider|driver|bowler|worker)\b/i
  if (text.trim() && !PEOPLE.test(text) && !['děti', 'rodina', 'pár', 'přátelé', 'žena', 'muž', 'senioři'].some((k) => t.has(k))) t.add('bez lidí')
  return [...t]
}
// Vyšší rozlišení: Pexels náhled 900 px, velká 2560 px + originál (stahuje se velká).
function hiRes(p) {
  const m = String(p.id).match(/^pexels-(\d+)$/)
  if (m) {
    // přesný soubor z dat Pexels (některé fotky jsou .png / .jpg) — jinak odhad .jpeg
    const base = p.base || `https://images.pexels.com/photos/${m[1]}/pexels-photo-${m[1]}.jpeg`
    p.thumb = `${base}?auto=compress&cs=tinysrgb&w=900`
    p.large = `${base}?auto=compress&cs=tinysrgb&w=2560`
    p.original = base
  }
  return p
}
function normalize(p, sub) { hiRes(p); if (!p.tagsManual) p.tags = autoTags(p, sub); return p }

// ---------------------------------------------------------------- prohlížeč na pozadí
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
let browser = null, ctx = null, idle = null, queue = Promise.resolve()
function withPage(fn) {
  const run = async () => {
    clearTimeout(idle)
    if (!browser) {
      const { chromium } = await import('playwright')
      browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] })
      ctx = await browser.newContext({ userAgent: UA, locale: 'en-US', viewport: { width: 1400, height: 1000 } })
    }
    const page = await ctx.newPage()
    try { return await fn(page) } finally {
      await page.close().catch(() => {})
      idle = setTimeout(async () => { const b = browser; browser = null; ctx = null; await b?.close().catch(() => {}) }, 5 * 60 * 1000)
    }
  }
  const p = queue.then(run, run); queue = p.catch(() => {}); return p
}
// Zdvořilé tempo: Pexels po pár rychlých dotazech vrací 403 (ochrana proti botům).
const GAP = { pexels: 9000, pixabay: 3000 }, last = {}
const pace = async (src) => { const w = (last[src] || 0) + (GAP[src] || 0) - Date.now(); if (w > 0) await new Promise((r) => setTimeout(r, w)); last[src] = Date.now() }
async function resetBrowser() { const b = browser; browser = null; ctx = null; await b?.close().catch(() => {}) }
process.on('SIGINT', async () => { await browser?.close().catch(() => {}); process.exit(0) })
process.on('SIGTERM', async () => { await browser?.close().catch(() => {}); process.exit(0) })

// ---------------------------------------------------------------- zdroje
const ORI = {
  pexels: { landscape: 'landscape', portrait: 'portrait', square: 'square' },
  pixabay: { landscape: 'horizontal', portrait: 'vertical' },
  openverse: { landscape: 'wide', portrait: 'tall', square: 'square' },
}
async function searchPexels(q, page, ori) {
  await pace('pexels')
  try { return await pexelsOnce(q, page, ori) } catch (e) {
    if (!/403/.test(e.message)) throw e
    await resetBrowser(); await new Promise((r) => setTimeout(r, 20000)); last.pexels = Date.now()  // nová relace + pauza, jeden pokus navíc
    return pexelsOnce(q, page, ori)
  }
}
function pexelsOnce(q, page, ori) {
  const u = new URL(`https://www.pexels.com/search/${encodeURIComponent(q)}/`)
  if (page > 1) u.searchParams.set('page', String(page))
  if (ORI.pexels[ori]) u.searchParams.set('orientation', ORI.pexels[ori])
  return withPage(async (p) => {
    const r = await p.goto(u.href, { waitUntil: 'domcontentloaded', timeout: 45000 })
    if (!r || r.status() >= 400) throw err(`Pexels ${r?.status()}`, 502)
    const nd = JSON.parse(await p.evaluate(() => document.getElementById('__NEXT_DATA__')?.textContent || '{}'))
    const d = nd?.props?.pageProps?.initialData || {}
    const photos = (d.data || []).filter((x) => x.type === 'photo').map(({ attributes: a }) => ({
      id: `pexels-${a.id}`, source: 'Pexels', w: a.width, h: a.height, alt: a.description || a.title || '',
      base: (a.image?.medium || a.image?.large || '').split('?')[0] || undefined,
      photographer: [a.user?.first_name, a.user?.last_name].filter(Boolean).join(' '), license: 'Pexels',
      page: `https://www.pexels.com/photo/${a.slug}-${a.id}/`,
      thumb: `https://images.pexels.com/photos/${a.id}/pexels-photo-${a.id}.jpeg?auto=compress&cs=tinysrgb&w=600`,
      large: `https://images.pexels.com/photos/${a.id}/pexels-photo-${a.id}.jpeg?auto=compress&cs=tinysrgb&w=2560`,
    })).map(hiRes)
    return { total: d.pagination?.total_results ?? photos.length, pages: d.pagination?.total_pages ?? 1, photos }
  })
}
async function searchPixabay(q, page, ori) {
  await pace('pixabay')
  const u = new URL(`https://pixabay.com/photos/search/${encodeURIComponent(q)}/`)
  if (page > 1) u.searchParams.set('pagi', String(page))
  if (ORI.pixabay[ori]) u.searchParams.set('orientation', ORI.pixabay[ori])
  return await withPage(async (p) => {
    const r = await p.goto(u.href, { waitUntil: 'domcontentloaded', timeout: 45000 })
    if (!r || r.status() >= 400) throw err(`Pixabay ${r?.status()}`, 502)
    for (let i = 0; i < 5; i++) { await p.mouse.wheel(0, 2500); await p.waitForTimeout(400) }
    const raw = await p.evaluate(() => [...document.querySelectorAll('a[href*="/photos/"]')].map((a) => {
      const i = a.querySelector('img'); if (!i) return null
      const set = (i.srcset || '').split(',').map((x) => x.trim().split(' ')[0]).filter(Boolean)
      return { href: a.href, src: set[0] || i.src, big: set[set.length - 1] || i.src, alt: i.alt }
    }).filter(Boolean))
    const seen = new Set()
    const photos = raw.filter((x) => /cdn\.pixabay\.com\/photo/.test(x.src)).map((x) => {
      const id = x.href.match(/-(\d+)\/?$/)?.[1]; if (!id || seen.has(id)) return null; seen.add(id)
      return { id: `pixabay-${id}`, source: 'Pixabay', alt: x.alt.replace(/^Free /, '').replace(/ photo and picture$/, ''), photographer: '', license: 'Pixabay',
        page: x.href, thumb: x.src, large: x.big.replace(/_640\.(jpe?g|png)$/, '_1280.$1') }
    }).filter(Boolean)
    return { total: photos.length, pages: 50, photos }
  })
}
async function searchOpenverse(q, page, ori) {
  const u = new URL('https://api.openverse.org/v1/images/')
  u.searchParams.set('q', q); u.searchParams.set('page', String(page)); u.searchParams.set('page_size', '20') // víc než 20 chce Openverse přihlášení
  u.searchParams.set('license', 'cc0,pdm'); u.searchParams.set('category', 'photograph')
  if (ORI.openverse[ori]) u.searchParams.set('aspect_ratio', ORI.openverse[ori])
  const r = await fetch(u, { headers: { 'user-agent': 'booqito-fotobanka (local)' } })
  if (!r.ok) throw err(`Openverse ${r.status}`, 502)
  const j = await r.json()
  const photos = j.results.map((x) => ({
    id: `openverse-${x.id}`, source: `Openverse · ${x.source}`, w: x.width, h: x.height, alt: x.title || '',
    photographer: x.creator || '', page: x.foreign_landing_url, thumb: x.thumbnail || x.url, large: x.url, license: x.license,
  }))
  return { total: j.result_count, pages: j.page_count, photos }
}
const SOURCES = { pexels: searchPexels, pixabay: searchPixabay, openverse: searchOpenverse }
async function search(source, q, page = 1, ori = 'landscape') {
  const cf = path.join(CACHE, `${source}-${slug(q)}-${ori || 'all'}-${page}.json`)
  if (fs.existsSync(cf)) return { ...JSON.parse(fs.readFileSync(cf, 'utf8')), cached: true }
  const fn = SOURCES[source]; if (!fn) throw err('Neznámý zdroj', 400)
  const data = await fn(q, page, ori)
  if (data.photos.length) fs.writeFileSync(cf, JSON.stringify(data))
  return data
}

// ---------------------------------------------------------------- HTTP
const json = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)) }
const body = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => { try { ok(JSON.parse(s || '{}')) } catch { ok({}) } }) })
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
async function download(url, file) {
  if (fs.existsSync(file)) return false
  // AI fotky leží lokálně v public/ai/ → jen zkopírovat
  if (url.startsWith('/')) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.copyFileSync(path.join(ROOT, 'public', url), file); return true }
  const r = await fetch(url, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`stažení ${r.status}`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()))
  return true
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  try {
    if (u.pathname === '/api/state') return json(res, 200, { categories: CATS, bank: loadBank(), sources: Object.keys(SOURCES) })
    if (u.pathname === '/api/search') {
      const q = u.searchParams.get('q') || '', page = +(u.searchParams.get('page') || 1), ori = u.searchParams.get('orientation') ?? 'landscape'
      const sub = u.searchParams.get('sub') || ''
      const data = await search(u.searchParams.get('source') || 'pexels', q, page, ori)
      return json(res, 200, { ...data, photos: data.photos.map((p) => normalize({ ...p }, sub)) })
    }
    if (u.pathname === '/api/toggle' && req.method === 'POST') {
      const { cat, sub, photo } = await body(req)
      const bank = loadBank(); bank[cat] ??= {}; bank[cat][sub] ??= []
      const list = bank[cat][sub], i = list.findIndex((p) => p.id === photo.id)
      if (i >= 0) { list.splice(i, 1); block(photo.id) } else list.push(normalize(photo, sub))
      if (!list.length) delete bank[cat][sub]
      if (!Object.keys(bank[cat]).length) delete bank[cat]
      saveBank(bank); return json(res, 200, { ok: true, selected: i < 0 })
    }
    if (u.pathname === '/api/tags' && req.method === 'POST') {
      const { cat, sub, id, tags } = await body(req)
      const bank = loadBank(); const p = bank[cat]?.[sub]?.find((x) => x.id === id)
      if (!p) return json(res, 404, { error: 'Fotka není ve fotobance' })
      p.tags = [...new Set((tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20); p.tagsManual = true
      saveBank(bank); return json(res, 200, { ok: true, tags: p.tags })
    }
    if (u.pathname === '/api/autofill' && req.method === 'POST') {
      // Doplní podkategorie (všechny, nebo jedné kategorie) prvními N fotkami na šířku ze zvoleného zdroje.
      const { cat, perSub = 8, source = 'pexels', quota = null } = await body(req)
      const bank = loadBank(), blocked = loadBlock(); let added = 0; const errors = []
      for (const c of CATS.filter((x) => !cat || x.slug === cat)) for (const [name, q] of c.sub) {
        try {
          if ((bank[c.slug]?.[name]?.length || 0) >= perSub) continue
          bank[c.slug] ??= {}; bank[c.slug][name] ??= []
          // „mix" = postupně Pexels → Pixabay → Openverse, dokud podkategorie nemá perSub fotek
          const order = source === 'mix' ? ['pexels', 'pixabay', 'openverse'] : [source]
          // quota: kolik fotek smí přijít z daného zdroje (např. { pexels: 10, pixabay: 6 }) — pestřejší banka
          const fromSrc = (src) => bank[c.slug][name].filter((x) => String(x.id).startsWith(src + '-')).length
          for (const src of order) {
            if (bank[c.slug][name].length >= perSub) break
            if (quota && quota[src] != null && fromSrc(src) >= quota[src]) continue
            let data
            try { data = await search(src, q, 1, 'landscape') } catch (e) { errors.push(`${c.name} / ${name} (${src}): ${e.message}`); continue }
            for (const p of data.photos) { if (bank[c.slug][name].length >= perSub || (quota && quota[src] != null && fromSrc(src) >= quota[src])) break; if (!blocked.has(p.id) && !bank[c.slug][name].some((x) => x.id === p.id)) { bank[c.slug][name].push(normalize({ ...p }, name)); added++ } }
          }
          saveBank(bank)
        } catch (e) { errors.push(`${c.name} / ${name}: ${e.message}`) }
      }
      return json(res, 200, { added, errors })
    }
    if (u.pathname === '/api/download' && req.method === 'POST') {
      const { cat } = await body(req)
      const bank = loadBank(); let n = 0, skipped = 0; const errors = [], credits = []
      for (const [c, subs] of Object.entries(bank)) { if (cat && c !== cat) continue
        for (const [s, list] of Object.entries(subs)) for (const p of list) {
          const rel = `${c}/${slug(s)}/${p.id}.jpg`
          try { (await download(p.large, path.join(ROOT, 'stazene', rel))) ? n++ : skipped++; credits.push([rel, p.source, p.photographer, p.license, p.page].join('\t')) } catch (e) { errors.push(`${p.id}: ${e.message}`) }
        } }
      fs.mkdirSync(path.join(ROOT, 'stazene'), { recursive: true })
      fs.writeFileSync(path.join(ROOT, 'stazene', 'kredity.tsv'), 'soubor\tzdroj\tautor\tlicence\todkaz\n' + credits.join('\n'))
      return json(res, 200, { downloaded: n, skipped, errors, dir: path.join(ROOT, 'stazene') })
    }
    const f = path.join(ROOT, 'public', u.pathname === '/' ? 'index.html' : path.normalize(u.pathname).replace(/^(\.\.[/\\])+/, ''))
    if (f.startsWith(path.join(ROOT, 'public')) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); return fs.createReadStream(f).pipe(res)
    }
    res.writeHead(404); res.end('404')
  } catch (e) { json(res, e.status && e.status < 600 ? e.status : 500, { error: e.message }) }
}).listen(PORT, '127.0.0.1', () => console.log(`Booqito fotobanka → http://127.0.0.1:${PORT}  (Pexels, Pixabay, Openverse — bez API klíčů)`))
