// The REST client: one method per tool, the right path for each, and errors in plain words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApi, OutsApiError } from '../src/api.mjs';
import { VERSION } from '../src/version.mjs';
import { FIXTURES, LEAF, outsRoutes, stubFetch } from './stub.mjs';

const make = (routes, o = {}) => {
  const fetch = stubFetch(routes);
  return { api: createApi({ baseUrl: 'http://stub.local', fetch, ...o }), fetch };
};
const last = (fetch) => fetch.calls[fetch.calls.length - 1];
const rejects = (p, re) => assert.rejects(p, (e) => e instanceof OutsApiError && re.test(e.message));

test('VERSION matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
});

test('read methods call the contract paths with their filters', async () => {
  const { api, fetch } = make(outsRoutes());
  await api.getLiveCalls({ status: 'live', agent: 'house-rules', kind: 'house', limit: 5 });
  assert.deepEqual(last(fetch), { ...last(fetch), method: 'GET', path: '/api/v1/calls', query: { status: 'live', agent: 'house-rules', kind: 'house', limit: '5' } });
  assert.equal(last(fetch).headers['user-agent'], `outs-mcp/${VERSION}`);
  assert.equal(last(fetch).headers.authorization, undefined);

  await api.getLiveCalls();
  assert.deepEqual(last(fetch).query, { limit: '20' }, 'default 20 rows');
  await api.getLiveCalls({ limit: 500 });
  assert.equal(last(fetch).query.limit, '50', 'lists are capped at 50');

  const d = await api.getCall({ id: 7 });
  assert.equal(last(fetch).path, '/api/v1/calls/7');
  assert.equal(d.why.kind, 'rules');

  await api.getMarket();
  assert.equal(last(fetch).path, '/api/v1/market');
  await api.getAgents();
  assert.equal(last(fetch).path, '/api/v1/agents');

  await api.getTrades({ agent: 'house-rules', open: false, limit: 3 });
  assert.deepEqual([last(fetch).path, last(fetch).query], ['/api/v1/trades', { agent: 'house-rules', open: 'false', limit: '3' }]);

  await api.getPerformance({ agent: 'house-rules', days: 14 });
  assert.deepEqual([last(fetch).path, last(fetch).query], ['/api/v1/agents/house-rules/performance', { days: '14' }]);

  await api.getStrategy({ id: FIXTURES.strategy.id });
  assert.equal(last(fetch).path, `/api/v1/strategies/${FIXTURES.strategy.id}`);
});

test('get_call by leaf finds the id through the receipt; an older server hands back the receipt', async () => {
  const { api, fetch } = make(outsRoutes());
  const d = await api.getCall({ leaf: LEAF.toUpperCase() });
  assert.deepEqual(
    fetch.calls.map((c) => c.path),
    [`/api/v1/receipts/${LEAF}`, '/api/v1/calls/7'],
  );
  assert.equal(d.coin.symbol, 'CAT');

  const old = make(outsRoutes({ 'GET /api/v1/calls/7': null }));
  const r = await old.api.getCall({ leaf: LEAF });
  assert.equal(r.leaf, LEAF);
  assert.match(r.note, /older than this MCP/);

  await rejects(old.api.getCall({ id: 7 }), /no call 7, or this OUTS server is too old/);
  await rejects(old.api.getCall({}), /needs an id or a leaf/);
  await rejects(old.api.getCall({ leaf: 'xyz' }), /64 hex/);
  await rejects(old.api.getCall({ id: '7/../../x' }), /not valid/);
});

test('get_coins_in_range sorts the whole range here, largest first, missing values last', async () => {
  const { api, fetch } = make(outsRoutes());
  const r = await api.getCoinsInRange({ sort: 'buyers1h', limit: 2 });
  assert.deepEqual(last(fetch).query, { sort: 'buyers1h', limit: '200' });
  assert.deepEqual(
    r.coins.map((c) => c.symbol),
    ['B', 'A'],
  );
  assert.equal(r.total, 3);
  const byVol = await api.getCoinsInRange();
  assert.deepEqual(
    byVol.coins.map((c) => c.symbol),
    ['A', 'C', 'B'],
  );
  const byMcap = await api.getCoinsInRange({ sort: 'mcap' });
  assert.equal(byMcap.coins[0].symbol, 'B');
  await rejects(api.getCoinsInRange({ sort: 'holders' }), /sort must be one of/);
});

