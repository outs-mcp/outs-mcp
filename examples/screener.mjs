// Screener: the coins in range ($100K to $1M), most buyers in the last hour first. Refreshes every 30 s.
//   node examples/screener.mjs          (Ctrl+C stops it)
//   node examples/screener.mjs --once
import { createApi } from '../src/api.mjs';

const api = createApi({ baseUrl: process.env.OUTS_URL });
const usd = (n) => (n == null ? '-' : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1e3)}K`);

async function show() {
  const { coins, total } = await api.getCoinsInRange({ sort: 'buyers1h', limit: 25 });
  if (process.stdout.isTTY) console.clear();
  console.log(`${total} coins in range, most buyers in the last hour first · ${new Date().toLocaleTimeString()}`);
  console.table(
    coins.map((c) => ({
      coin: `$${c.symbol}`,
      mcap: usd(c.mcapUsd),
      age: c.ageMin == null ? '-' : `${(c.ageMin / 60).toFixed(1)} h`,
      holders: c.holders ?? '-',
      'buyers 1h': c.buyers1h ?? '-',
      'traded 1h': usd(c.vol1hUsd),
      organic: c.organic ?? '-',
      mint: c.mint,
    })),
  );
}

await show();
if (!process.argv.includes('--once')) setInterval(() => show().catch((e) => console.error(e.message)), 30_000);
