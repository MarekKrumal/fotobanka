import { chromium } from 'playwright'
const [url, out] = process.argv.slice(2)
const b = await chromium.launch()
for (const [n, vp] of [['d', { width: 1440, height: 900 }], ['m', { width: 390, height: 844 }]]) {
  const p = await b.newPage({ viewport: vp }); await p.goto(url); await p.waitForTimeout(2500)
  await p.screenshot({ path: `${out}/nav-${n}.png` }); await p.close()
}
await b.close()
