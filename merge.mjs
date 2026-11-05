// Merge shard results into data/, flag drops of 20% or more vs the median of earlier observations of the same (airport, out, back).
// node merge.mjs art/   -> data/history.jsonl, data/latest.json, data/alerts.json; prints drop airports (broad mode only) to $GITHUB_OUTPUT
import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2] || 'art';
const THRESH = 0.8, MIN_OBS = 3, WINDOW_DAYS = 30;
mkdirSync('data', { recursive: true });
const files = []; const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(join(d, f.name)) : f.name.endsWith('.json') && files.push(join(d, f.name)); }; walk(dir);
let mode = 'broad'; const recs = [];
for (const f of files) { const j = JSON.parse(readFileSync(f, 'utf8')); mode = j.mode || mode; recs.push(...j.results); }
const hist = existsSync('data/history.jsonl') ? readFileSync('data/history.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const key = (r) => `${r.a}|${r.out}|${r.back}`;
const byKey = {}; for (const h of hist) (byKey[key(h)] ??= []).push(h);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const cutoff = Date.now() - WINDOW_DAYS * 864e5;
const drops = []; const latest = {};
for (const r of recs) {
  if (r.p == null) continue;
  const prev = (byKey[key(r)] || []).filter((h) => h.p != null && Date.parse(h.ts) >= cutoff).map((h) => h.p);
  const base = prev.length >= MIN_OBS ? median(prev) : null;
  const rec = { ...r, base, pct: base ? Math.round((r.p / base - 1) * 100) : null };
  latest[key(r)] = rec;
  if (base && r.p <= base * THRESH) drops.push(rec);
}
appendFileSync('data/history.jsonl', recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
writeFileSync('data/latest.json', JSON.stringify({ updated: new Date().toISOString(), mode, rows: Object.values(latest) }, null, 1));
if (drops.length) {
  const old = existsSync('data/alerts.json') ? JSON.parse(readFileSync('data/alerts.json', 'utf8')) : [];
  writeFileSync('data/alerts.json', JSON.stringify([...old, ...drops.map((d) => ({ at: d.ts, mode, a: d.a, out: d.out, back: d.back, len: d.len, p: d.p, base: d.base, pct: d.pct, air: d.air }))].slice(-500), null, 1));
}
console.log(`mode=${mode} records=${recs.length} withPrice=${recs.filter((r) => r.p).length} drops=${drops.length}`);
for (const d of drops) console.log(`DROP ${d.a} ${d.out}->${d.back} (${d.len}d) ${d.p} vs base ${d.base} (${d.pct}%) ${d.air}`);
const airports = mode === 'broad' ? [...new Set(drops.map((d) => d.a))] : [];
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `drop_airports=${airports.join(',')}\n`);
