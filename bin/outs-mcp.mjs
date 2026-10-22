#!/usr/bin/env node
// outs-mcp: the OUTS MCP server over stdio. Reads the public OUTS API (default https://outs.trade; OUTS_URL overrides).
//   npx -y outs-mcp
//   OUTS_URL=http://127.0.0.1:5631 node bin/outs-mcp.mjs
// stdout carries MCP messages only; notes go to stderr.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApi, DEFAULT_URL } from '../src/api.mjs';
import { createOutsServer } from '../src/server.mjs';
import { VERSION } from '../src/version.mjs';

const arg = process.argv[2];
if (arg === '--version' || arg === '-v') {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}
if (arg === '--help' || arg === '-h') {
  process.stderr.write(
    [
      `outs-mcp ${VERSION}: the OUTS MCP server (stdio).`,
      '',
      '  Claude Code   claude mcp add outs -- npx -y outs-mcp',
      '  Codex         codex mcp add outs -- npx -y outs-mcp',
      '  Hosted        https://mcp.outs.trade (Streamable HTTP, no install)',
      '',
      `  OUTS_URL      the OUTS site to read (default ${DEFAULT_URL})`,
      '',
      'Paper trades only: nothing here signs or sends a transaction.',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

let api;
try {
  api = createApi({ baseUrl: process.env.OUTS_URL || DEFAULT_URL });
} catch (e) {
  process.stderr.write(`outs-mcp: ${e.message}\n`);
  process.exit(1);
}

const server = createOutsServer(api, { name: 'outs', version: VERSION });
const transport = new StdioServerTransport();
const stop = async () => {
  await server.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.stdin.on('end', stop);

await server.connect(transport);
process.stderr.write(`outs-mcp ${VERSION} on stdio, reading ${api.baseUrl}\n`);
