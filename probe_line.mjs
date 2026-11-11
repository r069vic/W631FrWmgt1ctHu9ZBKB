// probe: what does LINE return for HKG>TPE (11/15) ... TPE|TSA>HND (2/17)?
const URL_ = 'https://travel.line.me/content-api/flights/tickets:search';
const H = { 'content-type': 'application/json', origin: 'https://travel.line.me', referer: 'https://travel.line.me/flights/list', 'accept-language': 'zh-TW', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };
const FSC = ['CI', 'BR', 'CX', 'JL', 'JX', 'KE', 'NH', 'OZ', 'BI'];
const cases = [
  ['HKG TPE / TPE HND fsc', ['HKG', 'TPE'], ['TPE', 'HND'], FSC],
  ['HKG TPE / TSA HND fsc', ['HKG', 'TPE'], ['TSA', 'HND'], FSC],
  ['HKG TPE / TPE HND any', ['HKG', 'TPE'], ['TPE', 'HND'], []],
  ['HKG TPE / TPE NRT fsc', ['HKG', 'TPE'], ['TPE', 'NRT'], FSC],
  ['KIX TPE / TPE HND fsc', ['KIX', 'TPE'], ['TPE', 'HND'], FSC],
  ['KIX TPE / TSA HND fsc', ['KIX', 'TPE'], ['TSA', 'HND'], FSC],
  ['BKK TPE / TSA HND fsc', ['BKK', 'TPE'], ['TSA', 'HND'], FSC],
  ['HND TSA / TPE ICN fsc', ['HND', 'TSA'], ['TPE', 'ICN'], FSC],
  ['HND TPE / TPE ICN fsc', ['HND', 'TPE'], ['TPE', 'ICN'], FSC],
];
const body = (c) => JSON.stringify({ page: 1, pageSize: 20, flightSegments: [{ departDate: '2026-11-15', fromAirport: c[1][0], toAirport: c[1][1] }, { departDate: '2027-02-17', fromAirport: c[2][0], toAirport: c[2][1] }], airlines: c[3], roundType: 2, cabinClass: 1, numOfAdult: 1, numOfChildren: 0, numOfBaby: 0, order: 'asc', orderBy: 'priceAfterDiscount', linePointsRebateOnly: true, maxTransferCount: 0 });
const post = async (c) => { const r = await fetch(URL_, { method: 'POST', headers: H, body: body(c) }); return { http: r.status, j: await r.json().catch(() => null) }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await Promise.all(cases.map(post));
let res;
for (let w = 0; w < 5; w++) { await sleep(45000); res = await Promise.all(cases.map(post)); if (res.every((r) => r.j?.data?.status === 'UpdatesComplete')) break; }
let first = true;
cases.forEach((c, i) => {
  const d = res[i].j?.data, items = d?.items || [];
  console.log(`\n== ${c[0]}: http ${res[i].http} status ${d?.status} total ${d?.paging?.total}`);
  for (const x of items.slice(0, 4)) console.log(`  p=${x.priceAfterDiscount} fare=${x.totalFare} ${(x.marketingAirlines || []).map((a) => a.code || a.name).join('+')} ${x.departAirport?.code}-${x.arriveAirport?.code} ${x.departTime} | ret ${x.returnDepartAirport?.code || ''}-${x.returnArriveAirport?.code || ''} ${x.returnDepartTime || ''} transfers ${x.numberOfTransfer}/${x.returnNumberOfTransfer} cabin ${x.cabinClass ?? ''} ${x.cabinName ?? ''}`);
  if (first && items[0]) { first = false; console.log('  RAW0 ' + JSON.stringify(items[0]).slice(0, 2500)); }
});
