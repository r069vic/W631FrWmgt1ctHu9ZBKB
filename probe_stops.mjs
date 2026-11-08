// Probe 2: nonstop on leg 1, click the cheapest leg-1 flight, read what the leg-2 list (TPE>Y or X>TPE) shows.
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
const varint = (n) => { const o = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return Buffer.from(o); };
const field = (no, wire, payload) => Buffer.concat([varint(no * 8 + wire), payload]);
const str = (no, s) => { const b = Buffer.from(s); return field(no, 2, Buffer.concat([varint(b.length), b])); };
const msg = (no, b) => field(no, 2, Buffer.concat([varint(b.length), b]));
const num = (no, n) => field(no, 0, varint(n));
const apb = (c) => Buffer.concat([num(1, 1), str(2, c)]);
const AIR = ['BR', 'CI', 'JX', 'JL', 'NH', 'KE', 'OZ', 'CX', 'BI'];
const tfs = (X, Y, out, back, s1, s2) => {
  const leg = (f, t, d, st, air) => msg(3, Buffer.concat([str(2, d), ...(st === null ? [] : [num(5, st)]), ...(air ? AIR.map((a) => str(6, a)) : []), msg(13, apb(f)), msg(14, apb(t))]));
  return Buffer.concat([leg(X, 'TPE', out, s1, true), leg('TPE', Y, back, s2, false), num(8, 1), num(9, 1), num(19, 3)]).toString('base64url');
};
const JOBS = [['NRT', 'BWN', '2026-12-06', '2027-06-09'], ['HKG', 'BWN', '2026-12-06', '2027-06-09'], ['BWN', 'HKG', '2027-02-07', '2027-05-12'], ['BWN', 'NRT', '2026-12-06', '2027-06-09']];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: 'new', args: ['--lang=zh-TW', '--no-sandbox', '--disable-dev-shm-usage'] });
const out = [];
for (const [X, Y, d1, d2] of JOBS) {
  const p = await b.newPage(); await p.setExtraHTTPHeaders({ 'Accept-Language': 'zh-TW' }); await p.setViewport({ width: 1100, height: 1500 });
  const rowsOf = () => p.evaluate(() => [...document.querySelectorAll('li')].map((l) => l.innerText.split('\n').map((s) => s.trim()).filter(Boolean)).filter((x) => x.some((s) => /^\$[\d,]+$/.test(s)) && x.includes('–')).slice(0, 4).map((x) => x.filter((s) => !/CO2e|排放/.test(s)).join(' | ')));
  const rec = { X, Y, d1, d2 };
  try {
    await p.goto(`https://www.google.com/travel/flights?tfs=${tfs(X, Y, d1, d2, 0, 0)}&hl=zh-TW&gl=TW&curr=TWD`, { waitUntil: 'networkidle2', timeout: 60000 });
    for (let i = 0; i < 20; i++) { await sleep(1500); rec.leg1 = await rowsOf(); if (rec.leg1.length) break; }
    rec.txt1 = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 400);
    // click the first leg-1 row
    const clicked = await p.evaluate(() => { const l = [...document.querySelectorAll('li')].find((x) => /\$[\d,]+/.test(x.innerText) && x.innerText.includes('–')); if (l) { l.scrollIntoView({ block: 'center' }); l.click(); return true; } return false; });
    rec.clicked = clicked; await sleep(6000);
    for (let i = 0; i < 10; i++) { rec.leg2 = await rowsOf(); if (rec.leg2.some((r) => /TPE–|–TPE/.test(r) && !r.startsWith(rec.leg1?.[0]?.slice(0, 5)))) break; await sleep(1500); }
    rec.txt2 = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 600);
  } catch (e) { rec.err = String(e).slice(0, 200); }
  out.push(rec); await p.close();
}
await b.close();
mkdirSync('test-out', { recursive: true }); writeFileSync('test-out/probe-stops.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1).slice(0, 5000));
