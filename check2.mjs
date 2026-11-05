// One-off check: is a result one ticket or "分段購票" (separate tickets)?
// Opens the search, clicks the cheapest first-leg flight, then reads the second-leg list with each row's label.
// node check2.mjs FROM TO OUT BACK [Y]   (Y given = multi-city FROM>TO on OUT, TO>Y on BACK; else round trip)
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const varint = (n) => { const o = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return Buffer.from(o); };
const field = (no, wire, payload) => Buffer.concat([varint(no * 8 + wire), payload]);
const str = (no, s) => { const b = Buffer.from(s); return field(no, 2, Buffer.concat([varint(b.length), b])); };
const msg = (no, b) => field(no, 2, Buffer.concat([varint(b.length), b]));
const num = (no, n) => field(no, 0, varint(n));
const apb = (c) => Buffer.concat([num(1, 1), str(2, c)]);
const AIR = ['BR', 'CI', 'JX', 'JL', 'NH', 'KE', 'OZ'];
const FSC_NAMES = ['長榮航空', '中華航空', '星宇航空', '日本航空', '全日空航空', '大韓航空', '韓亞航空'];
const [F, T, OUT, BACK, Y] = process.argv.slice(2);
const leg = (f, t, d) => msg(3, Buffer.concat([str(2, d), ...AIR.map((a) => str(6, a)), msg(13, apb(f)), msg(14, apb(t))]));
const tfs = Buffer.concat([leg(F, T, OUT), leg(T, Y || F, BACK), num(8, 1), num(9, 1), num(19, Y ? 3 : 1)]).toString('base64url');
const read = (p) => p.evaluate(() => [...document.querySelectorAll('li')].map((l) => l.innerText.split('\n').map((s) => s.trim()).filter(Boolean)).filter((x) => x.some((s) => /^\$[\d,]+$/.test(s)) && x.includes('–'))
  .map((x) => ({ p: +x.find((s) => /^\$[\d,]+$/.test(s)).replace(/\D/g, ''), info: x.slice(x.indexOf('–') + 2, x.indexOf('–') + 3).join(''), route: x.find((s) => /^[A-Z]{3}–[A-Z]{3}$/.test(s)) || '', sep: x.some((s) => /分段購票|分開購買/.test(s)) })));
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--lang=zh-TW', '--no-sandbox', '--disable-dev-shm-usage'] });
const label = `${F}>${T} ${OUT} / ${T}>${Y || F} ${BACK}`;
let done = false;
for (let at = 0; at < 3 && !done; at++) {
  const p = await b.newPage();
  try {
    await p.setExtraHTTPHeaders({ 'Accept-Language': 'zh-TW' }); await p.setViewport({ width: 1100, height: 1600 });
    await p.goto(`https://www.google.com/travel/flights?tfs=${tfs}&hl=zh-TW&gl=TW&curr=TWD`, { waitUntil: 'networkidle2', timeout: 60000 });
    let first = [];
    for (let i = 0; i < 60 && !first.length; i++) { await sleep(1000); first = await read(p); }
    if (!first.length) continue;
    await sleep(2000); first = await read(p);
    const cheapest = first.reduce((m, x) => (x.p < m.p ? x : m));
    console.log(label, '| first list cheapest', cheapest.p, cheapest.info, cheapest.sep ? '[分段購票]' : '');
    // click the cheapest first-leg row
    let best = null, bp = Infinity;
    for (const h of await p.$$('li')) { const t = await h.evaluate((l) => l.innerText); const m = t.match(/\$([\d,]+)/); if (m && t.includes('–')) { const v = +m[1].replace(/,/g, ''); if (v < bp) { bp = v; best = h; } } }
    await best.evaluate((l) => l.scrollIntoView({ block: 'center' })); await sleep(300); await best.click();
    const r2 = (Y || F); let second = [];
    for (let i = 0; i < 30; i++) { await sleep(1000); second = (await read(p)).filter((x) => x.route.startsWith(T + '–')); if (second.length) break; }
    await sleep(2500); second = (await read(p)).filter((x) => x.route.startsWith(T + '–'));
    const fsc = (x) => FSC_NAMES.some((n) => x.info.includes(n));
    const one = second.filter((x) => !x.sep && fsc(x)).sort((a, c) => a.p - c.p), sep = second.filter((x) => x.sep).sort((a, c) => a.p - c.p);
    console.log(label, '| second leg rows', second.length, '| one ticket (full-service):', one.slice(0, 3).map((x) => x.p + ' ' + x.info).join(', ') || 'none', '| separate tickets:', sep.slice(0, 3).map((x) => x.p + ' ' + x.info).join(', ') || 'none');
    // click the cheapest second-leg row and read the booking options ("預訂選項"): one ticket or 分段購票
    if (one.length || second.length) {
      const target = (one[0] || second[0]).p;
      let h2 = null;
      for (const h of await p.$$('li')) { const t = await h.evaluate((l) => l.innerText); if (t.includes(T + '–') && t.includes('$' + target.toLocaleString('en-US'))) { h2 = h; break; } }
      if (h2) {
        await h2.evaluate((l) => l.scrollIntoView({ block: 'center' })); await sleep(300); await h2.click();
        let txt = '';
        for (let i = 0; i < 30; i++) { await sleep(1000); txt = await p.evaluate(() => document.body.innerText); if (/預訂選項/.test(txt) && /\$[\d,]+/.test(txt.split('預訂選項')[1] || '')) break; }
        await sleep(2000); txt = await p.evaluate(() => document.body.innerText);
        const after = txt.split('預訂選項').slice(1).join(' '), opt = after.split('\n').map((x) => x.trim()).filter((x) => /透過|分段購票|^\$[\d,]+$|找不到/.test(x)).slice(0, 12).join(' / ');
        console.log(label, '| booking options:', opt.slice(0, 300));
      } else console.log(label, '| booking: row not found');
    }
    done = true;
  } catch (e) { console.log(label, 'error', String(e).slice(0, 80)); } finally { await p.close().catch(() => {}); }
}
if (!done) console.log(label, '| no results');
await b.close();
