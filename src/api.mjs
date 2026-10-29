// OUTS REST client for the MCP tools: one method per tool, plain fetch, no keys, no state.
// Every failure is an OutsApiError whose message says in plain words what went wrong and what to do next.
//
//   const api = createApi({ baseUrl: 'https://outs.trade' });
//   const { calls } = await api.getLiveCalls({ status: 'live', limit: 10 });
import { VERSION } from './version.mjs';
import { FILES_FOR, STUDY_FILES, STUDY_PARTS, studyPart } from './study.mjs';
import { normReturns } from './returns.mjs';

export const DEFAULT_URL = 'https://outs.trade';
/** Lists never return more rows than this. */
export const MAX_ROWS = 50;
export const CALL_STATUS = ['live', 'hit', 'miss', 'closed', 'exited'];
export const AGENT_KINDS = ['house', 'outside', 'strategy'];
/** get_coins_in_range sort → the field in /api/v1/eligible rows (largest first). */
export const COIN_SORT = { buyers1h: 'buyers1h', vol1h: 'vol1hUsd', mcap: 'mcapUsd' };
export const SIZES = [100, 500, 2000];
/** backtest options: costs 'none' (price moves only) or 'legacy' (fees, impact, network fee); fill at the level or the close. */
export const BACKTEST_COSTS = ['none', 'legacy'];
export const BACKTEST_FILLS = ['level', 'close'];

const KEY = /^[A-Za-z0-9_-]{1,64}$/; // agent keys and strategy ids (a path segment: no dots, no slashes)
export const TOKEN = /^[A-Za-z0-9_-]{16,128}$/; // a strategy token, as create_strategy returns it
const LEAF = /^[0-9a-f]{64}$/i;
const CALL_ID = /^[1-9]\d{0,11}$/;

const MAX_BYTES = 8 << 20; // the largest reply read (the biggest OUTS replies are a few hundred KB)

/** The body as text, refused once it passes `max` bytes. */
async function readText(res, max, tooBig) {
  if (Number(res.headers?.get?.('content-length')) > max) throw tooBig();
  if (!res.body?.getReader) return res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw tooBig();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export class OutsApiError extends Error {
  constructor(message, { status = 0, code = '', path = '' } = {}) {
    super(message);
    this.name = 'OutsApiError';
    this.status = status;
    this.code = code;
    this.path = path;
  }
}

const rows = (limit, fallback = 20) => {
  const n = Math.round(Number(limit ?? fallback));
  return Math.max(1, Math.min(MAX_ROWS, Number.isFinite(n) ? n : fallback));
};

function originOf(url, what) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    throw new OutsApiError(`${what} "${url}" is not a web address. Use one like ${DEFAULT_URL}.`, { code: 'config' });
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new OutsApiError(`${what} must start with https:// or http://.`, { code: 'config' });
  return u.origin + u.pathname.replace(/\/+$/, '');
}

function key(v, what, hint) {
  const s = String(v ?? '');
  if (!KEY.test(s)) throw new OutsApiError(`${what} "${s.slice(0, 80)}" is not valid: use letters, digits, - or _ (1 to 64). ${hint}`, { code: 'input' });
  return s;
}

// short words for the error codes the OUTS API sends today
const CODE_WORDS = {
  agent: 'agent must be an agent key from get_agents',
  leaf: 'leaf must be 64 hex characters',
  badJson: 'the request body was not valid JSON',
  tooLarge: 'the request is larger than 64 KB',
  slow: 'rate limited',
};

/**
 * @param {object} [o]
 * @param {string} [o.baseUrl]   where the OUTS API lives (default https://outs.trade; env OUTS_URL in the CLI)
 * @param {string} [o.publicUrl] the address shown in messages and study links (default: baseUrl)
 * @param {typeof fetch} [o.fetch]
 * @param {number} [o.timeoutMs] per request (default 15 s)
 */
