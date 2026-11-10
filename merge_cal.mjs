// Merge calendar shards, attach a baseline to every (route, length, departure day), write the day's history and the upload payloads.
// node merge_cal.mjs art/   -> data/cal/<day>.json.gz (history), out/cal-<kind>.json (one upload per kind)
// Baseline = median of the same (kind, route, length, departure day) over the previous 30 days, needing 3 or more observations.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

const dir = process.argv[2] || 'art';
const MIN_OBS = 3, WINDOW_DAYS = 30, KEEP_DAYS = 40;
const DAY = 864e5, iso = (t) => new Date(t).toISOString().slice(0, 10);
const today = iso(Date.now() + 8 * 3600e3); // Taipei date
const files = []; const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(join(d, f.name)) : f.name.endsWith('.json') && files.push(join(d, f.name)); }; walk(dir);
const recs = [], stats = { tries: 0, errs: 0 };
for (const f of files) { const j = JSON.parse(readFileSync(f, 'utf8')); recs.push(...j.results); if (j.stats) { stats.tries += j.stats.tries; stats.errs += j.stats.errs; } }
const keyOf = (r) => `${r.k}|${r.a}|${r.len}`;

// history: one gzip file per day, {key: {dep: price}}
mkdirSync('data/cal', { recursive: true });
const hist = {}; // key -> dep -> [prices]
for (const f of readdirSync('data/cal').filter((x) => /^\d{4}-\d{2}-\d{2}\.json\.gz$/.test(x)).sort()) {
  const d = f.slice(0, 10), age = (Date.parse(today) - Date.parse(d)) / DAY;
  if (age > KEEP_DAYS) { unlinkSync(join('data/cal', f)); continue; }
  if (d >= today || age > WINDOW_DAYS) continue;
  const day = JSON.parse(gunzipSync(readFileSync(join('data/cal', f))).toString());
  for (const [k, m] of Object.entries(day)) for (const [dep, p] of Object.entries(m)) ((hist[k] ??= {})[dep] ??= []).push(p);
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

// a day can have several runs; today's history file holds what the earlier runs of today saw
const todayFile = join('data/cal', today + '.json.gz');
const prevToday = existsSync(todayFile) ? JSON.parse(gunzipSync(readFileSync(todayFile)).toString()) : {};
const todayHist = {}, byKind = {};
let priced = 0, based = 0, filled = 0;
for (const r of recs) {
  const k = keyOf(r), h = hist[k] || {};
  if (r.prices.length) todayHist[k] = Object.fromEntries(r.prices);
  // upload the union of today's runs, so a partial read in this run does not shrink the page; for a departure day
  // both runs priced, this run wins. Not for 'same' (its entries carry the length per day, which history does not keep).
  let prices = r.prices;
  if (r.k !== 'same' && prevToday[k]) {
    const m = { ...prevToday[k], ...Object.fromEntries(r.prices.map(([d, v]) => [d, v])) };
    if (Object.keys(m).length > r.prices.length) filled++;
    prices = Object.entries(m).sort();
  }
  if (!prices.length) continue;
  priced++;
  // compact upload: first departure day + parallel arrays (price, baseline or 0) for consecutive days, 0 = no price
  const d0 = prices[0][0], last = prices[prices.length - 1][0], n = Math.round((Date.parse(last) - Date.parse(d0)) / DAY) + 1;
  const p = new Array(n).fill(0), b = new Array(n).fill(0), l = new Array(n).fill(0);
  for (const [dep, v, L] of prices) { const i = Math.round((Date.parse(dep) - Date.parse(d0)) / DAY); p[i] = v; if (L) l[i] = L; const o = h[dep]; if (o && o.length >= MIN_OBS) { b[i] = median(o); based++; } }
  (byKind[r.k] ??= []).push({ k: r.k, a: r.a, len: r.len, d0, p, b, ...(r.k === 'same' ? { l } : {}) });
}
// same route read by several runs today: keep the union of departure days (a later partial read must not drop days an
// earlier run of the same day saw; for a day both runs priced, the later price wins)
const merged = { ...prevToday };
for (const [k, m] of Object.entries(todayHist)) merged[k] = { ...(prevToday[k] || {}), ...m };
writeFileSync(todayFile, gzipSync(JSON.stringify(merged)));
mkdirSync('out', { recursive: true });
// defer: the Worker stores the alerts but sends one summary per run after all uploads (cal/notify, see cal.yml)
for (const [kind, routes] of Object.entries(byKind)) writeFileSync(`out/cal-${kind}.json`, JSON.stringify({ kind, day: today, stats, routes, defer: true }));
console.log(`calendar day=${today} series=${recs.length} priced=${priced} (${filled} filled from earlier runs today) days with baseline=${based} google errors ${stats.errs}/${stats.tries}`);
