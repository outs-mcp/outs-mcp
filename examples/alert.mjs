// Telegram alert: a message each time an OUTS agent calls a coin under $300K, with the call's top reasons.
//   TELEGRAM_BOT_TOKEN=<bot token> TELEGRAM_CHAT_ID=<chat id> node examples/alert.mjs
// Without the two settings it prints the messages here. Checks once a minute; Ctrl+C stops it.
import { createApi } from '../src/api.mjs';

const api = createApi({ baseUrl: process.env.OUTS_URL });
const UNDER = 300_000;
const { TELEGRAM_BOT_TOKEN: bot, TELEGRAM_CHAT_ID: chat } = process.env;
const usd = (n) => (n == null ? '?' : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1e3)}K`);

async function send(text) {
  if (!bot || !chat) return console.log(`${text}\n`);
  const r = await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
  if (!r.ok) console.error(`telegram answered ${r.status}`);
}

// the reasons OUTS stored with the call: the inputs that added the most to its score
const reasons = (why) =>
  (why?.contributions ?? [])
    .slice()
    .sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib))
    .slice(0, 3)
    .map((c) => `• ${c.key} ${typeof c.value === 'number' ? +c.value.toFixed(2) : (c.value ?? '')} (${c.contrib >= 0 ? '+' : ''}${c.contrib.toFixed(1)})`);

const seen = new Set();
for (let first = true; ; first = false) {
  try {
    const { calls } = await api.getLiveCalls({ limit: 20 });
    for (const c of calls.reverse()) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      // the first round only marks the calls that already exist; sealed calls show their coin later
      if (first || c.entryUsd == null || c.entryUsd >= UNDER) continue;
      const d = await api.getCall({ id: c.id });
      const lines = [`${c.name} (${c.kind}) called $${c.symbol} at ${usd(c.entryUsd)}`, ...reasons(d.why), `https://solscan.io/token/${c.mint}`];
      await send(lines.join('\n'));
    }
  } catch (e) {
    console.error(e.message);
  }
  await new Promise((r) => setTimeout(r, 60_000));
}