test('trading writes send the body and the size; the token once, as a bearer header', async () => {
  const { api, fetch } = make(outsRoutes());
  const strategy = { entry: { ageMaxMin: 60 }, exit: { tp: 0.3, sl: 0.2, maxHoldMin: 360 } };
  await api.backtest({ strategy, sizeUsd: 500 });
  assert.deepEqual([last(fetch).method, last(fetch).path, last(fetch).body], ['POST', '/api/v1/backtest', { strategy, sizeUsd: 500 }]);
  assert.equal(last(fetch).headers['content-type'], 'application/json');

  await api.backtest({ id: FIXTURES.strategy.id });
  assert.deepEqual(last(fetch).body, { id: FIXTURES.strategy.id });

  await api.backtest({ strategy, sizeUsd: 100, costs: 'legacy', fill: 'close', limit: 10 });
  assert.deepEqual(last(fetch).body, { strategy, sizeUsd: 100, costs: 'legacy', fill: 'close', limit: 10 });

  const made = await api.createStrategy({ name: 'fast', ...strategy, sizeUsd: 100 });
  assert.deepEqual([last(fetch).method, last(fetch).path, last(fetch).body], ['POST', '/api/v1/strategies', { name: 'fast', ...strategy, sizeUsd: 100 }]);
  assert.ok(made.token);

  const id = FIXTURES.strategy.id;
  const token = 'secret-token-1234';
  await api.updateStrategy({ id, token, exit: { tp: 0.5 } });
  assert.deepEqual([last(fetch).method, last(fetch).path, last(fetch).body], ['PATCH', `/api/v1/strategies/${id}`, { exit: { tp: 0.5 } }], 'the token is sent once, as a header');
  assert.equal(last(fetch).headers.authorization, `Bearer ${token}`);
  assert.equal(fetch.inits[fetch.inits.length - 1].redirect, 'error', 'a token never follows a redirect');

  await api.runStrategy({ id, token, on: true });
  assert.deepEqual([last(fetch).method, last(fetch).path, last(fetch).body], ['POST', `/api/v1/strategies/${id}/run`, { on: true }]);
  assert.equal(last(fetch).headers.authorization, `Bearer ${token}`);

  const n = fetch.calls.length;
  await rejects(api.updateStrategy({ id, token }), /at least one of name, entry, exit or sizeUsd/);
  await rejects(api.runStrategy({ id, token }), /on must be true/);
  await rejects(api.runStrategy({ id, on: true }), /needs the token/);
  for (const bad of ['short-token', 'x'.repeat(129), 'has space in it 12345', 'line\nbreak-0123456789']) {
    await assert.rejects(api.runStrategy({ id, token: bad, on: true }), (e) => /token is not valid/.test(e.message) && !e.message.includes(bad));
  }
  await rejects(api.backtest({}), /needs a strategy/);
  await rejects(api.backtest({ strategy, costs: 'all' }), /costs must be none \(price moves only, the default\) or legacy/);
  await rejects(api.backtest({ strategy, fill: 'low' }), /fill must be level \(the default\) or close/);
  await rejects(api.backtest({ strategy, limit: 51 }), /limit must be a whole number from 0 to 50/);
  await rejects(api.createStrategy({ name: 'x', entry: {}, exit: {}, sizeUsd: 300 }), /sizeUsd must be one of 100, 500, 2000/);
  await rejects(api.getStrategy({ id: '../calls' }), /not valid/);
  await rejects(api.getPerformance({ agent: 'a/b' }), /not valid/);
  assert.equal(fetch.calls.length, n, 'bad input never reaches the server');
});

