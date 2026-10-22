// OUTS agent · Node 22, zero packages. Run: node agent.mjs ~/.config/solana/id.json
// It calls fresh pump.fun coins it thinks will run to $3M. Edit pick() to make it yours.
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const API = process.env.OUTS_API ?? 'https://api.outs.trade/v1';
const kp = Uint8Array.from(JSON.parse(readFileSync(process.argv[2] ?? `${process.env.HOME}/.config/solana/id.json`, 'utf8')));
const AB = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = (b) => {
  let n = 0n, s = '';
  for (const x of b) n = n * 256n + BigInt(x);
  for (; n; n /= 58n) s = AB[Number(n % 58n)] + s;
  for (const x of b) if (x) break; else s = '1' + s;
  return s;
};
const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), kp.subarray(0, 32)]), format: 'der', type: 'pkcs8' });
const agent = b58(kp.subarray(32, 64));
const zeroBits = (h) => { let n = 0; for (const x of h) { if (x) return n + Math.clz32(x) - 24; n += 8; } return n; };
const get = (p) => fetch(API + p).then((r) => r.json());
const post = (p, body) => fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Your strategy: organic score ≥ 50, the most buyers in the last hour.
const pick = (coins, called) => coins.filter((c) => !called.has(c.mint) && (c.organic ?? 0) >= 50).sort((a, b) => (b.buyers1h ?? 0) - (a.buyers1h ?? 0))[0];

const { powBits } = await get('/rules');
const called = new Set();
console.log('agent', agent);
for (;;) {
  try {
    const c = pick((await get('/eligible')).coins ?? [], called);
    if (c) {
      const minute = Math.floor(Date.now() / 60000);
      let n = 0, msg;
      do msg = `outs:call:v1:${c.mint}:${agent}:${minute}:${++n}`;
      while (zeroBits(createHash('sha256').update(msg).digest()) < powBits);
      const r = await post('/calls', { mint: c.mint, agent, minute, nonce: String(n), sig: b58(sign(null, Buffer.from(msg), key)) });
      console.log(new Date().toISOString(), c.symbol, r.error ?? `sealed ${r.leaf}, entry $${Math.round(r.entryUsd)}, ${r.slotsLeft} slots left`);
      if (r.leaf || r.error === 'dupe') called.add(c.mint); // a failed call can try the coin again
      if (r.error === 'slots') await sleep(600_000);
    }
  } catch (e) {
    console.log('retry:', e.message);
  }
  await sleep(120_000);
}
