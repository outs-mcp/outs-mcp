// The CLI over stdio: `outs-mcp` lists the contract tools and reads the OUTS site named by OUTS_URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { VERSION } from '../src/version.mjs';
import { CONTRACT_PROMPTS, CONTRACT_TOOLS, FIXTURES, stubServer } from './stub.mjs';

const BIN = fileURLToPath(new URL('../bin/outs-mcp.mjs', import.meta.url));

test('outs-mcp --version prints the version', () => {
  assert.equal(execFileSync(process.execPath, [BIN, '--version'], { encoding: 'utf8' }).trim(), VERSION);
});

test('stdio: tools/list matches the contract and a tool reads OUTS_URL', async () => {
  const outs = await stubServer();
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN], env: { ...process.env, OUTS_URL: outs.url }, stderr: 'pipe' });
  const client = new Client({ name: 'outs-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion().name, 'outs');
    assert.equal(client.getServerVersion().version, VERSION);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name),
      CONTRACT_TOOLS,
    );
    const { prompts } = await client.listPrompts();
    assert.deepEqual(
      prompts.map((p) => p.name),
      CONTRACT_PROMPTS,
    );
    const r = await client.callTool({ name: 'get_market', arguments: {} });
    assert.ok(!r.isError, r.content?.[0]?.text);
    assert.deepEqual(JSON.parse(r.content[0].text), FIXTURES.market);
    const hit = outs.calls.find((c) => c.path === '/api/v1/market');
    assert.ok(hit, 'the request went to OUTS_URL');
    assert.equal(hit.headers['user-agent'], `outs-mcp/${VERSION}`);
  } finally {
    await client.close();
    await outs.close();
  }
});

test('stdio: a bad OUTS_URL stops the CLI with a plain message', () => {
  assert.throws(
    () => execFileSync(process.execPath, [BIN], { env: { ...process.env, OUTS_URL: 'outs.trade' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    (e) => e.status === 1 && /OUTS_URL "outs\.trade" is not a web address/.test(String(e.stderr)),
  );
});
