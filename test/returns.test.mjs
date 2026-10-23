// Returns since OUTS dropped costs (2026-10-23): the API sends gross ret / mean / median / total (and mean7d), with
// the old *Net names as deprecated aliases for one version. The MCP reads the new names first, falls back to the old
// ones (an older server), and hands the AI only the new names: results in %, never "net".
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.mjs';
import { normReturns } from '../src/returns.mjs';
import { INSTRUCTIONS, TOOLS } from '../src/server.mjs';
import { PROMPTS } from '../src/prompts.mjs';
import { FIXTURES, outsRoutes, stubFetch } from './stub.mjs';

const make = (routes) => createApi({ baseUrl: 'http://stub.local', fetch: stubFetch(routes) });

test('normReturns: new names first, old names as the fallback, old names dropped, at any depth', () => {
  assert.deepEqual(normReturns({ exit: { retNet: 0.27, retGross: 0.3 } }), { exit: { ret: 0.27 } }, 'an older server: retNet is all there is');
  assert.deepEqual(normReturns({ exit: { ret: 0.3, retNet: 0.27, retGross: 0.3 } }), { exit: { ret: 0.3 } }, 'ret wins');
  assert.deepEqual(normReturns({ meanNet: 0.01, medianNet: -0.02, totalNet: 0.12 }), { mean: 0.01, median: -0.02, total: 0.12 });
  assert.deepEqual(normReturns({ mean: 0.05, meanNet: 0.01 }), { mean: 0.05 });
  assert.deepEqual(normReturns({ agents: [{ meanNet7d: 0.1 }, { mean7d: 0.2, meanNet7d: 0.1, stake: 0.01 }] }), { agents: [{ mean7d: 0.1 }, { mean7d: 0.2, stake: 0.01 }] });
  assert.deepEqual(normReturns({ open: { retNet: null } }), { open: { ret: null } });
  assert.deepEqual(normReturns([1, 'x', null]), [1, 'x', null]);
});

test('an older server (only *Net fields): trades, calls, performance and agents come back with the new names', async () => {
  const api = make(outsRoutes());
  const t = await api.getTrades();
  assert.equal(t.trades[0].exit.ret, 0.27);
  assert.ok(!('retNet' in t.trades[0].exit));
  const c = await api.getLiveCalls();
  assert.equal(c.calls[0].trade.open.ret, 0.21);
  const p = await api.getPerformance({ agent: 'house-rules' });
  assert.deepEqual([p.mean, p.median, p.total], [0.01, -0.02, 0.12]);
  assert.ok(!('meanNet' in p) && !('medianNet' in p) && !('totalNet' in p));
  const s = await api.getStrategy({ id: FIXTURES.strategy.id });
  assert.equal(s.performance.mean, 0.01);
});

test('a new server: the gross fields are read first and the deprecated aliases are left out', async () => {
  const perf = { ...FIXTURES.performance, mean: 0.05, median: 0.03, total: 0.6, stake: 0.01, stakeBasis: 'few' };
  const trades = { trades: [{ id: 7, exit: { t: 2, usd: 156_000, reason: 'tp', ret: 0.3, retGross: 0.3, retNet: 0.3 }, open: null }] };
  const api = make(outsRoutes({ 'GET /api/v1/agents/house-rules/performance': { body: perf }, 'GET /api/v1/trades': { body: trades } }));
  const p = await api.getPerformance({ agent: 'house-rules' });
  assert.deepEqual([p.mean, p.median, p.total, p.stake, p.stakeBasis], [0.05, 0.03, 0.6, 0.01, 'few']);
  const t = await api.getTrades();
  assert.deepEqual(t.trades[0].exit, { t: 2, usd: 156_000, reason: 'tp', ret: 0.3 });
});

test('the AI reads results in %: no "net", no costs, no multiples as ×', () => {
  const text = [INSTRUCTIONS, ...TOOLS.map((t) => t.description), ...PROMPTS.flatMap((p) => [p.text, p.gets])].join('\n');
  assert.doesNotMatch(text, /\bnet\b|after costs|costs on|price impact|fees on both/i);
  assert.match(INSTRUCTIONS, /percent/i);
  assert.match(INSTRUCTIONS, /\+237%/);
  const perf = TOOLS.find((t) => t.name === 'get_performance').description;
  assert.match(perf, /stake/i);
  assert.match(TOOLS.find((t) => t.name === 'get_live_calls').description, /ATH/);
});
