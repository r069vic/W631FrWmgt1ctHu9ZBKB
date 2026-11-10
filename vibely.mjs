// VibelySpot 每日便宜票 → 補充我們自己的日曆掃描。
// 讀 https://www.vibelyspot.com/daily-flights 頁面內嵌的 schema.org JSON-LD(該站 robots.txt 允許 /daily-flights),
// 轉成 {from,to,type,dep,ret,price,airline},再和 data/cal 的最新掃描比對。
// node vibely.mjs  -> data/vibely/<台北日期>.json、$GITHUB_STEP_SUMMARY、out/vibely.json
import { readFileSync, writeFileSync, readdirSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const URL = 'https://www.vibelyspot.com/daily-flights';
const html = await (await fetch(URL, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; travel-monitor personal use)' } })).text();
// Next.js 把頁面資料放在 self.__next_f.push([1,"..."]) 的字串裡
let text = '';
for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) { try { text += JSON.parse('"' + m[1] + '"'); } catch {} }
const at = text.indexOf('{"@type":"ItemList"');
if (at < 0) { console.error('找不到 ItemList(頁面格式可能改了)'); process.exit(2); }
let depth = 0, inStr = false, esc = false, end = -1;
for (let i = at; i < text.length; i++) {
  const c = text[i];
  if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
  if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) { end = i + 1; break; }
}
const list = JSON.parse(text.slice(at, end));
const updated = (html.match(/dateModified\\?":\\?"([^"\\]+)/) || [])[1] || '';
const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

const items = [];
for (const el of list.itemListElement || []) {
  const o = el.item || {}, io = o.itemOffered || {};
  const flights = io.subTrip || [io];
  const f0 = flights[0], fl = flights[flights.length - 1];
  const from = f0?.departureAirport?.iataCode, to = (flights.length > 1 ? f0 : f0)?.arrivalAirport?.iataCode;
  const rt = /來回/.test(o.name || '') || flights.length > 1;
  items.push({
    n: el.position, name: o.name, from, to, type: rt ? 'rt' : 'ow', dep: f0?.departureTime?.slice(0, 10), ret: rt ? fl?.departureTime?.slice(0, 10) : null,
    price: o.price, airline: (f0?.provider || []).map((p) => p.name).join('+'), url: o.url,
    stops: flights.map((f) => f?.numberOfStops ?? null),
  });
}
console.log('items', items.length, 'declared', list.numberOfItems, 'updated', updated);
console.log('sample', JSON.stringify(items.slice(0, 3)));

// 我們自己的掃描(最近兩天的歷史檔,後者優先)
const files = readdirSync('data/cal').filter((f) => /^\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f)).sort().slice(-2);
const ours = {};
for (const f of files) { const j = JSON.parse(gunzipSync(readFileSync('data/cal/' + f)).toString()); for (const [k, m] of Object.entries(j)) ours[k] = { ...(ours[k] || {}), ...m }; }
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const KINDS = { ow: ['ow1', 'low1'], rt: ['rt', 'lrt'] };
for (const it of items) {
  if (it.from !== 'TPE') { it.cmp = 'other-origin'; continue; }
  const len = it.type === 'rt' ? dayDiff(it.dep, it.ret) : 0;
  const keys = KINDS[it.type].map((k) => `${k}|${it.to}|${len}`);
  const series = keys.filter((k) => ours[k]);
  if (!series.length) { it.cmp = 'no-series'; continue; }
  const vals = series.map((k) => ours[k][it.dep]).filter((v) => v != null);
  if (!vals.length) { it.cmp = 'no-date'; continue; }
  it.ours = Math.min(...vals);
  it.cmp = it.price < it.ours * 0.95 ? 'cheaper' : 'ok';
}
mkdirSync('data/vibely', { recursive: true }); mkdirSync('out', { recursive: true });
writeFileSync(`data/vibely/${day}.json`, JSON.stringify({ day, updated, n: items.length, items }));
writeFileSync('out/vibely.json', JSON.stringify({ day, updated, items }));

// 摘要
const NAME = (i) => i.name?.replace(/(單程|來回)?機票$/, '') || `${i.from}→${i.to}`;
const line = (i) => `- ${NAME(i)} ${i.type === 'rt' ? i.dep + '~' + i.ret.slice(5) + ' 來回' : i.dep + ' 單程'} ${i.airline} **NT$${i.price.toLocaleString()}**` + (i.ours ? `(我們 ${i.ours.toLocaleString()})` : '') + (i.stops.some((s) => s > 0) ? ' 轉機' : '');
const g = (c) => items.filter((i) => i.cmp === c);
const cnt = Object.fromEntries(['cheaper', 'ok', 'no-date', 'no-series', 'other-origin'].map((c) => [c, g(c).length]));
let md = `## VibelySpot 互補(${day},站方更新 ${updated})\n共 ${items.length} 筆:比我們便宜 ${cnt.cheaper}、價格相近 ${cnt.ok}、我們該日沒資料 ${cnt['no-date']}、我們沒掃的航線 ${cnt['no-series']}、非桃園出發 ${cnt['other-origin']}\n`;
const sec = (t, a, max = 25) => { if (a.length) md += `\n### ${t}(${a.length})\n` + a.slice(0, max).map(line).join('\n') + (a.length > max ? `\n- …另 ${a.length - max} 筆` : '') + '\n'; };
sec('比我們便宜', g('cheaper').sort((a, b) => a.price - b.price));
sec('我們該日沒資料(桃園出發、有掃這條航線)', g('no-date').sort((a, b) => a.price - b.price));
sec('我們沒掃的航線(桃園出發)', g('no-series').sort((a, b) => a.price - b.price));
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
