// Calendar scan: reads Google Flights date-picker prices (every departure day, ~11 months) with the full-service filter.
// Kinds (one job per route and trip length):
//   same  X>TPE ... TPE>X, stay about 94 / 185 days: lengths 91-97 and 182-188 are read and the cheapest per departure day is kept
//         (Google has no cached price for many single long-stay lengths; the union covers about 80% of days)
//   rt    TPE>X ... X>TPE, 5 / 6 / 7 days (one page; the trip length is switched in the calendar)
//   ow1   TPE>X one-way      ow2   X>TPE one-way
// Keys: 'X' (Taoyuan) or 'X@TSA' (Songshan).
// node scan_cal.mjs --kinds same,rt,ow1,ow2 --airports KIX,BKK --shard 0 --shards 5 --out results/cal-0.json
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ALL = 'HND,NRT,NGO,KIX,FUK,CTS,TAK,KMJ,OKA,OKJ,HKG,BKK,DMK,KUL,SIN,SGN,HAN,DAD,ICN,GMP,PUS,HND@TSA,GMP@TSA'.split(',');
const FULL = ['BR', 'CI', 'JX', 'JL', 'NH', 'KE', 'OZ']; // EVA, China Airlines, STARLUX, JAL, ANA, Korean Air, Asiana
const CENTERS = [94, 185], range = (c) => [-3, -2, -1, 0, 1, 2, 3].map((d) => c + d);
const LENS = { same: CENTERS, rt: [5, 6, 7], ow1: [0], ow2: [0] };
const KINDS = arg('kinds', 'same,rt,ow1,ow2').split(',').filter((k) => LENS[k]);
const AIRPORTS = (arg('airports', '') || ALL.join(',')).split(',').filter(Boolean);
const SHARD = +arg('shard', 0), SHARDS = +arg('shards', 1);
const OUT = arg('out', `results/cal-${SHARD}.json`);
const MAX_FLIPS = 12;