export function createApi({ baseUrl = DEFAULT_URL, publicUrl, fetch: doFetch = globalThis.fetch, timeoutMs = 15_000, userAgent = `outs-mcp/${VERSION}` } = {}) {
  const base = originOf(baseUrl, 'OUTS_URL');
  const site = publicUrl ? originOf(publicUrl, 'publicUrl') : base;
  if (typeof doFetch !== 'function') throw new TypeError('createApi needs a fetch function (Node 20+ has one built in)');
  const health = `${site}/api/health`;

  function failure(status, data, { method, path, retryAfter }) {
    const code = typeof data?.error === 'string' ? data.error.slice(0, 40) : '';
    const said = [data?.reason, data?.message].find((v) => typeof v === 'string' && v.trim());
    const why = said ? said.trim().replace(/[.\s]+$/, '').slice(0, 300) : CODE_WORDS[code];
    const opts = { status, code, path };
    if (status === 429) {
      const wait = Number(retryAfter) > 0 ? `${Math.ceil(Number(retryAfter))} s` : 'a minute';
      return new OutsApiError(`OUTS rate limit reached for this IP (240 reads, 20 strategy changes and 12 backtests a minute). Wait ${wait}, then try again.`, opts);
    }
    if (status === 405 || status === 501) return new OutsApiError(`This OUTS server does not support ${method} ${path} yet. It needs a newer OUTS server.`, opts);
    if (status === 401 || status === 403) return new OutsApiError(`OUTS refused the token${why && why !== code ? ` (${why})` : ''}. Use the token create_strategy returned for this strategy id.`, opts);
    if (status === 413) return new OutsApiError('The request is larger than OUTS accepts (64 KB). Send a smaller strategy.', opts);
    if (status >= 400 && status < 500) return new OutsApiError(`OUTS refused the request (${status}${code ? ` ${code}` : ''})${why ? `: ${why}` : ''}. Fix the input and try again.`, opts);
    if (status === 503 && path === '/api/v1/backtest' && (code === 'backtest' || code === 'busy') && said) return new OutsApiError(`OUTS could not do this now (${status}): ${why}.`, opts);
    return new OutsApiError(`OUTS had a server error (${status}). Try again in a minute; ${health} shows if it is up.`, opts);
  }

  /**
   * One REST call → parsed JSON. on404: the words for a 404 (string, or async fn → string).
   * optional: a 404, or a reply that is not JSON (the site's page for a missing file), returns null.
   */
  async function request(method, path, { query, body, token, on404, optional = false } = {}) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    const qs = params.toString();
    const url = `${base}${path}${qs ? `?${qs}` : ''}`;
    const headers = { accept: 'application/json', 'user-agent': userAgent };
    if (body !== undefined) headers['content-type'] = 'application/json';
    // a strategy token travels once, as a bearer header; no message ever repeats it
    if (token) headers.authorization = `Bearer ${token}`;

    const ctrl = new AbortController();
    const late = new OutsApiError(`OUTS took longer than ${Math.round(timeoutMs / 100) / 10} s to answer ${method} ${path}. Try again in a minute; ${health} shows if it is up.`, { code: 'timeout', path });
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(late); // first, so the race reports the timeout and not the abort it causes
        ctrl.abort();
      }, timeoutMs);
    });
    timeout.catch(() => {}); // the races below report it
    let res;
    let text;
    try {
      try {
        // a token never follows a redirect; reads may (http → https)
        const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal, redirect: token ? 'error' : 'follow' };
        res = await Promise.race([doFetch(url, init), timeout]);
      } catch (e) {
        if (e instanceof OutsApiError) throw e;
        if (ctrl.signal.aborted) throw late;
        if (e instanceof TypeError && /header/i.test(String(e.message))) {
          throw new OutsApiError('A request header was not valid. A token is 16 to 128 letters, digits, - or _.', { code: 'input', path });
        }
        let cause = String(e?.cause?.code || e?.cause?.message || e?.message || e);
        if (token) cause = cause.split(token).join('[token]');
        throw new OutsApiError(`Could not reach OUTS at ${site} (${cause.slice(0, 120)}). Try again in a minute; if you set OUTS_URL, check it.`, { code: 'network', path });
      }
      try {
        text = await Promise.race([readText(res, MAX_BYTES, () => new OutsApiError(`OUTS sent more than ${MAX_BYTES >> 20} MB for ${method} ${path}. Check that OUTS_URL points at an OUTS site.`, { code: 'tooBig', path })), timeout]);
      } catch (e) {
        if (e instanceof OutsApiError) throw e;
        if (ctrl.signal.aborted) throw late;
        throw new OutsApiError(`OUTS stopped in the middle of its answer to ${method} ${path}. Try again.`, { code: 'network', path });
      }
    } finally {
      clearTimeout(timer);
    }

    const type = String(res.headers?.get?.('content-type') ?? '');
    let data;
    if (/json/i.test(type)) {
      try {
        data = JSON.parse(text);
      } catch {
        data = undefined;
      }
    }
    if (res.status === 404) {
      if (optional) return null;
      const words = typeof on404 === 'function' ? await on404(data) : on404;
      throw new OutsApiError(words || `OUTS has no ${path}. This needs a newer OUTS server.`, { status: 404, code: data?.error ?? 'notFound', path });
    }
    if (!res.ok) throw failure(res.status, data, { method, path, retryAfter: res.headers?.get?.('retry-after') });
    if (data === undefined) {
      if (optional) return null;
      throw new OutsApiError(`OUTS answered ${method} ${path} with something other than JSON. Check that OUTS_URL points at an OUTS site (now ${site}).`, { status: res.status, code: 'notJson', path });
    }
    // API replies carry results under their gross names (ret, mean, …); an older server's *Net names are read as those
    return path.startsWith('/api/') ? normReturns(data) : data;
  }

  // the trading endpoints are new: a 404 from them means "not on this server yet" unless the trades list answers
  const tradingLive = async () => {
    try {
      await request('GET', '/api/v1/trades', { query: { limit: 1 } });
      return true;
    } catch (e) {
      if (e instanceof OutsApiError && (e.status === 404 || e.status === 405)) return false;
      throw e; // a rate limit or an outage: say that instead
    }
  };
  const NOT_YET = 'Paper trading is not live on this OUTS server yet. It needs a newer OUTS server; try again later.';
  const strategyMissing = (id) => async () => ((await tradingLive()) ? `OUTS has no strategy "${id}". Use the id create_strategy returned.` : NOT_YET);
  const tokenOf = (t, tool) => {
    if (!t) throw new OutsApiError(`${tool} needs the token create_strategy returned.`, { code: 'input' });
    if (typeof t !== 'string' || !TOKEN.test(t)) throw new OutsApiError('That token is not valid: a token is 16 to 128 letters, digits, - or _, as create_strategy returned it.', { code: 'input' });
    return t;
  };
  const sizeOf = (v) => {
    if (v === undefined || v === null) return undefined;
    if (!SIZES.includes(Number(v))) throw new OutsApiError(`sizeUsd must be one of ${SIZES.join(', ')}.`, { code: 'input' });
    return Number(v);
  };

  async function getCall({ id, leaf } = {}) {
    if ((id === undefined || id === null || id === '') && !leaf) throw new OutsApiError('get_call needs an id or a leaf. Both come from get_live_calls.', { code: 'input' });
    let callId = id;
    let receipt = null;
    if (callId === undefined || callId === null || callId === '') {
      if (!LEAF.test(String(leaf))) throw new OutsApiError('leaf must be 64 hex characters, as get_live_calls shows it.', { code: 'input' });
      receipt = await request('GET', `/api/v1/receipts/${String(leaf).toLowerCase()}`, { on404: 'OUTS has no call with this leaf. Copy the leaf from get_live_calls.' });
      callId = receipt?.call?.id;
    }
    if (!CALL_ID.test(String(callId))) throw new OutsApiError(`Call id "${String(callId).slice(0, 40)}" is not valid: it is a whole number from get_live_calls.`, { code: 'input' });
    try {
      return await request('GET', `/api/v1/calls/${callId}`, {
        on404: `OUTS has no call ${callId}, or this OUTS server is too old for get_call. Check the id with get_live_calls.`,
      });
    } catch (e) {
      // the call exists (its receipt answered), so the 404 means an older server: hand back the receipt
      if (receipt && e instanceof OutsApiError && e.status === 404) {
        return { ...receipt, note: 'This OUTS server is older than this MCP: reasons and the coin at call time need GET /api/v1/calls/:id. This is the call receipt.' };
      }
      throw e;
    }
  }

  async function getStudy({ part = 'summary' } = {}) {
    if (!STUDY_PARTS.includes(part)) throw new OutsApiError(`part must be one of ${STUDY_PARTS.join(', ')}.`, { code: 'input' });
    const names = FILES_FOR[part];
    const docs = { current: null, v1: null, alpha: null, exits: null };
    const got = await Promise.all(names.map((n) => request('GET', STUDY_FILES[n], { optional: true })));
    names.forEach((n, i) => (docs[n] = got[i] && typeof got[i] === 'object' && !Array.isArray(got[i]) ? got[i] : null));
    const rules = part === 'exits' ? await request('GET', '/api/v1/rules', { optional: true }).catch(() => null) : null;
    const src = Object.fromEntries(Object.entries(STUDY_FILES).map(([n, p]) => [n, `${site}${p}`]));
    return studyPart(part, docs, { src, rules });
  }

  return {
    baseUrl: base,
    publicUrl: site,
    request,

    /** rug_check → GET /api/v1/rug/:mint */
    rugCheck: async ({ mint } = {}) => {
      if (typeof mint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) throw new OutsApiError('mint must be a Solana address (32-44 base58 characters), the coin CA.', { code: 'input' });
      return request('GET', `/api/v1/rug/${mint}`, { on404: 'This OUTS server is older than this MCP: rug_check needs GET /api/v1/rug/:mint. get_live_calls still shows each call\'s rug verdict.' });
    },

    /** get_live_calls → GET /api/v1/calls */
    getLiveCalls: async ({ status, agent, kind, all, limit } = {}) => {
      if (status !== undefined && !CALL_STATUS.includes(status)) throw new OutsApiError(`status must be one of ${CALL_STATUS.join(', ')}.`, { code: 'input' });
      if (kind !== undefined && !AGENT_KINDS.includes(kind)) throw new OutsApiError(`kind must be one of ${AGENT_KINDS.join(', ')}.`, { code: 'input' });
      const a = agent === undefined ? undefined : key(agent, 'agent', 'Agent keys come from get_agents.');
      if (all !== undefined && typeof all !== 'boolean') throw new OutsApiError('all must be true or false.', { code: 'input' });
      // originals only unless all: true (the server's default too); each row says original and originality.reasons
      return request('GET', '/api/v1/calls', { query: { status, agent: a, kind, all: all ? '1' : undefined, limit: rows(limit) } });
    },

    /** get_call → GET /api/v1/calls/:id (a leaf is looked up through GET /api/v1/receipts/:leaf first) */
    getCall,

    /** get_coins_in_range → GET /api/v1/eligible, sorted here so every sort sees the whole range */
    getCoinsInRange: async ({ sort = 'vol1h', limit } = {}) => {
      const field = COIN_SORT[sort];
      if (!field) throw new OutsApiError(`sort must be one of ${Object.keys(COIN_SORT).join(', ')}.`, { code: 'input' });
      const data = await request('GET', '/api/v1/eligible', { query: { sort, limit: 200 } });
      const val = (c) => (typeof c?.[field] === 'number' ? c[field] : -Infinity);
      const coins = (Array.isArray(data?.coins) ? [...data.coins] : []).sort((a, b) => val(b) - val(a));
      return { ...data, sort, total: coins.length, coins: coins.slice(0, rows(limit)) };
    },

    /** get_market → GET /api/v1/market */
    getMarket: async () => request('GET', '/api/v1/market'),

    /** get_agents → GET /api/v1/agents */
    getAgents: async () => request('GET', '/api/v1/agents'),

    /** get_study → /research/*.json */
    getStudy,

    /** get_trades → GET /api/v1/trades */
    getTrades: async ({ agent, open, limit } = {}) => {
      const a = agent === undefined ? undefined : key(agent, 'agent', 'Agent keys come from get_agents.');
      return request('GET', '/api/v1/trades', { query: { agent: a, open: typeof open === 'boolean' ? String(open) : undefined, limit: rows(limit) }, on404: NOT_YET });
    },

    /** get_performance → GET /api/v1/agents/:key/performance */
    getPerformance: async ({ agent, days } = {}) => {
      const a = key(agent, 'agent', 'Agent keys come from get_agents.');
      const d = days === undefined ? undefined : Math.max(1, Math.min(30, Math.round(Number(days)) || 7));
      return request('GET', `/api/v1/agents/${a}/performance`, {
        query: { days: d },
        on404: async () => {
          // a known agent with no performance route = an older server; otherwise the agent is unknown
          const known = await request('GET', `/api/v1/agents/${a}`, { optional: true });
          return known ? NOT_YET : `OUTS has no agent "${a}". Agent keys come from get_agents (strategies run as strat-<id>).`;
        },
      });
    },

    /** backtest → POST /api/v1/backtest (results in %) */
    backtest: async ({ strategy, id, sizeUsd, costs, fill, limit } = {}) => {
      if (!strategy && (id === undefined || id === null)) throw new OutsApiError('backtest needs a strategy (entry and exit) or the id of a saved strategy.', { code: 'input' });
      const sid = id === undefined || id === null ? undefined : key(id, 'id', 'Use the id create_strategy returned.');
      if (costs !== undefined && !BACKTEST_COSTS.includes(costs)) throw new OutsApiError('costs must be none (price moves only, the default) or legacy (pool fees, price impact, network fee).', { code: 'input' });
      if (fill !== undefined && !BACKTEST_FILLS.includes(fill)) throw new OutsApiError('fill must be level (the default) or close.', { code: 'input' });
      if (limit !== undefined && !(Number.isInteger(limit) && limit >= 0 && limit <= MAX_ROWS)) throw new OutsApiError(`limit must be a whole number from 0 to ${MAX_ROWS}.`, { code: 'input' });
      return request('POST', '/api/v1/backtest', { body: { strategy, id: sid, sizeUsd: sizeOf(sizeUsd), costs, fill, limit }, on404: sid ? strategyMissing(sid) : NOT_YET });
    },

    /** create_strategy → POST /api/v1/strategies */
    createStrategy: async ({ name, entry, exit, sizeUsd } = {}) => request('POST', '/api/v1/strategies', { body: { name, entry, exit, sizeUsd: sizeOf(sizeUsd) }, on404: NOT_YET }),

    /** update_strategy → PATCH /api/v1/strategies/:id */
    updateStrategy: async ({ id, token, name, entry, exit, sizeUsd } = {}) => {
      const sid = key(id, 'id', 'Use the id create_strategy returned.');
      const t = tokenOf(token, 'update_strategy');
      const patch = { name, entry, exit, sizeUsd: sizeOf(sizeUsd) };
      if (Object.values(patch).every((v) => v === undefined)) throw new OutsApiError('Give at least one of name, entry, exit or sizeUsd to change.', { code: 'input' });
      return request('PATCH', `/api/v1/strategies/${sid}`, { body: patch, token: t, on404: strategyMissing(sid) });
    },

    /** run_strategy → POST /api/v1/strategies/:id/run */
    runStrategy: async ({ id, token, on } = {}) => {
      const sid = key(id, 'id', 'Use the id create_strategy returned.');
      const t = tokenOf(token, 'run_strategy');
      if (typeof on !== 'boolean') throw new OutsApiError('on must be true (run) or false (stop).', { code: 'input' });
      return request('POST', `/api/v1/strategies/${sid}/run`, { body: { on }, token: t, on404: strategyMissing(sid) });
    },

    /** get_strategy → GET /api/v1/strategies/:id */
    getStrategy: async ({ id } = {}) => {
      const sid = key(id, 'id', 'Use the id create_strategy returned.');
      return request('GET', `/api/v1/strategies/${sid}`, { on404: strategyMissing(sid) });
    },
  };
}
