const t = await (await fetch('https://www.vibelyspot.com/daily-flights', { headers: { 'user-agent': 'Mozilla/5.0' } })).text();
console.log('len', t.length, 'next_f pushes', (t.match(/self\.__next_f\.push/g) || []).length);
for (const key of ['1967', '"KHH"', 'HKG']) {
  const i = t.indexOf(key); console.log('\n== ' + key + ' @' + i); if (i >= 0) console.log(JSON.stringify(t.slice(Math.max(0, i - 500), i + 700)));
}
const m = [...t.matchAll(/"(?:price|fare|amount)[A-Za-z]*":\d+/g)].slice(0, 5).map((x) => x[0]); console.log('price keys', m);