const DAY = 864e5, iso = (t) => new Date(t).toISOString().slice(0, 10);
const tomorrow = iso(Date.now() + DAY);
const jobs = [];
for (const k of KINDS) for (const a of AIRPORTS) {
  if (k === 'rt') jobs.push({ k, a, lens: LENS.rt });
  else if (k === 'same') for (const c of CENTERS) jobs.push({ k, a, lens: range(c), center: c });
  else for (const L of LENS[k]) jobs.push({ k, a, lens: [L] });
}
const mine = jobs.filter((_, i) => i % SHARDS === SHARD);
console.log(`calendar kinds=${KINDS.join(',')} airports=${AIRPORTS.length} jobs=${jobs.length} shard ${SHARD}/${SHARDS}: ${mine.length}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const varint = (n) => { const o = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return Buffer.from(o); };
const field = (no, wire, payload) => Buffer.concat([varint(no * 8 + wire), payload]);
const str = (no, s) => { const b = Buffer.from(s); return field(no, 2, Buffer.concat([varint(b.length), b])); };
const msg = (no, b) => field(no, 2, Buffer.concat([varint(b.length), b]));
const num = (no, n) => field(no, 0, varint(n));
const apb = (c) => Buffer.concat([num(1, 1), str(2, c)]);
const leg = (f, t, d) => msg(3, Buffer.concat([str(2, d), ...FULL.map((a) => str(6, a)), msg(13, apb(f)), msg(14, apb(t))]));
// the search that opens the calendar: first departure tomorrow, return after the first trip length
const tfs = (j) => {
  const [X, H = 'TPE'] = j.a.split('@'), L = j.lens[0], back = iso(Date.parse(tomorrow) + L * DAY);
  const legs = j.k === 'same' ? [leg(X, H, tomorrow), leg(H, X, back)] : j.k === 'rt' ? [leg(H, X, tomorrow), leg(X, H, back)] : j.k === 'ow1' ? [leg(H, X, tomorrow)] : [leg(X, H, tomorrow)];
  return Buffer.concat([...legs, num(8, 1), num(9, 1), num(19, L ? 1 : 2)]).toString('base64url');
};
const launch = () => puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--lang=zh-TW', '--no-sandbox', '--disable-dev-shm-usage'] });

// priced day cells currently in the calendar: [[date, price]]; the exact price is in an aria-label ", 20397 新台幣"
const readCells = (p) => p.evaluate(() => [...document.querySelectorAll('[role=gridcell][data-iso]')].map((c) => {
  const l = [...c.querySelectorAll('[aria-label]')].map((x) => x.getAttribute('aria-label')).find((t) => t.includes('新台幣'));
  return l ? [c.getAttribute('data-iso'), +l.replace(/[^0-9]/g, '')] : null;
}).filter(Boolean));
const lenLabel = (p) => p.evaluate(() => [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /日行程/.test(e.textContent) && e.offsetParent)?.textContent || '');
const clickByLabel = (p, re) => p.evaluate((src) => { const r = new RegExp(src); const b = [...document.querySelectorAll('button,[role=button]')].find((e) => r.test(e.getAttribute('aria-label') || '') && e.offsetParent); if (b) { b.click(); return true; } return false; }, re);
// the right arrow next to "N 日行程"
const nextLen = (p) => p.evaluate(() => { const lab = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /日行程/.test(e.textContent) && e.offsetParent); let box = lab; for (let k = 0; k < 4 && box; k++) { box = box.parentElement; const bs = [...box.querySelectorAll('button,[role=button]')]; if (bs.length >= 2) { bs[bs.length - 1].click(); return true; } } return false; });

// Reads every month: flips forward until no new priced day shows up.
async function readAll(p, map) {
  const add = (cells) => { let n = 0; for (const [d, v] of cells) if (d >= tomorrow && v > 0) { if (!(d in map)) n++; map[d] = v; } return n; };
  add(await readCells(p));
  // a month can come back empty (no cached prices); stop after two empty months in a row
  for (let f = 0, empty = 0; f < MAX_FLIPS && empty < 2; f++) {
    if (!(await clickByLabel(p, '^下一頁$'))) break;
    let got = 0; for (let i = 0; i < 10 && !got; i++) { await sleep(700); got = add(await readCells(p)); }
    empty = got ? 0 : empty + 1;
  }
}

const stats = { tries: 0, errs: 0 };
let b = await launch(); const results = []; let n = 0;
for (const j of mine) {
  if (n > 0 && n % 15 === 0) { await b.close().catch(() => {}); b = await launch(); }
  const out = {};
  for (let at = 1; at <= 3 && !Object.keys(out).length; at++) {
    const p = await b.newPage(); stats.tries++;
    try {
      await p.setExtraHTTPHeaders({ 'Accept-Language': 'zh-TW' }); await p.setViewport({ width: 1300, height: 1500 });
      await p.goto(`https://www.google.com/travel/flights?tfs=${tfs(j)}&hl=zh-TW&gl=TW&curr=TWD`, { waitUntil: 'networkidle2', timeout: 60000 });
      if (await p.evaluate(() => /系統發生錯誤/.test(document.body.innerText))) { stats.errs++; throw new Error('google error'); }
      const dep = await p.waitForFunction(() => [...document.querySelectorAll('input')].find((x) => x.getAttribute('aria-label') === '去程' && x.offsetParent), { timeout: 30000 });
      await dep.asElement().click();
      for (let i = 0; i < 15; i++) { await sleep(700); if ((await readCells(p)).length) break; }
      for (let li = 0; li < j.lens.length; li++) {
        const L = j.lens[li];
        if (li > 0) {
          // switch the trip length in place, then go back to the first month and read forward again
          await nextLen(p);
          for (let i = 0; i < 15 && !(await lenLabel(p)).startsWith(L + ' '); i++) await sleep(500);
          if (!(await lenLabel(p)).startsWith(L + ' ')) break;
          for (let f = 0; f < MAX_FLIPS + 2; f++) { if (!(await clickByLabel(p, '^上一頁$'))) break; await sleep(400); }
          await sleep(1500);
        }
        const map = {}; await readAll(p, map);
        if (Object.keys(map).length) out[L] = Object.entries(map).sort();
      }
    } catch {} finally { await p.close().catch(() => {}); }
    if (!Object.keys(out).length) await sleep(2000 * at);
  }
  if (j.center) {
    // cheapest per departure day across the lengths; entries are [date, price, length]
    const m = {};
    for (const L of j.lens) for (const [d, p] of out[L] || []) if (!(d in m) || p < m[d][0]) m[d] = [p, L];
    results.push({ k: j.k, a: j.a, len: j.center, prices: Object.entries(m).sort().map(([d, [p, L]]) => [d, p, L]), ts: new Date().toISOString() });
  } else for (const L of j.lens) results.push({ k: j.k, a: j.a, len: L, prices: out[L] || [], ts: new Date().toISOString() });
  n++; console.log(`${n}/${mine.length} ${j.k} ${j.a} ${j.lens.map((L) => L + ':' + (out[L] ? out[L].length : 0)).join(' ')}`);
  mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify({ mode: 'cal', results, stats })); // keep progress if the job is cut off
}
await b.close();
console.log(`done ${results.filter((r) => r.prices.length).length}/${results.length} with prices, google errors ${stats.errs}/${stats.tries}`);
