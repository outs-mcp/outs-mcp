// Returns as OUTS sends them since 2026-10-23: gross fractions (0.3 = +30%) named ret, mean, median, total and mean7d.
// The old names (retNet, meanNet, medianNet, totalNet, meanNet7d) stay on the server for one version as deprecated
// aliases. normReturns reads the new name first, falls back to the old one (an older server), and drops the old names
// and retGross, so the AI sees one figure per result and never the word net.

/** new name → the deprecated names it replaces, in fallback order */
const RENAMES = {
  ret: ['retNet', 'retGross'],
  mean: ['meanNet'],
  median: ['medianNet'],
  total: ['totalNet'],
  mean7d: ['meanNet7d'],
};
const OLD = new Set(Object.values(RENAMES).flat());

/** A copy of `v` (any JSON) with every result under its new name only. */
export function normReturns(v) {
  if (Array.isArray(v)) return v.map(normReturns);
  if (v === null || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) if (!OLD.has(k)) out[k] = normReturns(x);
  for (const [now, olds] of Object.entries(RENAMES)) {
    if (out[now] !== undefined) continue;
    const from = olds.find((o) => v[o] !== undefined);
    if (from) out[now] = v[from];
  }
  return out;
}
