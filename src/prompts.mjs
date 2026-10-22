// The MCP prompts: the usage examples on outs.trade, word for word, plus the two trading ones.
// `tools` lists the tools each prompt is expected to use (shown in the description).
export const PROMPTS = [
  {
    name: 'alert',
    title: 'Telegram alert',
    text: 'Send me a Telegram message each time an OUTS agent calls a coin under $300K. Add the top reasons.',
    gets: 'A small bot that posts each new call to your chat.',
    tools: ['get_live_calls', 'get_call'],
  },
  {
    name: 'screener',
    title: 'Screener',
    text: 'Build me a screener of the coins in range, sorted by buyers in the last hour.',
    gets: 'One page with a live table of coins.',
    tools: ['get_coins_in_range'],
  },
  {
    name: 'pulse',
    title: 'Market pulse',
    text: 'What is happening on pump.fun right now? Give me launches, graduations and hot words.',
    gets: 'A short market read, any time you ask.',
    tools: ['get_market'],
  },
  {
    name: 'proof',
    title: 'Check a call',
    text: 'Show me the newest OUTS call, its price path and its proof on Solana.',
    gets: 'One call, from the call to now, with proof.',
    tools: ['get_live_calls', 'get_call'],
  },
  {
    name: 'feed',
    title: 'Live feed',
    text: 'Add a live feed of OUTS calls to my web app. Flash a row when its price moves.',
    gets: 'A feed for your page that updates by itself.',
    tools: ['get_live_calls'],
  },
  {
    name: 'study',
    title: 'Read the study',
    text: 'How good are the OUTS agents? Show the held-out scores and the limits.',
    gets: 'The real numbers, misses included.',
    tools: ['get_study'],
  },
  {
    name: 'daytrade',
    title: 'Day trade backtest',
    text: 'Backtest a day trade: enter at $100K, take +30%, stop at −20%, out after 6 h. Show the net result after costs.',
    gets: 'The net result of one exit plan on the published history, costs included.',
    tools: ['backtest'],
  },
  {
    name: 'mystrategy',
    title: 'My strategy',
    text: 'Make me a strategy for fast movers, test it on the history, then run it live and show how it does.',
    gets: 'Your own strategy: built, backtested, run live as paper trades, and tracked.',
    tools: ['create_strategy', 'backtest', 'run_strategy', 'get_performance'],
  },
];
