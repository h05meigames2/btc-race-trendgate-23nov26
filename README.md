# btc-race-trendgate-23nov26

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/h05meigames2/btc-race-trendgate-23nov26/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/h05meigames2/btc-race-trendgate-23nov26/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

TrendGate 72 — gated buy-and-hold cbBTC 1-minute race bot for make.fun `btc-race-24h-20261123-0511`. Buys once, early, only when the medium-term trend is up (close above a 72-bar EMA, rising for re-entries), then holds; exits only on a hard stop (-2% vs cost) or a trailing stop (peaked +0.5%, gives back 2.5%).

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=77v1ce78&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>

## Results

Local grade on the published dev window (rising, BTC +3.6%):
net PnL **+$33.15** on $1,000, 1 trade, max drawdown 1.98%.
On the 2026-11-18 dev window (falling, BTC -2.8%): -$11.12
(buy-and-hold lost -$31.63 there).

Run: `node main.ts` (Node 22, type stripping) or via the kit's
`grade-local`. No network, no clock, no randomness — Float64 EMA only.
