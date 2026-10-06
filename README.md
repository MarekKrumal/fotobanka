# Fotobanka

Fotky podle 32 kategorií odvětví z booqito.com/o/ (140 podkategorií) jako podklad pro náhledy webů. Fotky jsou z Pexels a Pixabay a k tomu AI fotky z Higgsfieldu (tag „ai“).

## Online verze (GitHub Pages)

Statická verze jen pro prohlížení. Umí kategorie, tagy, detail a stažení fotky. Výběr se ukládá v prohlížeči a jde stáhnout jako ZIP. Při každém pushi do `main` ji sestaví `tools/build-static.py` přes GitHub Actions.

## Lokální verze (plná)

    node server.mjs          # → http://127.0.0.1:4420

Hledání a doplňování z fotobank, úprava tagů a stahování do `stazene/` jsou jen v lokální verzi.

- Zdroje bez API klíče: Pexels a Pixabay (prohlížeč na pozadí přes Playwright) a Openverse (API, jen CC0 a public domain). Unsplash blokuje boty.
- Kategorie a dotazy: `categories.json`.
- Výběr: `data/banka.json`. Vyřazené fotky (blocklist) jsou v `data/vyrazene.json`.
- Kontrola tagů: `tools/sheets.py` vytvoří kontaktní listy, `tools/apply-review.py` uloží opravy.
- AI fotky: `tools/ai-generate.py --cfg tools/ai-prompts*.json [--merge]` přes Higgsfield CLI. Soubory jsou v `public/ai/`, záznamy v `data/ai/manifest.jsonl`.
