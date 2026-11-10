const html = await (await fetch('https://www.vibelyspot.com/daily-flights', { headers: { 'user-agent': 'Mozilla/5.0' } })).text();
let text = ''; for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) { try { text += JSON.parse('"' + m[1] + '"'); } catch {} }
console.log('text', text.length, 'html', html.length);
for (const k of ['"price"', '"airlineName', '"stops"', 'KHH', '4326', '6785']) console.log(k, (text.split(k).length - 1));
const i = text.indexOf('6785'); console.log(JSON.stringify(text.slice(Math.max(0, i - 700), i + 500)));
const j = text.indexOf('"initialItems"') ; console.log('initialItems', j);
const keys = [...new Set([...text.matchAll(/"([a-zA-Z]{4,24})":/g)].map((m) => m[1]))].slice(0, 120); console.log(keys.join(' '));
