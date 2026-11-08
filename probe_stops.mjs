// Probe: click Google Flights' "nonstop only" filter and record how the URL / results change.
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
const URLS = {
  nrt_bwn: 'https://www.google.com/travel/flights?tfs=GkISCjIwMjYtMTItMDYyAkJSMgJDSTICSlgyAkpMMgJOSDICS0UyAk9aMgJDWDICQklqBwgBEgNOUlRyBwgBEgNUUEUaQhIKMjAyNy0wNi0wOTICQlIyAkNJMgJKWDICSkwyAk5IMgJLRTICT1oyAkNYMgJCSWoHCAESA1RQRXIHCAESA0JXTkABSAGYAQM&hl=zh-TW&gl=TW&curr=TWD',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: 'new', args: ['--lang=zh-TW', '--no-sandbox', '--disable-dev-shm-usage'] });
const out = {};
for (const [k, u] of Object.entries(URLS)) {
  const p = await b.newPage(); await p.setExtraHTTPHeaders({ 'Accept-Language': 'zh-TW' }); await p.setViewport({ width: 1100, height: 1500 });
  const reqs = [];
  p.on('request', (r) => { const x = r.url(); if (/GetShoppingResults|GetCalendar|batchexecute|travel\/flights/.test(x)) reqs.push(x.slice(0, 600) + ' ' + (r.postData() || '').slice(0, 1500)); });
  await p.goto(u, { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(8000);
  const rowsOf = () => p.evaluate(() => [...document.querySelectorAll('li')].map((l) => l.innerText.split('\n').map((s) => s.trim()).filter(Boolean)).filter((x) => x.some((s) => /^\$[\d,]+$/.test(s)) && x.includes('–')).slice(0, 5).map((x) => x.join(' | ')));
  const before = { url: p.url(), rows: await rowsOf() };
  const btns = await p.evaluate(() => [...document.querySelectorAll('button')].map((x) => (x.innerText || x.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 60));
  // open the stops filter
  const opened = await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /轉機|停靠|Stops/.test(x.innerText + (x.getAttribute('aria-label') || ''))); if (b) { b.click(); return (b.innerText || b.getAttribute('aria-label')); } return null; });
  await sleep(2000);
  const options = await p.evaluate(() => [...document.querySelectorAll('[role=radio],[role=menuitemradio],li[role=option],label')].map((x) => (x.innerText || x.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 20));
  const picked = await p.evaluate(() => { const o = [...document.querySelectorAll('[role=radio],[role=menuitemradio],li[role=option],label')].find((x) => /直達|Nonstop/.test((x.innerText || '') + (x.getAttribute('aria-label') || ''))); if (o) { o.click(); return (o.innerText || o.getAttribute('aria-label')); } return null; });
  await sleep(8000);
  const after = { url: p.url(), rows: await rowsOf() };
  out[k] = { before, btns, opened, options, picked, after, reqs: reqs.slice(-6) };
  await p.close();
}
await b.close();
mkdirSync('test-out', { recursive: true }); writeFileSync('test-out/probe-stops.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1).slice(0, 6000));
