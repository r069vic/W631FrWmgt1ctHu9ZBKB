// LINE Travel multi-city scan (HTTP only, no browser): X>TPE (Sunday) ... TPE>Y (nearest Wednesday); Songshan instead of Taoyuan for HND and GMP.
// Same jobs and output format as `scan.mjs --mode multi`, so merge.mjs and the Worker ingest work unchanged.
// node scan_line.mjs --batch 3 --batches 24 --shard 0 --shards 4 --out results/shard-0.json
// node scan_line.mjs --test --out test-out/line-test.json      small trial: a few pairs x 3 dates
//
// How a search works (LINE's own web app does the same): POST /content-api/flights/tickets:search starts the search and
// returns status "UpdatesPending"; sending the same request again returns the results collected so far, until the status
// is "UpdatesComplete". We start every search of the batch at once, wait --wait seconds, ask again, and repeat for the
// searches that are still pending, up to --max-waits times. A search that fails (HTTP error) is not retried further.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const TEST = process.argv.includes('--test');
const ALL = 'HND,NRT,NGO,KIX,FUK,CTS,TAK,KMJ,OKA,OKJ,HKG,BKK,DMK,KUL,SIN,SGN,HAN,DAD,ICN,GMP,PUS,BWN'.split(',');
// same-city pairs make no sense as multi-city
const SAME_CITY = new Set(['HND>NRT', 'NRT>HND', 'ICN>GMP', 'GMP>ICN', 'BKK>DMK', 'DMK>BKK']);
const PAIRS = ALL.flatMap((x) => ALL.filter((y) => y !== x).map((y) => x + '>' + y)).filter((k) => !SAME_CITY.has(k));
const BATCH = +arg('batch', 0), BATCHES = +arg('batches', 24);
const SHARD = +arg('shard', 0), SHARDS = +arg('shards', 1);
const OUT = arg('out', `results/shard-${SHARD}.json`);
const LENGTHS = arg('lengths', '95,185').split(',').map(Number);
const HORIZON_DAYS = +arg('horizon', 328);
const WAIT_S = +arg('wait', 60), MAX_WAITS = +arg('max-waits', 5), CONC = +arg('concurrency', 20);
// --airlines ANY = no carrier filter; --stops N = max connections per leg (0 = nonstop only)
const AIRLINES = arg('airlines', 'CI,BR,CX,JL,JX,KE,NH,OZ,BI') === 'ANY' ? [] : arg('airlines', 'CI,BR,CX,JL,JX,KE,NH,OZ,BI').split(',');
const STOPS = +arg('stops', 0);
const TEST_PAIRS = arg('pairs', 'KIX>NRT,NRT>KIX,FUK>HND,HKG>NRT').split(',');
const PER_PAIR = +arg('perpair', 3);

const DAY = 864e5, iso = (t) => new Date(t).toISOString().slice(0, 10), dow = (t) => new Date(t).getUTCDay();
const todayMs = Date.parse(iso(Date.now()));
const horizon = todayMs + HORIZON_DAYS * DAY;
const nearestWed = (t) => { for (let k = 0; k <= 3; k++) for (const s of [0, 1, -1]) { const c = t + s * k * DAY; if (dow(c) === 3) return c; } };
let firstSun = todayMs + DAY; while (dow(firstSun) !== 0) firstSun += DAY;

