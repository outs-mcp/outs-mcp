// Check a call: the newest public OUTS call, its price path, and its proof on Solana, checked here.
//   node examples/proof.mjs [call id]
// The leaf is sha256 of the call's revealed text; each proof step hashes 0x01 + left + right up to the batch root,
// and the root is written on Solana in a memo "outs:v1:<batch>:<root>:<calls>".
import { createHash } from 'node:crypto';
import { createApi } from '../src/api.mjs';

const api = createApi({ baseUrl: process.env.OUTS_URL });
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const usd = (n) => (n == null ? '?' : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1e3)}K`);
// a return (0.3) as a signed percent: +30% · −52%
const pct = (r) => (typeof r !== 'number' ? '?' : `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(Math.round(r * 1000) / 10)}%`);
const BARS = '▁▂▃▄▅▆▇█';

const id = process.argv[2] ?? (await api.getLiveCalls({ limit: 20 })).calls.find((c) => c.status !== 'sealed')?.id;
if (!id) {
  console.log('No public call yet: sealed calls open after 30 minutes.');
  process.exit(0);
}
const d = await api.getCall({ id });
const c = d.call;
console.log(`call ${c.id}: $${c.symbol} by ${c.name} (${c.kind}) · entry ${usd(c.entryUsd)} · now ${usd(c.nowUsd)} · ${c.multiple ?? '?'}x · ${c.status}`);

const path = (d.readings ?? []).map((r) => r.mcapUsd).filter((v) => v > 0);
if (path.length > 1) {
  const lo = Math.min(...path);
  const hi = Math.max(...path);
  const step = Math.max(1, Math.ceil(path.length / 60));
  const bars = path.filter((_, i) => i % step === 0).map((v) => BARS[Math.round(((v - lo) / (hi - lo || 1)) * 7)]);
  console.log(`price path  ${bars.join('')}  low ${usd(lo)} · high ${usd(hi)}`);
}
const t = c.trade;
if (t?.exit) console.log(`paper trade  sold at ${usd(t.exit.usd)} (${t.exit.reason}) · ${pct(t.exit.ret ?? t.exit.retNet)}`);
else if (t?.open) console.log(`paper trade  open · ${pct(t.open.ret ?? t.open.retNet)} if sold now`);

if (!d.reveal) {
  console.log('proof       the call is sealed; its text opens with the call.');
} else {
  const leaf = sha(Buffer.from(d.reveal.preimage, 'utf8'));
  let h = leaf;
  for (const s of d.proof ?? []) h = sha(Buffer.concat([Buffer.from([1]), Buffer.from(s.right ? h : s.hash, 'hex'), Buffer.from(s.right ? s.hash : h, 'hex')]));
  console.log(`leaf        ${leaf} ${leaf === d.leaf ? 'matches the receipt' : 'DOES NOT MATCH the receipt'}`);
  if (d.batch?.root) console.log(`root        ${h} ${h === d.batch.root ? `matches batch ${d.batch.id}` : 'DOES NOT MATCH the batch'}`);
  console.log(d.batch?.sig ? `on Solana   https://solscan.io/tx/${d.batch.sig}` : 'on Solana   waiting for the next anchor');
}
