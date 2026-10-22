// The hosted OUTS MCP: Streamable HTTP, stateless (no sessions), JSON responses (no SSE), on plain Node req/res.
// Each POST gets its own server and transport, so requests from different clients never share state.
//
//   import http from 'node:http';
//   import { createApi, handleMcp } from 'outs-mcp/hosted';
//   const api = createApi({ baseUrl: 'https://outs.trade' });
//   http.createServer((req, res) => handleMcp(req, res, undefined, { api })).listen(8080);
//
// Pass the body as undefined and the transport reads it, 64 KB at most. Put your own rate limit in front: every tool
// call is one request to the OUTS API. The hosted OUTS MCP at https://mcp.outs.trade runs this handler, with its own limits.
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createOutsServer } from './server.mjs';
import { VERSION } from './version.mjs';

export { createApi, OutsApiError, DEFAULT_URL } from './api.mjs';
export { TOOL_NAMES, PROMPT_NAMES } from './server.mjs';
export { VERSION } from './version.mjs';

/** The largest request body the transport reads itself (when the caller passes the body as undefined). */
export const MAX_BODY = 64 * 1024;

/** A JSON-RPC error body (for replies made outside the MCP server: limits, wrong method). */
export const rpcError = (message, id = null, code = -32000) => ({ jsonrpc: '2.0', error: { code, message }, id });

/**
 * Answers one MCP request. `body` is the parsed JSON body, or undefined: then the transport reads it from req
 * (64 KB at most).
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {unknown} body
 * @param {{ api: object, name?: string, version?: string, maxToolInputElements?: number }} o
 */
export async function handleMcp(req, res, body, { api, name = 'outs', version = VERSION, maxToolInputElements = 1000 } = {}) {
  if (!api) throw new TypeError('handleMcp needs { api } from createApi()');
  if (req.method !== 'POST') {
    const text = JSON.stringify(rpcError('Method not allowed: this MCP server is stateless, send each message with POST.'));
    res.writeHead(405, { allow: 'POST', 'content-type': 'application/json' });
    res.end(text);
    return;
  }
  const server = createOutsServer(api, { name, version, maxToolInputElements });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: MAX_BODY });
  res.on('close', () => {
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify(rpcError('The MCP server failed on this request. Try again.', null, -32603)));
    }
    throw e;
  }
}
