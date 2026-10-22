// Read the study: how good the OUTS agents are on held-out days, with 95% ranges, the verdict and the limits.
//   node examples/study.mjs
import { createApi } from '../src/api.mjs';

const api = createApi({ baseUrl: process.env.OUTS_URL });
const s = await api.getStudy({ part: 'summary' });
if (s.published === false) {
  console.log(s.note);
  process.exit(0);
}
const range = (x) => (x ? `${x.est.toFixed(2)} (95% range ${x.lo.toFixed(2)} to ${x.hi.toFixed(2)})` : '-');

console.log(`OUTS study, as of ${s.asOf}`);
console.log(`question   ${s.question}`);
const h = s.data?.heldOut;
if (h) console.log(`held out   ${h.from} to ${h.to}, ${h.coins} coins the agents never saw`);
if (s.verdict) {
  console.log(`verdict    ${s.verdict.ship ? 'cleared its ship rule' : 'missed its ship rule'}: AUC ${range(s.verdict.aucHeldOut)}; the rule needs a low end above ${s.verdict.needAucLow}. AUC 0.5 is a coin flip.`);
}
console.log('\nfindings');
for (const f of s.findings ?? []) console.log(`- ${f}`);
const { latest = [] } = await api.getStudy({ part: 'limits' });
console.log('\nlimits');
for (const l of latest) console.log(`- ${l}`);
console.log(`\nfull study: ${s.source}`);