test('errors: rate limit, server errors and refusals come back as words with what to do', async () => {
  const limited = make(outsRoutes({ 'GET /api/v1/market': { status: 429, body: { error: 'slow' } } }));
  await rejects(limited.api.getMarket(), /rate limit.*Wait a minute, then try again/);
  const later = make(outsRoutes({ 'GET /api/v1/market': { status: 429, body: { error: 'slow' }, headers: { 'retry-after': '30' } } }));
  await rejects(later.api.getMarket(), /Wait 30 s/);

  const down = make(outsRoutes({ 'GET /api/v1/market': { status: 500, body: { error: 'server' } } }));
  await rejects(down.api.getMarket(), /server error \(500\).*Try again in a minute; http:\/\/stub\.local\/api\/health/);

  const busy = make(outsRoutes({ 'POST /api/v1/backtest': { status: 503, body: { error: 'backtest', reason: 'the backtest history is being published; try again later' } } }));
  await rejects(busy.api.backtest({ strategy: { entry: {} } }), /could not do this now \(503\): the backtest history is being published/);
  const slow = make(outsRoutes({ 'POST /api/v1/backtest': { status: 503, body: { error: 'busy', reason: 'the backtest took too long; try again in a few seconds' } } }));
  await rejects(slow.api.backtest({ strategy: { entry: {} } }), /could not do this now \(503\): the backtest took too long; try again in a few seconds/);

  const refused = make(outsRoutes({ 'POST /api/v1/strategies': { status: 400, body: { error: 'strategy', reason: 'entry.mcapMin must be between 100000 and 1000000' } } }));
  await rejects(refused.api.createStrategy({ name: 'x', entry: { mcapMin: 5 }, exit: {} }), /refused the request \(400 strategy\): entry\.mcapMin must be between 100000 and 1000000\. Fix the input/);

  const id = FIXTURES.strategy.id;
  const wrong = make(outsRoutes({ [`POST /api/v1/strategies/${id}/run`]: { status: 401, body: { error: 'auth', reason: 'strategy or token is wrong' } } }));
  await rejects(wrong.api.runStrategy({ id, token: 'nope-nope-nope-nope', on: true }), /refused the token \(strategy or token is wrong\)\. Use the token create_strategy returned/);

  // a server error's own words are passed on only for the backtest that is not ready yet
  const crash = make(outsRoutes({ 'GET /api/v1/market': { status: 500, body: { error: 'server', reason: 'database busy at worker 3' } } }));
  await assert.rejects(crash.api.getMarket(), (e) => /server error \(500\)/.test(e.message) && !e.message.includes('database busy'));
  const other503 = make(outsRoutes({ 'GET /api/v1/market': { status: 503, body: { error: 'busy', reason: 'internal queue 17 full' } } }));
  await assert.rejects(other503.api.getMarket(), (e) => /server error \(503\)/.test(e.message) && !e.message.includes('queue'));

  const agent = make(outsRoutes({ 'GET /api/v1/calls': { status: 400, body: { error: 'agent' } } }));
  await rejects(agent.api.getLiveCalls({ agent: 'nobody' }), /agent must be an agent key from get_agents/);
});

test('errors: a 404 from the new trading paths says the server needs an update; known paths say what is missing', async () => {
  // an OUTS server from before paper trading: none of the trading routes exist
  const old = outsRoutes();
  for (const k of Object.keys(old)) if (/trades|performance|backtest|strategies/.test(k)) delete old[k];
  const { api } = make(old);
  await rejects(api.getTrades(), /Paper trading is not live on this OUTS server yet\. It needs a newer OUTS server/);
  await rejects(api.getPerformance({ agent: 'house-rules' }), /needs a newer OUTS server/);
  await rejects(api.backtest({ strategy: { entry: {} } }), /needs a newer OUTS server/);
  await rejects(api.createStrategy({ name: 'x', entry: {}, exit: {} }), /needs a newer OUTS server/);
  await rejects(api.getStrategy({ id: 'k3j9x0aa' }), /needs a newer OUTS server/);
  await rejects(api.getPerformance({ agent: 'house-ghost' }), /OUTS has no agent "house-ghost"\. Agent keys come from get_agents/);

  // a current server: the trades list answers, so a 404 is an unknown strategy
  const cur = make(outsRoutes());
  await rejects(cur.api.getStrategy({ id: 'zzzzzzzz' }), /OUTS has no strategy "zzzzzzzz"\. Use the id create_strategy returned/);
});

