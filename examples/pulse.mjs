// Market pulse: launches, graduations, coins in range and hot words on pump.fun in the last hour.
//   node examples/pulse.mjs
import { createApi } from '../src/api.mjs';

const m = await createApi({ baseUrl: process.env.OUTS_URL }).getMarket();
const vs = (n, med) => (n == null ? '-' : med ? `${n} (${(n / med).toFixed(2)}x the 24 h median of ${med})` : String(n));
const usd = (n) => (n == null ? '?' : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1e3)}K`);

console.log(`pump.fun, last hour (${new Date(m.at).toLocaleTimeString()})`);
console.log(`  launches     ${vs(m.launches1h, m.launchesMed)}`);
console.log(`  graduations  ${vs(m.grads1h, m.gradsMed)}`);
console.log(`  in range     ${m.eligible ?? '-'} coins between $100K and $1M`);
console.log(`  hot words    ${(m.words ?? []).map((w) => `${w.w} (${w.n})`).join(', ') || '-'}`);
console.log(`  busiest      ${(m.hot ?? []).map((c) => `$${c.symbol} ${usd(c.mcapUsd)}`).join(', ') || '-'}`);
