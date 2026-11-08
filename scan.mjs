// Outstation price scan: X>TPE (Sunday) ... TPE>X (nearest Wednesday) on full-service carriers.
// Keys: 'X' = X<>TPE, 'X@TSA' = X<>Songshan, 'X>Y' = multi-city X>TPE ... TPE>Y.
// node scan.mjs --mode broad|fine --airports HKG,NRT --shard 0 --shards 5 --out results/shard-0.json
// node scan.mjs --mode multi --batch 3 --batches 23 ...   every X>Y pair, split into 23 hourly batches
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ALL = 'HND,NRT,NGO,KIX,FUK,CTS,TAK,KMJ,OKA,OKJ,HKG,BKK,DMK,KUL,SIN,SGN,HAN,DAD,ICN,GMP,PUS,BWN'.split(',');
const FULL = ['BR', 'CI', 'JX', 'JL', 'NH', 'KE', 'OZ', 'CX', 'BI']; // EVA, China Airlines, STARLUX, JAL, ANA, Korean Air, Asiana, Cathay, Royal Brunei
// per-entry config: key 'X' = X<>TPE, 'X@TSA' = X<>TSA (Songshan). Carrier overrides per key.
const AIRLINES = {};
const EXTRA = ['HND@TSA', 'GMP@TSA'];
const MODE = arg('mode', 'broad');
// same-city pairs make no sense as multi-city
const SAME_CITY = new Set(['HND>NRT', 'NRT>HND', 'ICN>GMP', 'GMP>ICN', 'BKK>DMK', 'DMK>BKK']);
const PAIRS = ALL.flatMap((x) => ALL.filter((y) => y !== x).map((y) => x + '>' + y)).filter((k) => !SAME_CITY.has(k));
const BATCH = +arg('batch', 0), BATCHES = +arg('batches', 1);
const AIRPORTS = MODE === 'multi' && arg('pairs', '') ? arg('pairs', '').split(',') : MODE === 'multi' ? PAIRS.filter((_, i) => i % BATCHES === BATCH) : (arg('airports', '') || [...ALL, ...EXTRA].join(',')).split(',').filter(Boolean);
const SHARD = +arg('shard', 0), SHARDS = +arg('shards', 1);
const OUT = arg('out', `results/shard-${SHARD}.json`);
const LENGTHS = [95, 185];
// --stops N adds the per-leg max-stops field (5) to the Google query; unset = no filter
const STOPS = arg('stops', '') === '' ? null : +arg('stops', '');
const HORIZON_DAYS = 328; // Google Flights shows about 11 months ahead

const DAY = 864e5, iso = (t) => new Date(t).toISOString().slice(0, 10), dow = (t) => new Date(t).getUTCDay();
const todayMs = Date.parse(iso(Date.now()));
const horizon = todayMs + HORIZON_DAYS * DAY;
const nearestWed = (t) => { for (let k = 0; k <= 3; k++) for (const s of [0, 1, -1]) { const c = t + s * k * DAY; if (dow(c) === 3) return c; } };
let firstSun = todayMs + DAY; while (dow(firstSun) !== 0) firstSun += DAY;

