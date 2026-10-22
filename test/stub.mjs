// Test helpers: a stub fetch with canned OUTS replies (it records every request) and the same replies over HTTP.
import http from 'node:http';

// The tool and prompt names of the OUTS MCP contract v1 (2026-10-21), in order.
export const CONTRACT_TOOLS = [
  'get_live_calls',
  'get_call',
  'get_coins_in_range',
  'get_market',
  'get_agents',
  'get_study',
  'get_trades',
  'get_performance',
  'backtest',
  'create_strategy',
  'update_strategy',
  'run_strategy',
  'get_strategy',
];
export const CONTRACT_PROMPTS = ['alert', 'screener', 'pulse', 'proof', 'feed', 'study', 'daytrade', 'mystrategy'];

export const LEAF = 'ab'.repeat(32);
export const MINT = 'So11111111111111111111111111111111111111112';

const call = (id, extra = {}) => ({
  id,
  agent: 'house-rules',
  name: 'rules',
  kind: 'house',
  leaf: LEAF,
  t: 1_760_000_000_000 + id,
  mint: MINT,
  symbol: 'CAT',
  entryUsd: 120_000,
  status: 'live',
  nowUsd: 150_000,
  multiple: 1.25,
  timeLeftMs: 3_600_000,
  spark: [120_000, 130_000, 150_000],
  trade: { policy: { tp: 0.3, sl: 0.2, trail: null, breakEvenAt: null, maxHoldMin: 360 }, sizeUsd: 100, exit: null, open: { nowUsd: 150_000, retNet: 0.21, leavesBy: 1 } },
  ...extra,
});

export const FIXTURES = {
  calls: { calls: [call(7), call(6, { status: 'hit' })] },
  detail: { leaf: LEAF, call: call(7), batch: { id: 3, root: 'cd'.repeat(32), sig: null }, proof: [], reveal: null, readings: [{ t: 1, mcapUsd: 120_000 }], ctx: { holders: 900 }, coin: { symbol: 'CAT' }, why: { kind: 'rules' } },
  receipt: { leaf: LEAF, call: call(7), batch: null, proof: [], reveal: null, readings: [] },
  coins: {
    at: 1,
    coins: [
      { mint: 'A', symbol: 'A', mcapUsd: 300_000, vol1hUsd: 90_000, buyers1h: 10 },
      { mint: 'B', symbol: 'B', mcapUsd: 900_000, vol1hUsd: 50_000, buyers1h: 400 },
      { mint: 'C', symbol: 'C', mcapUsd: 150_000, vol1hUsd: 70_000, buyers1h: null },
    ],
  },
  market: { at: 1, launches1h: 2400, launchesMed: 2000, grads1h: 14, gradsMed: 12, eligible: 31, words: [{ w: 'cat', n: 40 }], hot: [] },
  agents: { agents: [{ key: 'house-rules', name: 'rules', kind: 'house', calls7d: 40 }] },
  trades: { trades: [{ id: 7, agent: 'house-rules', exit: { t: 2, usd: 156_000, reason: 'tp', retNet: 0.27 }, open: null }] },
  performance: { agent: 'house-rules', days: 7, trades: 12, winRate: 0.5, meanNet: 0.01, medianNet: -0.02, totalNet: 0.12, maxDrawdown: -0.4, byDay: [] },
  strategy: { id: 'k3j9x0aa', agent: 'strat-k3j9x0aa', name: 'fast', state: 'draft', entry: {}, exit: { tp: 0.3, sl: 0.2, trail: null, breakEvenAt: null, maxHoldMin: 360 }, sizeUsd: 100 },
  rules: { costs: { feeTiers: [[0, 125], [420, 120], [1470, 115]], networkSol: 0.002, sizes: [100, 500, 2000], sizeUsd: 100 }, exits: { maxHoldMin: 1440, house: { tp: 0.3, sl: 0.2, trail: null, breakEvenAt: null, maxHoldMin: 360 } } },
  explore: {
    version: '2026-10-20.2',
    asOf: '2026-10-20T16:29Z',
    data: { launches: 946_875, graduates: 20_945, population: 1009, days: 21.7, from: '2026-09-26', to: '2026-10-17', testFrom: '2026-10-10', testTo: '2026-10-17', nTest: 294 },
    method: { target: 'x5 coin: an hourly close at 5x the $100K-close mcap within 72 h.' },
    shipRule: { primary: 'trees', auc5: [0.54, 0.4, 0.69], lift5Top10: [1.09, 0, 3.12], needAucLo: 0.55, needLift10Lo: 1, ship: false },
    models: [{ name: 'trees', label: 'Trees agent', test: { auc5: [0.54, 0.4, 0.69], top: [] } }],
    findings: ['Finding one.', 'Finding two.'],
    limits: ['Small sample.'],
    v1: { summary: 'Round 1 bottom line.' },
    walkForward: Array.from({ length: 11 }, (_, i) => ({ day: i })),
  },
  exploreV1: { version: '2026-10-20.1', asOf: '2026-10-20T10:00Z', method: { labels: '$1M runner.' }, models: [{ name: 'linear', test: { auc1: [0.58, 0.47, 0.7] } }], findings: ['V1 finding.'], limits: ['V1 limit.'] },
  alpha: { version: 'alpha1', status: 'research only', heldout: { coins: 294, auc: 0.447, auc_ci95: [0.38, 0.53], verdict: 'does not hold' }, allDaysLODO: { coins: 1009, auc: 0.47, auc_ci95: [0.43, 0.51], verdict: 'does not hold' } },
};

