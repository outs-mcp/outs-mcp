// The MCP server: the contract's tools and prompts, each tool on its REST path, compact results, errors as words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createApi } from '../src/api.mjs';
import { createOutsServer, compact, TOOL_NAMES, PROMPT_NAMES } from '../src/server.mjs';
import { PROMPTS } from '../src/prompts.mjs';
import { CONTRACT_PROMPTS, CONTRACT_TOOLS, FIXTURES, LEAF, outsRoutes, stubFetch } from './stub.mjs';

const READS = ['get_live_calls', 'get_call', 'get_coins_in_range', 'get_market', 'get_agents', 'get_study', 'get_trades', 'get_performance', 'backtest', 'get_strategy'];

async function connect(routes = outsRoutes()) {
  const fetch = stubFetch(routes);
  const server = createOutsServer(createApi({ baseUrl: 'http://stub.local', fetch }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'outs-test', version: '1.0.0' });
  await client.connect(b);
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text ?? '';
    return { r, text, data: r.isError ? null : JSON.parse(text) };
  };
  return { client, fetch, call, close: () => client.close() };
}

test('tools/list is the contract: names, order, descriptions, schemas, hints', async () => {
  const { client, close } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    CONTRACT_TOOLS,
  );
  assert.deepEqual(TOOL_NAMES, CONTRACT_TOOLS);
  for (const t of tools) {
    assert.ok(t.description.length > 40 && t.description.length < 400, `${t.name}: a short description`);
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(t.inputSchema.additionalProperties, false, `${t.name}: unknown keys are refused`);
    assert.equal(t.annotations.readOnlyHint, READS.includes(t.name), `${t.name}: readOnlyHint`);
    assert.equal(t.annotations.destructiveHint, false);
  }
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.deepEqual(byName.get_live_calls.inputSchema.properties.status.enum, ['live', 'hit', 'miss', 'closed', 'exited']);
  assert.deepEqual(byName.get_live_calls.inputSchema.properties.kind.enum, ['house', 'outside', 'strategy']);
  assert.equal(byName.get_live_calls.inputSchema.properties.limit.maximum, 50);
  assert.deepEqual(byName.get_study.inputSchema.properties.part.enum, ['summary', 'rounds', 'exits', 'limits']);
  assert.deepEqual(byName.get_performance.inputSchema.required, ['agent']);
  assert.equal(byName.get_performance.inputSchema.properties.days.maximum, 30);
  assert.deepEqual(byName.create_strategy.inputSchema.required.sort(), ['entry', 'exit', 'name']);
  assert.deepEqual(byName.update_strategy.inputSchema.required.sort(), ['id', 'token']);
  assert.deepEqual(byName.run_strategy.inputSchema.required.sort(), ['id', 'on', 'token']);
  const exit = byName.create_strategy.inputSchema.properties.exit.properties;
  assert.deepEqual(Object.keys(exit), ['tp', 'sl', 'trail', 'breakEvenAt', 'maxHoldMin']);
  assert.equal(exit.maxHoldMin.anyOf?.[0]?.maximum ?? exit.maxHoldMin.maximum, 1440);
  const entry = byName.create_strategy.inputSchema.properties.entry.properties;
  for (const k of ['mcapMin', 'mcapMax', 'ageMaxMin', 'chg1hMin', 'chg1hMax', 'turnoverMin', 'vol1hMin', 'buyers1hMin', 'organicMin', 'holdersMin', 'liquidityMin', 'rulesScoreMin', 'hasX', 'hasSite', 'hasTelegram', 'wordsAny', 'wordsNone']) {
    assert.ok(entry[k], `entry.${k}`);
  }
  await close();
});

test('prompts/list and prompts/get: the 8 contract prompts with the site texts', async () => {
  const { client, close } = await connect();
  const { prompts } = await client.listPrompts();
  assert.deepEqual(
    prompts.map((p) => p.name),
    CONTRACT_PROMPTS,
  );
  assert.deepEqual(PROMPT_NAMES, CONTRACT_PROMPTS);
  const day = await client.getPrompt({ name: 'daytrade' });
  assert.equal(day.messages[0].role, 'user');
  assert.equal(day.messages[0].content.text, 'Backtest a day trade: enter at $100K, take +30%, stop at −20%, out after 6 h. Show the net result after costs.');
  const alert = await client.getPrompt({ name: 'alert' });
  assert.equal(alert.messages[0].content.text, 'Send me a Telegram message each time an OUTS agent calls a coin under $300K. Add the top reasons.');
  for (const p of PROMPTS) {
    const got = prompts.find((x) => x.name === p.name);
    assert.equal(got.title, p.title);
    for (const t of p.tools) assert.ok(CONTRACT_TOOLS.includes(t), `${p.name} uses a real tool: ${t}`);
  }
  await close();
});

