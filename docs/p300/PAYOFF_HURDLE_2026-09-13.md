# P300 Absolute Payoff Hurdle — 2026-09-13

Status: **ECONOMIC SENSITIVITY / NOT A RETURN FORECAST**

Purpose: stop P300 from confusing a statistically interesting edge with an economically worthwhile €300 experiment, while also preventing the opposite mistake of treating all authorized capital as one trade.

## Baseline

For the current Bitvavo BTC-USDC candidate, the base-tier crypto/USDC fee-only round-trip floor is approximately **10 bps** (5 bps per fill each way).

All calculations below are intentionally optimistic because they subtract only that fee floor. They do **not** yet subtract spread/non-fill opportunity cost, slippage, adverse selection, infrastructure/API cost, tax/accounting/admin workload, losses/variance or drawdown.

Therefore these figures are ceilings on simple per-round-trip economics, not expected profits.

## Capital is not trade size

Keep these concepts separate:
- `authorizedCapital` = maximum capital P300 is allowed to put under strategy authority;
- `maxPositionNotional` / Risk Envelope = maximum notional a single position may use;
- venue minimums/granularity = what can actually be executed;
- `deployedNotional` = actual notional of one hypothetical round trip.

For every calculation below:

`deployedNotional <= min(authorizedCapital, maxPositionNotional, venue/risk constraints)`

The fact that €300 is eventually authorized would **not** imply €300 per trade. P300 must never enlarge a trade merely to make absolute PnL look worthwhile.

## Euro value of a claimed gross edge

`optimistic_net_bps = gross_reversion_bps - 10 fee_bps`

`optimistic_pnl_per_round_trip = deployedNotional × optimistic_net_bps / 10,000`

| Deployed notional in one round trip | 20 bps gross | 30 bps gross | 50 bps gross | 100 bps gross |
|---:|---:|---:|---:|---:|
| €5 | €0.005 | €0.010 | €0.020 | €0.045 |
| €10 | €0.010 | €0.020 | €0.040 | €0.090 |
| €25 | €0.025 | €0.050 | €0.100 | €0.225 |
| €50 | €0.050 | €0.100 | €0.200 | €0.450 |
| €100 | €0.100 | €0.200 | €0.400 | €0.900 |
| €300 | €0.300 | €0.600 | €1.200 | €2.700 |

The corresponding optimistic net edges are 10, 20, 40 and 90 bps. The €300 row is a mathematical ceiling/sensitivity only, not a recommended or pre-authorized trade size.

## How many completed round trips would create €50?

Again, fee floor only and only if every listed round trip were valid/realizable.

| Deployed notional | 20 bps gross | 30 bps gross | 50 bps gross | 100 bps gross |
|---:|---:|---:|---:|---:|
| €5 | 10,000 | 5,000 | 2,500 | 1,112 |
| €10 | 5,000 | 2,500 | 1,250 | 556 |
| €25 | 2,000 | 1,000 | 500 | 223 |
| €100 | 500 | 250 | 125 | 56 |
| €300 | 167 | 84 | 42 | 19 |

This exposes the central P300 constraint: a small-bps edge can be real and still have negligible absolute value at safe small trade sizes.

## Frequency sensitivity

Suppose, only as a sensitivity case, future evidence supported **50 bps gross / 40 bps after the fee floor** on each independent realizable round trip.

Approximate annual optimistic PnL without compounding:

| Valid round trips/year | €5 deployed | €10 deployed | €25 deployed | €100 deployed | €300 deployed ceiling |
|---:|---:|---:|---:|---:|---:|
| 52 | €1.04 | €2.08 | €5.20 | €20.80 | €62.40 |
| 104 | €2.08 | €4.16 | €10.40 | €41.60 | €124.80 |
| 260 | €5.20 | €10.40 | €26.00 | €104.00 | €312.00 |
| 520 | €10.40 | €20.80 | €52.00 | €208.00 | €624.00 |

These are not forecasts. They show why **opportunity frequency and safe deployable size are both part of the economics**.

## Sensitivity to a few extra bps of friction

At any deployed notional, an additional 10 bps of friction removes another 0.10% of that notional per completed round trip.

Example at a €25 trade and 100 completed round trips/year:
- 20 bps gross, fee floor only → ~€2.50/year;
- add another 10 bps friction → ~€0/year;
- 30 bps gross, fee floor only → ~€5/year;
- add another 10 bps → ~€2.50/year;
- 50 bps gross, fee floor only → ~€10/year;
- add another 10 bps → ~€7.50/year.

A few bps matter enormously at this scale. This is why Phase A must measure execution conditions rather than infer profitability from gross reversion.

## Fixed-cost hurdle

At the €300 hard capital ceiling:
- €5/month dedicated infrastructure = €60/year = 20% of initial capital;
- €10/month = €120/year = 40%.

Therefore Phase A has a **zero-new-paid-infrastructure default**. Public/keyless feeds and existing compute come first.

If a candidate can only be demonstrated/captured using paid low-latency infrastructure, that cost enters the Economics Gate before promotion. P300 must not externalize infrastructure cost because it is paid outside the trading account.

## Economic promotion implication

Phase A must not answer only “does the dislocation tend to revert?” It must establish whether there is plausible room for:

**magnitude × conservative fillability × valid opportunity frequency × safe deployed notional − all execution/operational costs**

to justify the attention/complexity required.

A small positive expected value is not automatically enough. P300 competes for scarce attention against other projects.

## Phase A reporting requirement

Alongside convergence metrics, Phase A should report:
- valid independent underpriced episodes per observation day/week;
- gross convergence distribution at every frozen horizon;
- executable net-edge sensitivity after fee floor plus 5/10/20 bps additional friction;
- absolute-euro sensitivity at €5/€10/€25 and at the **current permitted max position notional**, not merely at total authorized capital;
- maker-fill/non-fill sensitivity only after the monotonic fill-timing gate is solved;
- an explicit €300 deployed-notional ceiling scenario only as an upper-bound sensitivity, never as an implicit sizing recommendation;
- attention/operational burden required to maintain the data/system.

## Kill implication

The experiment should be eligible for **PAUSE/KILL even with statistically positive reversion** if plausible absolute payoff at safely deployable trade sizes and the €300 total-capital ceiling is too small to justify maintenance/attention burden.

Conversely, a strong Phase A result does not authorize using €300 immediately. Upward authorized capital and max-position changes remain human-gated and must pass the existing P300 governance ladder.
