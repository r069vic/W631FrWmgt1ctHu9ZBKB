// probe: how does vibelyspot.com/daily-flights deliver its data?
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('results', { recursive: true });
const URL = 'https://www.vibelyspot.com/daily-flights';
const out = {};
const r = await fetch(URL, { headers: { 'user-agent': 'Mozilla/5.0' } }).catch((e) => ({ status: 'ERR ' + e.message }));
out.plain = { status: r.status };
if (r.text) { const t = await r.text(); out.plain.len = t.length; out.plain.nextData = /__NEXT_DATA__/.test(t); out.plain.head = t.slice(0, 1500); writeFileSync('results/plain.html', t); }
const rb = await fetch('https://www.vibelyspot.com/robots.txt').then((x) => x.text()).catch((e) => 'ERR ' + e.message);
out.robots = rb.slice(0, 1500);
const br = await chromium.launch(); const pg = await br.newPage();
const calls = [];
pg.on('response', async (res) => { const u = res.url(); const ct = res.headers()['content-type'] || ''; if (/json/.test(ct)) { let b = ''; try { b = (await res.text()).slice(0, 600); } catch {} calls.push({ u, status: res.status(), ct, size: b.length, b }); } });
await pg.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => { out.gotoErr = e.message; });
await pg.waitForTimeout(4000);
out.title = await pg.title();
out.text = (await pg.innerText('body')).slice(0, 3000);
out.json = calls;
writeFileSync('results/page.html', await pg.content());
writeFileSync('results/probe.json', JSON.stringify(out, null, 1));
await br.close();
console.log(JSON.stringify(out, null, 1).slice(0, 12000));