/** The replies of an up-to-date OUTS server. */
export function outsRoutes(over = {}) {
  const F = FIXTURES;
  return {
    'GET /api/v1/calls': { body: F.calls },
    'GET /api/v1/calls/7': { body: F.detail },
    [`GET /api/v1/receipts/${LEAF}`]: { body: F.receipt },
    'GET /api/v1/eligible': { body: F.coins },
    'GET /api/v1/market': { body: F.market },
    'GET /api/v1/agents': { body: F.agents },
    'GET /api/v1/agents/house-rules': { body: F.agents.agents[0] },
    'GET /api/v1/trades': { body: F.trades },
    'GET /api/v1/agents/house-rules/performance': { body: F.performance },
    'POST /api/v1/backtest': { body: { trades: 40, winRate: 0.4 } },
    'POST /api/v1/strategies': { body: { id: F.strategy.id, token: 't0ken-t0ken-t0ken-t0ken-t0ken-00', strategy: F.strategy } },
    [`PATCH /api/v1/strategies/${F.strategy.id}`]: { body: F.strategy },
    [`POST /api/v1/strategies/${F.strategy.id}/run`]: { body: { ...F.strategy, state: 'running' } },
    [`GET /api/v1/strategies/${F.strategy.id}`]: { body: { ...F.strategy, trades: [], performance: F.performance } },
    'GET /api/v1/rules': { body: F.rules },
    'GET /research/explore.json': { body: F.explore },
    'GET /research/explore-v1.json': { body: F.exploreV1 },
    'GET /research/alpha-study.json': { body: F.alpha },
    // the site answers a missing file with its HTML page (status 200), as a single-page-app fallback does
    'GET /research/exits.json': { status: 200, type: 'text/html; charset=utf-8', text: '<!doctype html><title>OUTS</title>' },
    ...over,
  };
}

function replyOf(r) {
  if (r === null || r === undefined) return { status: 404, type: 'application/json', text: '{"error":"notFound"}', headers: {} };
  const status = r.status ?? 200;
  const type = r.type ?? 'application/json; charset=utf-8';
  const text = r.text ?? JSON.stringify(r.body ?? {});
  return { status, type, text, headers: r.headers ?? {} };
}

/** fetch(url, init) answering from `routes` ('METHOD /path' → { status, body | text, type, headers } or a function). */
export function stubFetch(routes = outsRoutes()) {
  const calls = [];
  const inits = [];
  const fn = async (url, init = {}) => {
    inits.push(init);
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const req = { method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: { ...(init.headers ?? {}) }, body: init.body ? JSON.parse(init.body) : undefined, url: String(url) };
    calls.push(req);
    let r = routes[`${method} ${u.pathname}`];
    if (typeof r === 'function') r = await r(req, init);
    const out = replyOf(r);
    return new Response(out.text, { status: out.status, headers: { 'content-type': out.type, ...out.headers } });
  };
  fn.calls = calls;
  fn.inits = inits;
  return fn;
}

/** The same replies from a real HTTP server on 127.0.0.1 (for the stdio test). */
export async function stubServer(routes = outsRoutes()) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://local');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
    const rec = { method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: req.headers, body };
    calls.push(rec);
    let r = routes[`${req.method} ${u.pathname}`];
    if (typeof r === 'function') r = await r(rec);
    const out = replyOf(r);
    res.writeHead(out.status, { 'content-type': out.type, ...out.headers });
    res.end(out.text);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, calls, close: () => new Promise((resolve) => server.close(resolve)) };
}
