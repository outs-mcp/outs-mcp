// outs-mcp/hosted as a self-hoster mounts it: handleMcp(req, res, undefined, { api }) on a plain node:http server.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApi, handleMcp, MAX_BODY, TOOL_NAMES } from '../src/hosted.mjs';
import { CONTRACT_TOOLS, FIXTURES, outsRoutes, stubFetch } from './stub.mjs';

async function serve() {
  const api = createApi({ baseUrl: 'http://stub.local', fetch: stubFetch(outsRoutes()) });
  const server = http.createServer((req, res) => handleMcp(req, res, undefined, { api }).catch(() => {}));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, close: () => new Promise((r) => server.close(r)) };
}

test('hosted: the transport reads the body itself and answers over Streamable HTTP', async () => {
  const s = await serve();
  const client = new Client({ name: 'outs-test', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(s.url)));
    assert.deepEqual(TOOL_NAMES, CONTRACT_TOOLS);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name),
      CONTRACT_TOOLS,
    );
    const r = await client.callTool({ name: 'get_market', arguments: {} });
    assert.deepEqual(JSON.parse(r.content[0].text), FIXTURES.market);
  } finally {
    await client.close();
    await s.close();
  }
});

test('hosted: bodies over 64 KB get 413, and GET gets 405 with Allow: POST', async () => {
  const s = await serve();
  try {
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { pad: 'x'.repeat(MAX_BODY) } });
    const r = await fetch(s.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: big });
    assert.equal(r.status, 413);
    const get = await fetch(s.url, { headers: { accept: 'text/event-stream' } });
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');
  } finally {
    await s.close();
  }
});
