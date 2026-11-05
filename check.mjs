// One-off check (manual workflow): real search with the full-service filter; prints the cheapest results and their airlines.
// node aircheck.mjs FROM TO OUT [BACK]
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const varint = (n) => { const o = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return Buffer.from(o); };
const field = (no, wire, payload) => Buffer.concat([varint(no * 8 + wire), payload]);
const str = (no, s) => { const b = Buffer.from(s); return field(no, 2, Buffer.concat([varint(b.length), b])); };
const msg = (no, b) => field(no, 2, Buffer.concat([varint(b.length), b]));
const num = (no, n) => field(no, 0, varint(n));
const apb = (c) => Buffer.concat([num(1, 1), str(2, c)]);
const AIR = ['BR', 'CI', 'JX', 'JL', 'NH', 'KE', 'OZ'];
const [F, T, OUT, BACK, Y] = process.argv.slice(2); // multi-city when Y is given: F>T on OUT, T>Y on BACK
const leg = (f, t, d) => msg(3, Buffer.concat([str(2, d), ...AIR.map((a) => str(6, a)), msg(13, apb(f)), msg(14, apb(t))]));
const tfs = Buffer.concat([leg(F, T, OUT), ...(BACK ? [leg(T, Y || F, BACK)] : []), num(8, 1), num(9, 1), num(19, Y ? 3 : BACK ? 1 : 2)]).toString('base64url');
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--lang=zh-TW', '--no-sandbox', '--disable-dev-shm-usage'] });
let rows = [];
for (let at = 0; at < 3 && !rows.length; at++) {
  const p = await b.newPage();
  await p.setExtraHTTPHeaders({ 'Accept-Language': 'zh-TW' }); await p.setViewport({ width: 1100, height: 1500 });
  await p.goto(`https://www.google.com/travel/flights?tfs=${tfs}&hl=zh-TW&gl=TW&curr=TWD`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 50 && !rows.length; i++) {
    await sleep(1000);
    rows = await p.evaluate(() => [...document.querySelectorAll('li')].map((l) => l.innerText.split('\n').map((s) => s.trim()).filter(Boolean)).filter((x) => x.some((s) => /^\$[\d,]+$/.test(s)) && x.includes('–')).map((x) => ({ p: +x.find((s) => /^\$[\d,]+$/.test(s)).replace(/\D/g, ''), air: x[x.indexOf('–') + 2], tag: x[x.findIndex((s) => /^\$[\d,]+$/.test(s)) + 1] || '' })));
    if (rows.length) { await sleep(2500); globalThis.SEP = await p.evaluate(() => (document.body.innerText.match(/分開購買[^\n]{0,20}/g) || []).slice(0, 3)); }
  }
  await p.close();
}
await b.close();
rows.sort((x, y) => x.p - y.p);
console.log(`${F}>${T} ${OUT}${BACK ? ' / ' + BACK : ''}:`, rows.slice(0, 3).map((r) => r.p + ' ' + r.air + ' [' + r.tag + ']').join(' | ') || 'no rows', '分開購買:', JSON.stringify(globalThis.SEP || []));
