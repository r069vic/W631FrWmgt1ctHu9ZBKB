// Cloud test: one Google Flights query (HKG 2027-01-03 -> 2027-03-31, BR/CI/JX), to compare with the local result (7,756 China Airlines).
import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const varint = (n) => { const o = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return Buffer.from(o); };
const field = (no, wire, payload) => Buffer.concat([varint(no * 8 + wire), payload]);
const str = (no, s) => { const b = Buffer.from(s); return field(no, 2, Buffer.concat([varint(b.length), b])); };
const msg = (no, b) => field(no, 2, Buffer.concat([varint(b.length), b]));
const num = (no, n) => field(no, 0, varint(n));
const apb = (c) => Buffer.concat([num(1, 1), str(2, c)]);
const AIR = ['BR', 'CI', 'JX'];
const tfs = (X, out, back) => { const leg = (f, t, d) => msg(3, Buffer.concat([str(2, d), ...AIR.map((a) => str(6, a)), msg(13, apb(f)), msg(14, apb(t))])); return Buffer.concat([leg(X, 'TPE', out), leg('TPE', X, back), num(8, 1), num(9, 1), num(19, 1)]).toString('base64url'); };
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--lang=zh-TW', '--no-sandbox', '--disable-dev-shm-usage'] });
for (let at = 1; at <= 4; at++) {
  const p = await b.newPage();
  try {
    await p.setExtraHTTPHeaders({ 'Accept-Language': 'zh-TW' }); await p.setViewport({ width: 1100, height: 1500 });
    await p.goto(`https://www.google.com/travel/flights?tfs=${tfs('HKG', '2027-01-03', '2027-03-31')}&hl=zh-TW&gl=TW&curr=TWD`, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(6000);
    const t = await p.evaluate(() => document.body.innerText);
    console.log(`attempt ${at}: url=${p.url().slice(0, 80)} len=${t.length}`);
    console.log('error page:', /系統發生錯誤/.test(t), '| consent page:', /Before you continue|開始使用前|同意/.test(t));
    console.log('min price:', (t.match(/最低價格\s*\n?\s*\$([\d,]+)/) || [])[1] || 'none');
    console.log('prices seen:', [...t.matchAll(/\$[\d,]{4,}/g)].slice(0, 8).map((x) => x[0]).join(' '));
    console.log('airlines seen:', ['中華航空', '長榮航空', '星宇航空'].filter((a) => t.includes(a)).join(' '));
    if (/最低價格/.test(t)) { await p.close(); break; }
    console.log(t.slice(0, 400));
  } catch (e) { console.log('attempt', at, 'error', e.message); } finally { await p.close().catch(() => {}); }
  await sleep(3000);
}
await b.close();