test('each read tool calls its REST path (stub fetch)', async () => {
  const { call, fetch, close } = await connect();
  const id = FIXTURES.strategy.id;
  const cases = [
    ['get_live_calls', { status: 'exited', kind: 'strategy', limit: 10 }, 'GET', '/api/v1/calls', { status: 'exited', kind: 'strategy', limit: '10' }],
    ['get_call', { id: 7 }, 'GET', '/api/v1/calls/7', {}],
    ['get_coins_in_range', { sort: 'buyers1h' }, 'GET', '/api/v1/eligible', { sort: 'buyers1h', limit: '200' }],
    ['get_market', {}, 'GET', '/api/v1/market', {}],
    ['get_agents', {}, 'GET', '/api/v1/agents', {}],
    ['get_study', {}, 'GET', '/research/explore-v1.json', {}],
    ['get_trades', { open: true }, 'GET', '/api/v1/trades', { open: 'true', limit: '20' }],
    ['get_performance', { agent: 'house-rules', days: 3 }, 'GET', '/api/v1/agents/house-rules/performance', { days: '3' }],
    ['get_strategy', { id }, 'GET', `/api/v1/strategies/${id}`, {}],
  ];
  for (const [name, args, method, path, query] of cases) {
    fetch.calls.length = 0;
    const { r, data } = await call(name, args);
    assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`);
    assert.ok(data && typeof data === 'object', `${name} returns JSON`);
    const hit = fetch.calls.find((c) => c.path === path);
    assert.ok(hit, `${name} → ${path} (saw ${fetch.calls.map((c) => c.path).join(', ')})`);
    assert.equal(hit.method, method);
    assert.deepEqual(hit.query, query, `${name} query`);
  }
  fetch.calls.length = 0;
  await call('get_call', { leaf: LEAF });
  assert.deepEqual(
    fetch.calls.map((c) => c.path),
    [`/api/v1/receipts/${LEAF}`, '/api/v1/calls/7'],
  );
  await close();
});

const TOKEN = 'tok-tok-tok-tok-tok';

test('trading tools send the contract request', async () => {
  const { call, fetch, close } = await connect();
  const id = FIXTURES.strategy.id;
  const strategy = { entry: { ageMaxMin: 90, chg1hMin: 50 }, exit: { tp: 0.3, sl: 0.2, maxHoldMin: 360 } };
  const cases = [
    ['backtest', { strategy, sizeUsd: 2000 }, 'POST', '/api/v1/backtest', { strategy, sizeUsd: 2000 }],
    ['create_strategy', { name: 'fast movers', ...strategy }, 'POST', '/api/v1/strategies', { name: 'fast movers', ...strategy }],
    ['update_strategy', { id, token: TOKEN, name: 'faster' }, 'PATCH', `/api/v1/strategies/${id}`, { name: 'faster' }],
    ['run_strategy', { id, token: TOKEN, on: false }, 'POST', `/api/v1/strategies/${id}/run`, { on: false }],
  ];
  for (const [name, args, method, path, body] of cases) {
    fetch.calls.length = 0;
    const { r } = await call(name, args);
    assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`);
    assert.deepEqual([fetch.calls[0].method, fetch.calls[0].path, fetch.calls[0].body], [method, path, body], name);
    if (args.token) assert.equal(fetch.calls[0].headers.authorization, `Bearer ${TOKEN}`, `${name} sends the token as a header`);
  }
  const made = await call('create_strategy', { name: 'x', entry: {}, exit: {} });
  assert.equal(made.data.id, id);
  assert.ok(made.data.token, 'the token comes back once');
  await close();
});

test('results are compact JSON with lists capped at 50 (a price path keeps its ends)', async () => {
  const many = { calls: Array.from({ length: 120 }, (_, i) => ({ id: 120 - i, spark: Array.from({ length: 200 }, (_, j) => j) })) };
  const { call, close } = await connect(outsRoutes({ 'GET /api/v1/calls': { body: many } }));
  const { text, data } = await call('get_live_calls', { limit: 50 });
  assert.ok(!text.includes('\n') && !text.includes('  '), 'no pretty-printing');
  assert.equal(data.calls.length, 50);
  assert.equal(data.calls[0].id, 120, 'rows keep their order');
  assert.equal(data.calls[0].spark.length, 50);
  assert.equal(data.calls[0].spark[0], 0);
  assert.equal(data.calls[0].spark[49], 199);
  assert.deepEqual(compact({ a: undefined, b: [1, 2], c: { d: null } }), { b: [1, 2], c: { d: null } });
  await close();
});

test('errors reach the AI as words, and bad input is refused before any request', async () => {
  const { call, fetch, close } = await connect(outsRoutes({ 'GET /api/v1/market': { status: 429, body: { error: 'slow' } } }));
  const limited = await call('get_market');
  assert.equal(limited.r.isError, true);
  assert.match(limited.text, /rate limit.*Wait a minute/);

  fetch.calls.length = 0;
  for (const [name, args, re] of [
    ['get_live_calls', { limit: 0 }, /limit/],
    ['get_live_calls', { status: 'pending' }, /status/],
    ['get_live_calls', { limits: 5 }, /Unrecognized key/],
    ['get_performance', {}, /agent/],
    ['get_performance', { agent: '../../etc' }, /agent/],
    ['create_strategy', { name: 'x', entry: { mcapMin: 5 }, exit: {} }, /mcapMin/],
    ['create_strategy', { name: 'x', entry: { minMcap: 200000 }, exit: {} }, /minMcap/],
    ['create_strategy', { name: 'x', entry: {}, exit: { sl: 1.5 } }, /sl/],
    ['backtest', { strategy: { entry: {} }, sizeUsd: 250 }, /sizeUsd/],
    ['run_strategy', { id: 'k3j9x0aa', token: TOKEN }, /on/],
    ['run_strategy', { id: 'k3j9x0aa', token: 'short', on: true }, /token/],
  ]) {
    const { r, text } = await call(name, args);
    assert.equal(r.isError, true, `${name} ${JSON.stringify(args)} is refused`);
    assert.match(text, re, `${name}: ${text}`);
  }
  assert.equal(fetch.calls.length, 0, 'refused input never reaches OUTS');
  await close();
});
