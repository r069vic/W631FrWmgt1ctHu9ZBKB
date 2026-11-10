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
// 頁面內嵌的完整清單(235 筆):{"n":1,"origin":"KHH","dest":"HKG","trip_type":"oneway","out_date":..,"in_date":..,"price_twd":..,"airlines":[..],"transfers":0,...}
const rows = [];
for (const m of text.matchAll(/\{"n":\d+,"origin":"[^{}]*\}/g)) { try { rows.push(JSON.parse(m[0])); } catch {} }
if (!rows.length) { console.error('找不到清單資料(頁面格式可能改了)'); process.exit(2); }
const updated = (html.match(/dateModified\\?":\\?"([^"\\]+)/) || [])[1] || '';
const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const items = rows.map((r) => ({
  n: r.n, from: r.origin, to: r.dest, name: `${r.origin}→${r.dest_name || r.dest}`, toName: r.dest_name, cc: r.dest_cc,
  type: r.trip_type === 'roundtrip' ? 'rt' : 'ow', dep: r.out_date, ret: r.in_date || null, price: r.price_twd, disc: r.discount_pct, tag: r.tag,
  airline: (r.airlines || []).join('+'), transfers: r.transfers ?? 0, retTransfers: r.return_transfers ?? 0,
}));
console.log('items', items.length, 'updated', updated, 'sample', JSON.stringify(items[2]));

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
const NAME = (i) => `${i.from}→${i.toName || i.to}(${i.to})`;
const line = (i) => `- ${NAME(i)} ${i.type === 'rt' ? i.dep + '~' + i.ret.slice(5) + ' 來回' : i.dep + ' 單程'} ${i.airline} **NT$${i.price.toLocaleString()}**` + (i.ours ? `(我們 ${i.ours.toLocaleString()})` : '') + (i.transfers || i.retTransfers ? ' 轉機' : ' 直飛') + (i.disc ? ` ↓${i.disc}%` : '');
const g = (c) => items.filter((i) => i.cmp === c);
const cnt = Object.fromEntries(['cheaper', 'ok', 'no-date', 'no-series', 'other-origin'].map((c) => [c, g(c).length]));
let md = `## VibelySpot 互補(${day},站方更新 ${updated})\n共 ${items.length} 筆:比我們便宜 ${cnt.cheaper}、價格相近 ${cnt.ok}、我們該日沒資料 ${cnt['no-date']}、我們沒掃的航線 ${cnt['no-series']}、非桃園出發 ${cnt['other-origin']}\n`;
const sec = (t, a, max = 25) => { if (a.length) md += `\n### ${t}(${a.length})\n` + a.slice(0, max).map(line).join('\n') + (a.length > max ? `\n- …另 ${a.length - max} 筆` : '') + '\n'; };
sec('比我們便宜', g('cheaper').sort((a, b) => a.price - b.price));
sec('我們該日沒資料(桃園出發、有掃這條航線)', g('no-date').sort((a, b) => a.price - b.price));
sec('我們沒掃的航線(桃園出發)', g('no-series').sort((a, b) => a.price - b.price));
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
