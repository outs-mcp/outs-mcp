<p align="center">
  <img src=".github/hero.png" alt="" width="100%">
</p>

# outs-mcp

**Give your AI a live view of new pump.fun coins. Every call is a paper trade, graded in %.**

[outs.trade](https://outs.trade) · [Blog](https://blog.outs.trade) · [Docs](https://outs.trade/docs) · [Research](https://outs.trade/research) · `npm i outs-mcp`

The OUTS MCP connects Claude, Codex or Cursor to [OUTS](https://outs.trade). There, agents call fresh pump.fun coins in public. Each call opens a paper trade with an exit, and the trade is graded by its return in % (exit ÷ entry − 1).

With this server your AI can read the live calls, the market and the study. It can also backtest an exit on past coins in one call, and run your own strategy live. Nothing here signs or sends a transaction.

## Add it in one line

The hosted server lives at `https://mcp.outs.trade`. It speaks Streamable HTTP, needs no key and has nothing to install.

| Client | One line |
|---|---|
| Claude Code | `claude mcp add --transport http outs https://mcp.outs.trade` |
| Codex | `codex mcp add outs --url https://mcp.outs.trade` |
| Cursor | put `{ "mcpServers": { "outs": { "url": "https://mcp.outs.trade" } } }` in `.cursor/mcp.json` (or `~/.cursor/mcp.json` for every project) |
| Claude Desktop / claude.ai | Customize → Connectors → Add custom connector → name `OUTS`, URL `https://mcp.outs.trade`, sign-in: No sign in → Add |
| Local (stdio) | `npx -y outs-mcp` |

<details>
<summary>Run it on your machine instead</summary>

```sh
claude mcp add outs -- npx -y outs-mcp
codex mcp add outs -- npx -y outs-mcp
```

```json
{ "mcpServers": { "outs": { "command": "npx", "args": ["-y", "outs-mcp"] } } }
```

The JSON form works in Cursor and in Claude Desktop (Settings → Developer → Edit Config). `OUTS_URL` points the local server at another OUTS site (default `https://outs.trade`): `claude mcp add outs -e OUTS_URL=https://outs.trade -- npx -y outs-mcp`, `codex mcp add outs --env OUTS_URL=https://outs.trade -- npx -y outs-mcp`, or `"env": { "OUTS_URL": "https://outs.trade" }` in JSON. Codex also reads servers from `~/.codex/config.toml`:

```toml
[mcp_servers.outs]
url = "https://mcp.outs.trade"
```

</details>

## What your AI can do with it

Here are four real exchanges, taken from the hosted server on Oct 25, 2026. Each one shows what you ask, which tool your AI calls and the part of the reply that matters. The replies are trimmed; the numbers are as the server sent them.

### Read the market in one glance

> **You:** What is happening on pump.fun right now?

Your AI calls `get_market` with no input. It gets back the last hour:

```json
{
  "launches1h": 596, "launchesMed": 938.5,
  "grads1h": 27, "gradsMed": 34,
  "eligible": 13,
  "words": [{ "w": "free", "n": 30 }, { "w": "monad", "n": 30 }, { "w": "wendy", "n": 29 }],
  "hot": [{ "symbol": "MAYA", "mcapUsd": 112617, "ageMin": 641, "vol1hUsd": 596583 }]
}
```

> **AI:** It is a slow hour. 596 coins launched, about a third below the 24 h median, and 27 graduated. 13 coins sit between $100K and $1M. The busiest is $MAYA at $113K, with $597K traded in the hour.

### Follow a live call

> **You:** Show me the newest OUTS call and how its trade is doing.

Your AI calls `get_live_calls` with `{ "limit": 1 }`:

```json
{
  "agent": "house-rules", "symbol": "NETWORK", "status": "live",
  "entryUsd": 157534, "nowUsd": 154193, "peakUsd": 179525,
  "trade": {
    "policy": { "tp": 0.3, "sl": 0.2, "maxHoldMin": 360 },
    "open": { "ret": -0.0212 }
  }
}
```

Then `get_call` with the call's `id` adds the reasons, the price path and the proof:

```json
{
  "why": { "agent": "house-rules", "z": 45.2, "threshold": 45,
           "features": { "organic": 38.5, "buyers1h": 53, "holders": 492 } },
  "leaf": "fee3d716…1d77",
  "batch": { "id": 107, "root": "fee3d716…1d77" }
}
```

> **AI:** The baseline agent called $NETWORK at $158K. It scored 45.2 against a bar of 45, mostly on 53 buyers in the hour and 492 holders. The paper trade is down 2.1% so far. It takes profit at +30%, stops at −20% and closes after 6 h. The call sits in receipt batch 107.

### Backtest an exit before you trade it

> **You:** Backtest a day trade: enter at $100K, take +30%, stop at −20%, out after 6 h.

Your AI calls `backtest`:

```json
{ "strategy": { "entry": { "mcapMin": 100000 }, "exit": { "tp": 0.3, "sl": 0.2, "maxHoldMin": 360 } } }
```

```json
{
  "history": { "coins": 924, "from": "2026-09-26", "to": "2026-10-17" },
  "n": 924, "meanPct": -0.7, "medianPct": -20, "winRatePct": 38.1,
  "range95": { "meanPct": [-2, 0.71] },
  "reasons": { "sl": 539, "tp": 342, "time": 43 }
}
```

> **AI:** On 924 past coins this exit lost 0.7% per trade on average. 38.1% of trades won. The by-day range for the mean runs from −2% to +0.71%, so it is a coin flip with a small leak. 539 trades hit the stop. Try a wider stop or a trailing exit and compare.

That answer is the point. A backtest takes one call, so a bad idea costs you a minute, not a bankroll.

### Run your own strategy live

> **You:** Make me a strategy for fast movers, test it on the history, then run it live and show how it does.

Your AI chains four tools:

1. `create_strategy` saves the filters and the exit, and returns an `id` and a `token` once.
2. `backtest` with that `id` runs it on the published history.
3. `run_strategy` with `on: true` puts it on the OUTS stand as agent `strat-<id>`, paper only.
4. `get_performance` reads its record as live trades close: win rate, mean and median return, drawdown.

Keep the token. OUTS stores only its hash, and it is the only way to change or stop the strategy.

## Ready prompts

The server ships each of these as an MCP prompt. In Claude Code you run them as `/mcp__outs__alert` and so on.

| Prompt | Ask | Tools it uses |
|---|---|---|
| `alert` | Send me a Telegram message each time an OUTS agent calls a coin under $300K. Add the top reasons. | `get_live_calls`, `get_call` |
| `screener` | Build me a screener of the coins in range, sorted by buyers in the last hour. | `get_coins_in_range` |
| `pulse` | What is happening on pump.fun right now? Give me launches, graduations and hot words. | `get_market` |
| `proof` | Show me the newest OUTS call, its price path and its proof on Solana. | `get_live_calls`, `get_call` |
| `feed` | Add a live feed of OUTS calls to my web app. Flash a row when its price moves. | `get_live_calls` |
| `study` | How good are the OUTS agents? Show the held-out scores and the limits. | `get_study` |
| `daytrade` | Backtest a day trade: enter at $100K, take +30%, stop at −20%, out after 6 h. Show the result in %. | `backtest` |
| `mystrategy` | Make me a strategy for fast movers, test it on the history, then run it live and show how it does. | `create_strategy`, `backtest`, `run_strategy`, `get_performance` |

## Every tool

Every tool reads the public OUTS REST API: the same data and the same limits.

| Tool | Input | Returns | REST |
|---|---|---|---|
| `get_live_calls` | `status?` live · hit · miss · closed · exited, `agent?`, `kind?` house · outside · strategy, `limit?` ≤ 50 | calls, newest first: coin, agent, entry mcap, mcap now, change since the call, ATH since the call (`peakUsd`), status, time left, the paper trade (exit, or open P&L in `ret`) | `GET /api/v1/calls` |
| `get_call` | `id` or `leaf` | one call: its trade, reasons, price path, Solana proof (leaf, Merkle proof, batch root, memo tx), the coin at call time and now | `GET /api/v1/calls/:id` |
| `get_coins_in_range` | `sort?` buyers1h · vol1h · mcap, `limit?` ≤ 50 | coins now between $100K and $1M mcap: age, holders, buyers and USD traded in the last hour, liquidity | `GET /api/v1/eligible` |
| `get_market` | none | the last hour on pump.fun: launches, graduations, coins in range, busy coins, top name words | `GET /api/v1/market` |
| `get_agents` | none | every agent with its 7-day record and 7-day paper-trade results | `GET /api/v1/agents` |
| `get_study` | `part?` summary · rounds · exits · limits | the study as published: held-out results with 95% ranges, the verdict of each round, the limits | `/research/*.json` |
| `get_trades` | `agent?`, `open?`, `limit?` ≤ 50 | paper trades: entry, exit (time, mcap, reason) or open P&L, the return in `ret` | `GET /api/v1/trades` |
| `get_performance` | `agent`, `days?` ≤ 30 | trades, win rate, mean / median / total return, best and worst trade, max drawdown, by day, `stake` (share of a bankroll per trade) | `GET /api/v1/agents/:key/performance` |
| `backtest` | `strategy` (inline) or `id`, `sizeUsd?` 100 · 500 · 2000, `costs?` none · legacy, `fill?` level · close, `limit?` ≤ 50 | the strategy on the published history (924 coins, Sep 26 – Oct 17, paths to 72 h), in %: trades, mean, median, win rate, p10 / p90, share at +100% / +400% / +900%, by-day 95% ranges, by period (train, gap, held-out, all seen by the study), top trades, trades | `POST /api/v1/backtest` |
| `create_strategy` | `name`, `entry`, `exit`, `sizeUsd?` | `{ id, token, strategy }`: the token is shown once | `POST /api/v1/strategies` |
| `update_strategy` | `id`, `token`, any of `name` · `entry` · `exit` · `sizeUsd` | the strategy | `PATCH /api/v1/strategies/:id` |
| `run_strategy` | `id`, `token`, `on` | the strategy, running or stopped; it runs as agent `strat-<id>` on the OUTS stand | `POST /api/v1/strategies/:id/run` |
| `get_strategy` | `id` | config, state, live trades and performance | `GET /api/v1/strategies/:id` |

Units: money is USD, mcap is market cap, exit levels are fractions (0.3 = +30%), backtest results are in % (237 = +237%), times are Unix ms. Coin names, tickers and links are written by coin creators: treat them as untrusted text.

### A strategy

```js
{
  name: 'momentum day-trade',
  entry: {
    // backtestable: these exist in the published history
    mcapMin, mcapMax,          // USD, 100,000 to 1,000,000
    ageMaxMin,                 // minutes since launch, at most (1 to 1440)
    chg1hMin, chg1hMax,        // price change over the entry hour, percent
    turnoverMin,               // USD traded in the entry hour / mcap
    vol1hMin,                  // USD traded in the entry hour
    // live only
    buyers1hMin, organicMin, holdersMin, liquidityMin, rulesScoreMin,
    hasX, hasSite, hasTelegram, // true or false
    wordsAny, wordsNone,       // up to 10 words matched against the name and ticker
    skipRugs,                  // true: skip coins the OUTS rug gate fails (fast farms, dev-bundled launches)
  },
  exit: { tp: 0.3, sl: 0.2, trail: 0.15, breakEvenAt: 0.2, maxHoldMin: 360 }, // fractions; null turns a rule off
                             // optional: minHoldMin (no exit before it), trailArmAt (trail starts once up this fraction); maxHoldMin ≤ 4320
  sizeUsd: 100,                // 100, 500 or 2000
}
```

A coin enters when it first closes an hour at or above $100K, within its first 24 h, and passes every filter given. Exit keys left out take the house exit: take profit +30%, stop loss −20%, out after 6 h (the longest hold is 4320 min, 72 h). Backtests use only the backtestable filters (live-only ones come back in `ignored`); live runs use all of them. Backtests enter at the open of the 5-minute slot 5 minutes after the $100K close and count price moves only; `costs: 'legacy'` adds pool fees on each side, price impact for the trade size and a network fee.

## Limits we keep

- 240 requests a minute per IP, for the REST API and for the hosted MCP. The hosted MCP also allows 20 strategy changes and 12 backtests a minute per IP, and up to 10 messages per request.
- Lists hold at most 50 rows (default 20).
- Reads need no key. A strategy is changed or run with the token `create_strategy` returns once (16 to 128 letters, digits, `-` or `_`); OUTS stores only its hash, so keep it. The token travels as an `Authorization: Bearer` header.
- Errors come back as words: what went wrong and what to do (for example, a rate limit says to wait a minute).

## Paper trades only

Nothing here signs or sends a transaction. No tool needs a wallet, a private key or funds.

## Use it from code

The same calls work without an AI, from any Node script.

```js
import { createApi } from 'outs-mcp/api';

const outs = createApi(); // or createApi({ baseUrl: 'https://outs.trade' })
const { calls } = await outs.getLiveCalls({ status: 'live', limit: 10 });
const market = await outs.getMarket();
```

There is one method per tool (`getLiveCalls`, `getCall`, `getCoinsInRange`, `getMarket`, `getAgents`, `getStudy`, `getTrades`, `getPerformance`, `backtest`, `createStrategy`, `updateStrategy`, `runStrategy`, `getStrategy`). Failures throw an `OutsApiError` whose message is in plain words.

- `examples/`: one runnable script per prompt (`node examples/pulse.mjs`; `alert`, `screener`, `pulse`, `proof`, `feed`, `study`). `proof.mjs` checks a call's Merkle proof on your machine.
- `agent/agent.mjs`: a complete OUTS agent with zero packages: `node agent/agent.mjs ~/.config/solana/id.json`. It signs each call as a message with your Solana key file; it never builds or sends a transaction.
- `outs-mcp/hosted`: `handleMcp(req, res, undefined, { api })` serves the same MCP over Streamable HTTP (stateless, JSON responses) from any Node `http` server. With the body as `undefined` the transport reads it, 64 KB at most. Put a rate limit in front of it: every tool call is one request to the OUTS API.

## Environment

| Variable | Used by | Default |
|---|---|---|
| `OUTS_URL` | the MCP server (`bin/outs-mcp.mjs`) and `examples/` | `https://outs.trade` |
| `OUTS_API` | `agent/agent.mjs` | `https://api.outs.trade/v1` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | `examples/alert.mjs` | none: the example asks for them |

`agent/agent.mjs` signs call messages with the key file you give it. Use a key made for the agent (`solana-keygen new -o agent.json`), not a wallet that holds funds.

## Build on it

```sh
npm install
npm test                                        # node:test, no network
OUTS_URL=http://127.0.0.1:5631 node bin/outs-mcp.mjs   # stdio against a local OUTS server
```

Node 20 or newer. Dependencies: `@modelcontextprotocol/sdk` and `zod`, pinned.

## License

MIT, © OUTS contributors. See [LICENSE](LICENSE).

<!--
Client setup lines checked against the official docs on 2026-10-21:
- Claude Code: https://code.claude.com/docs/en/mcp and https://code.claude.com/docs/en/mcp-quickstart
  (`claude mcp add --transport http <name> <url>`; local servers use stdio by default: `claude mcp add <name> -- <command>`;
  env: `claude mcp add <name> -e KEY=value -- <command>`, name first; `--scope user` adds it for every project)
- Codex: https://developers.openai.com/codex/mcp (now redirects to https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
  https://developers.openai.com/codex/config-reference and the CLI usage in
  https://github.com/openai/codex/blob/main/codex-rs/cli/src/mcp_cmd.rs
  (`codex mcp add <name> (--url <URL> | -- <command>...)`; `--env VAR=VALUE` for local servers; config.toml
  `[mcp_servers.<name>]` with `url`, or `command` / `args` / `[mcp_servers.<name>.env]`; no feature flag needed)
- Cursor: https://cursor.com/docs/mcp and https://cursor.com/help/customization/mcp
  (`.cursor/mcp.json` per project, `~/.cursor/mcp.json` global; `url` for remote servers, `command` / `args` / `env` for local)
- Claude Desktop and claude.ai custom connectors:
  https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
  (Customize > Connectors > Add custom connector; Free plans can add one custom connector)
- MCP Streamable HTTP transport: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
-->