test('errors: timeout, network failure and a reply that is not JSON', async () => {
  const hang = createApi({ baseUrl: 'http://stub.local', timeoutMs: 50, fetch: () => new Promise(() => {}) });
  const t0 = Date.now();
  await rejects(hang.getMarket(), /took longer than 0\.1 s to answer GET \/api\/v1\/market\. Try again in a minute/);
  assert.ok(Date.now() - t0 < 2000);

  let aborted = false;
  const slow = createApi({
    baseUrl: 'http://stub.local',
    timeoutMs: 30,
    fetch: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => ((aborted = true), reject(new Error('aborted'))))),
  });
  await rejects(slow.getAgents(), /took longer than/);
  assert.ok(aborted, 'the request is aborted on timeout');

  const offline = createApi({
    baseUrl: 'http://stub.local',
    fetch: async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    },
  });
  await rejects(offline.getMarket(), /Could not reach OUTS at http:\/\/stub\.local \(ECONNREFUSED\)\. Try again in a minute; if you set OUTS_URL, check it/);

  const huge = make(outsRoutes({ 'GET /api/v1/market': { body: { pad: 'x'.repeat(9 << 20) } } }));
  await rejects(huge.api.getMarket(), /sent more than 8 MB/);

  const token = 'tok_ABCDEFGHIJKLMNOP';
  const headerFail = createApi({
    baseUrl: 'http://stub.local',
    fetch: async (url, init) => {
      throw new TypeError(`Headers.append: "${init.headers.authorization}" is an invalid header value.`);
    },
  });
  await assert.rejects(headerFail.runStrategy({ id: 'k3j9x0aa', token, on: true }), (e) => /header was not valid/.test(e.message) && !e.message.includes(token));
  const leaky = createApi({
    baseUrl: 'http://stub.local',
    fetch: async (url, init) => {
      throw new Error(`socket hang up after ${init.headers.authorization}`);
    },
  });
  await assert.rejects(leaky.runStrategy({ id: 'k3j9x0aa', token, on: true }), (e) => /Could not reach OUTS/.test(e.message) && !e.message.includes(token) && e.message.includes('[token]'));

  const html = make(outsRoutes({ 'GET /api/v1/market': { status: 200, type: 'text/html', text: '<html></html>' } }));
  await rejects(html.api.getMarket(), /something other than JSON\. Check that OUTS_URL points at an OUTS site/);

  assert.throws(() => createApi({ baseUrl: 'outs.trade' }), /not a web address/);
  assert.throws(() => createApi({ baseUrl: 'ftp://outs.trade' }), /must start with https:\/\/ or http:\/\//);
});

test('get_study: summary, rounds, exits and limits from the published files', async () => {
  const { api, fetch } = make(outsRoutes(), { publicUrl: 'https://outs.trade' });
  const s = await api.getStudy();
  assert.equal(s.part, 'summary');
  assert.deepEqual(s.verdict, { model: 'trees', ship: false, aucHeldOut: { est: 0.54, lo: 0.4, hi: 0.69 }, liftTop10: { est: 1.09, lo: 0, hi: 3.12 }, needAucLow: 0.55, needLiftLow: 1 });
  assert.deepEqual(s.findings, ['Finding one.', 'Finding two.']);
  assert.equal(s.data.heldOut.coins, 294);
  assert.equal(s.source, 'https://outs.trade/research/explore.json');
  assert.equal(s.before, 'Round 1 bottom line.');
  assert.ok(!('walkForward' in s), 'only the summary fields');

  const r = await api.getStudy({ part: 'rounds' });
  assert.deepEqual(
    r.rounds.map((x) => x.round),
    ['round 1', 'latest', 'alpha wallets'],
  );
  assert.deepEqual(r.rounds[0].models[0].auc1, { est: 0.58, lo: 0.47, hi: 0.7 });

  fetch.calls.length = 0;
  const x = await api.getStudy({ part: 'exits' });
  assert.equal(x.published, false, 'the HTML page for a missing file counts as not published');
  assert.deepEqual(x.inForce.exits.house, { tp: 0.3, sl: 0.2, trail: null, breakEvenAt: null, maxHoldMin: 360 });
  assert.deepEqual(x.inForce.trade, { sizes: [100, 500, 2000], sizeUsd: 100 }, 'an older server: the sizes from its rules.costs, its cost model left out');
  assert.equal(x.inForce.costs, undefined);
  assert.deepEqual(
    fetch.calls.map((c) => c.path),
    ['/research/exits.json', '/api/v1/rules'],
  );

  const published = make(outsRoutes({ 'GET /research/exits.json': { body: { version: 'exits1', verdict: 'house exit kept', findings: ['A.'], limits: ['B.'], trades: Array.from({ length: 500 }, (_, i) => ({ i })) } } }));
  const p = await published.api.getStudy({ part: 'exits' });
  assert.equal(p.published, true);
  assert.equal(p.verdict, 'house exit kept');
  assert.equal(p.trades.length, 50);

  const l = await api.getStudy({ part: 'limits' });
  assert.deepEqual([l.latest, l.round1], [['Small sample.'], ['V1 limit.']]);
  await rejects(api.getStudy({ part: 'everything' }), /part must be one of summary, rounds, exits, limits/);

  const none = make({});
  const empty = await none.api.getStudy();
  assert.equal(empty.published, false);
});