// Outbound dates: the next Sunday plus the first Sunday of each of the next 12 months (same as scan.mjs broad mode).
const outs = [firstSun];
const d0 = new Date(todayMs);
for (let m = 0; m < 12; m++) {
  let o = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + m, 1); while (dow(o) !== 0) o += DAY;
  if (o > todayMs && o !== firstSun && o <= horizon) outs.push(o);
}
const pairs = TEST ? TEST_PAIRS : PAIRS.filter((_, i) => i % BATCHES === BATCH);
const jobs = [];
for (const a of pairs) {
  const mine = [];
  for (const o of outs) for (const L of LENGTHS) {
    const back = nearestWed(o + L * DAY); if (back > horizon) continue;
    mine.push({ a, out: iso(o), back: iso(back), len: Math.round((back - o) / DAY) });
  }
  // test: a few fixed positions in the list (first date, then dates with the ~185-day stay and a later one)
  if (TEST) for (const i of [0, 3, 7, 1, 5, 9].slice(0, PER_PAIR)) { if (i < mine.length) jobs.push(mine[i]); }
  else jobs.push(...mine);
}
const todo = TEST ? jobs : jobs.filter((_, i) => i % SHARDS === SHARD);
console.log(`line scan ${TEST ? 'TEST' : `batch ${BATCH}/${BATCHES}`} pairs=${pairs.length} jobs=${jobs.length} shard ${SHARD}/${SHARDS}: ${todo.length}; wait ${WAIT_S}s x max ${MAX_WAITS}, concurrency ${CONC}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_ = 'https://travel.line.me/content-api/flights/tickets:search';
const HEADERS = {
  'content-type': 'application/json', origin: 'https://travel.line.me', referer: 'https://travel.line.me/flights/list',
  'accept-language': 'zh-TW', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
};
// Taipei airport of a leg: full-service nonstops to Haneda and Gimpo use Songshan (TSA), everything else Taoyuan (TPE).
// Asking LINE for TPE>HND with the full-service filter returns only a China Airlines TSA flight at a full fare
// (57,950 for HKG>TPE ... TPE>HND on 2026-11-15, against 7,436 when the leg is asked as TSA>HND).
const TSA_ENDS = new Set(['HND', 'GMP']);
const hubOf = (c) => (TSA_ENDS.has(c) ? 'TSA' : 'TPE');
const bodyOf = (j) => {
  const [X, Y] = j.a.split('>');
  return JSON.stringify({
    page: 1, pageSize: 20,
    flightSegments: [{ departDate: j.out, fromAirport: X, toAirport: hubOf(X) }, { departDate: j.back, fromAirport: hubOf(Y), toAirport: Y }],
    airlines: AIRLINES, roundType: 2, cabinClass: 1, numOfAdult: 1, numOfChildren: 0, numOfBaby: 0,
    order: 'asc', orderBy: 'priceAfterDiscount', linePointsRebateOnly: true, maxTransferCount: STOPS,
  });
};
// Network errors and 5xx are tried up to 3 times, 2 s apart. Any other HTTP status is a failure.
async function post(j) {
  const body = bodyOf(j);
  for (let at = 1; at <= 3; at++) {
    try {
      const r = await fetch(URL_, { method: 'POST', headers: HEADERS, body, signal: AbortSignal.timeout(30000) });
      if (r.status >= 500 && at < 3) { await sleep(2000); continue; }
      const txt = await r.text(); let json = null; try { json = JSON.parse(txt); } catch {}
      return { http: r.status, json };
    } catch (e) { if (at === 3) return { http: 0, error: String(e).slice(0, 100) }; await sleep(2000); }
  }
}
const pool = async (items, fn, n) => {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
};

const stats = { tries: todo.length, errs: 0, reqs: 0 };
const state = todo.map((j) => ({ j, done: false, failed: false, polls: 0, doneAtWait: null, last: null, err: null }));
const poll = async (s) => {
  const r = await post(s.j); s.polls++; stats.reqs++;
  if (r.http !== 200 || !r.json || !r.json.data) { s.failed = true; s.err = `http ${r.http}${r.error ? ' ' + r.error : ''}`; return; }
  s.last = r.json.data;
  if (r.json.data.status === 'UpdatesComplete') s.done = true;
};

const t0 = Date.now(); let waits = 0;
await pool(state, poll, CONC); // start every search
for (let w = 1; w <= MAX_WAITS; w++) {
  const pending = state.filter((s) => !s.done && !s.failed);
  if (!pending.length) break;
  console.log(`wait ${w}: ${pending.length} pending, sleeping ${WAIT_S}s`);
  await sleep(WAIT_S * 1000); waits = w;
  await pool(pending, poll, CONC);
  for (const s of pending) if (s.done) s.doneAtWait = w;
}

const hm = (t) => (t || '').slice(11, 16);
const dur = (m) => { m = +m || 0; return `${Math.floor(m / 60)} 小時 ${m % 60} 分鐘`; };
const rowOf = (x) => ({
  p: Math.round(x.priceAfterDiscount ?? x.totalFare), air: (x.marketingAirlines || []).map((a) => a.name).join('、'),
  dep: hm(x.departTime), arr: hm(x.arriveTime), dur: dur((x.segmentDuration || [])[0] ?? x.duration),
  stop: x.numberOfTransfer ? '轉機' : '直達', route: `${x.departAirport?.code}–${x.arriveAirport?.code}`,
  fare: x.totalFare, backDep: hm(x.returnDepartTime),
});
const ts = new Date().toISOString();
const results = state.map((s) => {
  const items = (s.last && s.last.items) || [];
  const rows = s.failed ? [] : items.map(rowOf).filter((r) => Number.isFinite(r.p) && r.p > 0).sort((x, y) => x.p - y.p).slice(0, 25);
  if (s.failed) stats.errs++;
  const line = { done: s.done, failed: s.failed, polls: s.polls, doneAtWait: s.doneAtWait, total: s.last && s.last.paging && s.last.paging.total, err: s.err };
  return { ...s.j, p: rows.length ? rows[0].p : null, air: rows.length ? rows[0].air : '', rows, ret: null, ts, line };
});
const elapsedSec = Math.round((Date.now() - t0) / 1000);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ mode: 'multi', results, stats, meta: { source: 'line', elapsedSec, waits, waitSec: WAIT_S, concurrency: CONC, airlines: AIRLINES, stops: STOPS } }, null, TEST ? 1 : 0));

const priced = results.filter((r) => r.p);
console.log(`done ${priced.length}/${results.length} with price, failed ${stats.errs}, not complete after ${MAX_WAITS} waits ${state.filter((s) => !s.done && !s.failed).length}, requests ${stats.reqs}, ${elapsedSec}s`);
if (TEST) {
  for (const r of results) console.log(`${r.a.padEnd(8)} ${r.out} ${r.back} ${String(r.len).padStart(3)}d  p=${String(r.p).padStart(6)}  ${r.air.padEnd(12)} total=${r.line.total} polls=${r.line.polls} done=${r.line.done}${r.line.doneAtWait ? '@wait' + r.line.doneAtWait : ''}${r.line.err ? ' ERR ' + r.line.err : ''}`);
}
