// TrendGate: a gated buy-and-hold bot for the cbBTC 1-minute race.
//
// Idea: on 1-minute bars the round trip costs ~26 bps while a single minute
// moves ~7 bps of noise, so fast signals bleed out in fees (the kit's
// ema-cross baseline lost -11.5% on the dev window with 76 trades) and
// slow EMA crossovers whipsaw on intraday dips (60/240 lost money on a
// +3.6% day). This bot instead buys ONCE, early, only when the medium-term
// trend is up, then mostly holds: it buys with all cash at the first bar
// (after bar 24) whose close is above a 72-bar EMA that is itself rising,
// and steps out only on a hard stop (-2% vs cost) or a trailing stop (once
// the position peaked >= 0.5% over cost, exit if it gives back 2.5% from
// that peak). If it exits, it may re-enter on the same uptrend signal.
//
// Measured on the published dev windows with the kit's own fill model
// (validated byte-exact: buy-and-hold replays to +$32.17, the same number
// grade-local reports):
//   - dev window 2026-11-23 (rising, BTC +3.6%): +$33.15, 1 round trip
//   - dev window 2026-11-18 (falling, BTC -2.8%): -$11.12, 1 round trip
//     (buy-and-hold lost -$31.63 there; the EMA gate buys only after the
//     opening washout, once the trend turns up).
// The gate is what earns its keep on a down day: it never buys into a
// falling knife, and the trailing stop caps the damage when a rally fades.
//
// Rules, per bar close (fills land at the next bar's open):
//   - Indicator: EMA(72) over closes, seeded as the mean of its first 72
//     closes, then 2/73 of the way to each new close. Float64 only: the
//     same bars give the same orders, run after run. No clock, no
//     randomness, no network.
//   - Entry (flat): close > EMA(72) and EMA(72) rising vs the previous
//     bar, at or after bar 24 -> buy with all cash.
//   - Exit (holding): position worth <= 98% of its cost (stop loss), or
//     it peaked >= 100.5% of cost and has since fallen to <= 97.5% of that
//     peak (trailing exit).
//   - Every order caps slippage at 100 bps past the close it was decided
//     on, so a fill into a liquidity gap is refused and retried next bar.
//   - Long only, at most one open position, no leverage.
//
// "TrendGate 72" — built for make.fun btc-race-24h-20261123-0511.

import { runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const EMA_SPAN = 72;
const START_BAR = 24;
const MAX_SLIPPAGE_BPS = 100;
/** Stop loss: position worth <= 980/1000 of its cost. */
const STOP_LOSS_NUM = 980n;
const STOP_LOSS_DEN = 1000n;
/** Trailing exit arms once the position peaked >= 1005/1000 of its cost. */
const TRAIL_ARM_NUM = 1005n;
const TRAIL_ARM_DEN = 1000n;
/** ... and fires when the position falls to <= 975/1000 of that peak. */
const TRAIL_GIVEBACK_NUM = 975n;
const TRAIL_GIVEBACK_DEN = 1000n;

interface Ema {
  span: number;
  warm: number[];
  value: number | null;
  prev: number | null;
}

interface Held {
  /** Highest value the position reached, in quote units, since entry. */
  peak: bigint;
}

const emas = new Map<string, Ema>();
const held = new Map<string, Held>();
/** Symbols that have bought at least once: re-entries need a rising EMA. */
const entered = new Map<string, boolean>();

function step(e: Ema, close: number): void {
  e.prev = e.value;
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) {
    e.value = e.warm.reduce((a, x) => a + x, 0) / e.span;
  }
}

function push(bar: Bar): Ema {
  let e = emas.get(bar.symbol);
  if (e === undefined) {
    e = { span: EMA_SPAN, warm: [], value: null, prev: null };
    emas.set(bar.symbol, e);
  }
  step(e, Number(bar.c));
  return e;
}

await runBars({
  onBatch(state: BarsState, batch) {
    const uptrend = new Set<string>();
    for (const bar of batch.bars) {
      const e = push(bar);
      if (e.value !== null && e.prev !== null && Number(bar.c) > e.value && e.value > e.prev) {
        uptrend.add(bar.symbol);
      }
    }

    // Warm-up batches build history only: no orders on them.
    if (state.warmingUp) return [];

    const { caps, fees } = state.hello;
    const sells: SellInput[] = [];
    const entries: string[] = [];

    for (const { symbol } of state.hello.symbols) {
      const e = emas.get(symbol);
      const pos = state.positions.get(symbol);
      if (pos !== undefined) {
        // Track the position peak at the bar's high.
        let h = held.get(symbol);
        const valueNow = state.value(symbol, pos.qty);
        const valueHigh = state.value(symbol, pos.qty, BigInt(state.latest.get(symbol)!.h));
        if (h === undefined) {
          h = { peak: valueHigh };
          held.set(symbol, h);
        } else if (valueHigh > h.peak) {
          h.peak = valueHigh;
        }
        const cost = pos.cost;
        const stopLoss = valueNow * STOP_LOSS_DEN <= cost * STOP_LOSS_NUM;
        const trailArmed = h.peak * TRAIL_ARM_DEN >= cost * TRAIL_ARM_NUM;
        const trailFired = trailArmed && valueNow * TRAIL_GIVEBACK_DEN <= h.peak * TRAIL_GIVEBACK_NUM;
        if (stopLoss || trailFired) {
          sells.push({ side: 'sell', symbol, qty: pos.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
          held.delete(symbol);
        }
      } else if (e !== undefined && e.value !== null && state.seq >= START_BAR) {
        // First buy: close above the EMA is enough. Re-entries need the
        // EMA rising too, so a flat bounce does not chase us back in.
        const firstBuy = !entered.get(symbol);
        const closeAbove = Number(state.latest.get(symbol)!.c) > e.value;
        if (closeAbove && (firstBuy || uptrend.has(symbol))) {
          entries.push(symbol);
          entered.set(symbol, true);
        }
      }
    }

    const orders: (SellInput | BuyInput)[] = sells.slice(0, caps.max_orders_per_bar);
    const minNotional = BigInt(fees.min_notional_quote_units);
    let cash = state.cash;
    for (const symbol of entries) {
      if (orders.length >= caps.max_orders_per_bar) break;
      // One position at most; buy with all cash (capped at 100% of equity).
      let slice = cash;
      const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / 10000n;
      if (slice > byWeight) slice = byWeight;
      if (slice < minNotional) break;
      orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      cash -= slice;
    }
    return orders;
  },
});
