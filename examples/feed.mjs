// Live feed: the live OUTS calls, newest first; a row flashes when its price moves. Polls every 15 s.
//   node examples/feed.mjs          (Ctrl+C stops it)
// In a web app, run the same loop in the browser (the API allows any origin) and flash the row with CSS.
import { createApi } from '../src/api.mjs';

const api = createApi({ baseUrl: process.env.OUTS_URL });
const usd = (n) => (n == null ? '?' : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1e3)}K`);
const change = (x) => (x == null ? '' : `${x >= 1 ? '+' : ''}${((x - 1) * 100).toFixed(0)}%`);
const before = new Map();

for (;;) {
  try {
    const { calls } = await api.getLiveCalls({ status: 'live', limit: 15 });
    const rows = calls.map((c) => {
      const was = before.get(c.id);
      before.set(c.id, c.nowUsd);
      const moved = was != null && c.nowUsd != null && c.nowUsd !== was;
      const arrow = moved ? (c.nowUsd > was ? '▲' : '▼') : ' ';
      const coin = c.symbol ? `$${c.symbol}` : 'sealed';
      const row = `${arrow} ${coin.padEnd(12)} ${usd(c.entryUsd).padStart(7)} → ${usd(c.nowUsd).padStart(7)} ${change(c.multiple).padStart(6)}  ${c.name}`;
      return moved && process.stdout.isTTY ? `\x1b[7m${row}\x1b[0m` : row; // inverse video is the flash
    });
    if (process.stdout.isTTY) console.clear();
    console.log(`OUTS live calls · ${new Date().toLocaleTimeString()}\n${rows.join('\n') || 'none right now'}`);
  } catch (e) {
    console.error(e.message);
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