const outs = [];
if (MODE === 'fine') { for (let o = firstSun; o <= horizon; o += 7 * DAY) outs.push(o); }
else {
  outs.push(firstSun);
  const d0 = new Date(todayMs);
  for (let m = 0; m < 12; m++) {
    let o = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + m, 1); while (dow(o) !== 0) o += DAY;
    if (o > todayMs && o !== firstSun && o <= horizon) outs.push(o);
  }
}
const jobs = [];
for (const a of AIRPORTS) for (const o of outs) for (const L of LENGTHS) {
  const back = nearestWed(o + L * DAY); if (back > horizon) continue;
  jobs.push({ a, out: iso(o), back: iso(back), len: Math.round((back - o) / DAY) });
}
const mine = jobs.filter((_, i) => i % SHARDS === SHARD);
console.log(`mode=${MODE} airports=${AIRPORTS.length} jobs=${jobs.length} shard ${SHARD}/${SHARDS}: ${mine.length}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const varint = (n) => { const o = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return Buffer.from(o); };
const field = (no, wire, payload) => Buffer.concat([varint(no * 8 + wire), payload]);
const str = (no, s) => { const b = Buffer.from(s); return field(no, 2, Buffer.concat([varint(b.length), b])); };
const msg = (no, b) => field(no, 2, Buffer.concat([varint(b.length), b]));
const num = (no, n) => field(no, 0, varint(n));
const apb = (c) => Buffer.concat([num(1, 1), str(2, c)]);
// trip type (field 19): 1 = round trip, 3 = multi-city
const tfs = (key, out, back) => {
  const [XY, hub = 'TPE'] = key.split('@'); const [X, Y = X] = XY.split('>'); const AIR = AIRLINES[key] || FULL;
  const leg = (f, t, d) => msg(3, Buffer.concat([str(2, d), ...(STOPS === null ? [] : [num(5, STOPS)]), ...AIR.map((a) => str(6, a)), msg(13, apb(f)), msg(14, apb(t))]));
  return Buffer.concat([leg(X, hub, out), leg(hub, Y, back), num(8, 1), num(9, 1), num(19, X === Y ? 1 : 3)]).toString('base64url');
};
const launch = () => puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--lang=zh-TW', '--no-sandbox', '--disable-dev-shm-usage'] });

// Reads the result rows on the page (outbound list, or the return list after an outbound flight is clicked).
const parse = () => {
    const t = document.body.innerText; if (/系統發生錯誤/.test(t)) return { err: true };
    const none = !/正在載入結果/.test(t) && /找不到|沒有符合|沒有.{0,6}航班/.test(t);
    const rows = [...document.querySelectorAll('li')].map((l) => l.innerText.split('\n').map((s) => s.trim()).filter(Boolean)).filter((x) => x.some((s) => /^\$[\d,]+$/.test(s)) && x.includes('–')).map((x) => {
      const i = x.indexOf('–');
      // "下午6:15" / "凌晨1:30+1" -> "18:15" / "01:30+1"
      const h24 = (t) => { const m = (t || '').match(/^(\D*)(\d+):(\d+)(\+\d)?/); if (!m) return ''; let h = +m[2]; if (/下午|晚上|傍晚/.test(m[1]) && h < 12) h += 12; if (/凌晨|清晨|上午|早上/.test(m[1]) && h === 12) h = 0; return String(h).padStart(2, '0') + ':' + m[3] + (m[4] || ''); };
      return { p: +x.find((s) => /^\$[\d,]+$/.test(s)).replace(/\D/g, ''), air: x[i + 2] || '', dep: h24(x[i - 1]), arr: h24(x[i + 1]), dur: x.find((s) => /小時|分鐘/.test(s)) || '', stop: x.find((s) => /^直達$|轉機/.test(s)) || '', route: x.find((s) => /^[A-Z]{3}–[A-Z]{3}$/.test(s)) || '' };
    });
    const m = t.match(/最低價格\s*\n?\s*\$([\d,]+)/); return { rows, none, min: m ? +m[1].replace(/,/g, '') : null };
};
// Fine mode: click the cheapest outbound flight and read the cheapest return flight (Google only lists return times after that).
const returnLeg = async (p, from) => {
  try {
    let best = null, bp = Infinity;
    for (const h of await p.$$('li')) { const t = await h.evaluate((l) => l.innerText); const m = t.match(/\$([\d,]+)/); if (m && t.includes('–')) { const v = +m[1].replace(/,/g, ''); if (v < bp) { bp = v; best = h; } } }
    if (!best) return null;
    await best.evaluate((l) => l.scrollIntoView({ block: 'center' })); await sleep(300); await best.click();
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      const r = await p.evaluate(parse);
      const rs = (r.rows || []).filter((x) => x.route.startsWith(from + '–'));
      if (rs.length) { const c = rs.reduce((m, x) => (x.p < m.p ? x : m)); return { dep: c.dep, arr: c.arr, dur: c.dur, stop: c.stop, air: c.air }; }
    }
  } catch {}
  return null;
};
// stats.errs / stats.tries = share of page loads that hit Google's error page (rises when Google starts blocking)
let b = await launch(); const results = []; let n = 0; const stats = { tries: 0, errs: 0 };
for (const j of mine) {
  if (n > 0 && n % 20 === 0) { await b.close().catch(() => {}); b = await launch(); }
  let res = null;
  for (let at = 1; at <= 4 && !res; at++) {
    const p = await b.newPage();
    try {
      await p.setExtraHTTPHeaders({ 'Accept-Language': 'zh-TW' }); await p.setViewport({ width: 1100, height: 1500 });
      await p.goto(`https://www.google.com/travel/flights?tfs=${tfs(j.a, j.out, j.back)}&hl=zh-TW&gl=TW&curr=TWD`, { waitUntil: 'networkidle2', timeout: 60000 });
      stats.tries++;
      const multi = j.a.includes('>');
      for (let i = 0; i < (multi ? 50 : 12) && !res; i++) {
        await sleep(1000);
        let r = await p.evaluate(parse);
        if (r.err) { stats.errs++; break; }
        if (r.none && i > 3) { res = { none: true }; break; } // no flights for this query: no retry
        if (multi && r.rows.length && !r.min) { await sleep(2500); r = await p.evaluate(parse); } // multi-city pages have no "最低價格" header
        if ((r.min || multi) && r.rows.length) { const all = r.rows.sort((x, y) => x.p - y.p); res = { p: r.min ? Math.min(r.min, all[0].p) : all[0].p, air: all[0].air, rows: all.slice(0, 25) }; }
      }
      if (res && !res.none && MODE === 'fine') res.ret = await returnLeg(p, 'TPE');
    } catch {} finally { await p.close().catch(() => {}); }
    if (!res) await sleep(2000 * at);
  }
  const ok = res && !res.none;
  results.push({ ...j, p: ok ? res.p : null, air: ok ? res.air : '', rows: ok ? res.rows : [], ret: ok && res.ret || null, ts: new Date().toISOString() });
  n++; if (n % 10 === 0) console.log(`${n}/${mine.length}`);
}
await b.close();
mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify({ mode: MODE, results, stats }));
console.log(`done ${results.filter((r) => r.p).length}/${results.length} with price, google errors ${stats.errs}/${stats.tries}`);
