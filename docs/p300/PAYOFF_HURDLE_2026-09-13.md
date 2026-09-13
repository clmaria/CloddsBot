# P300 Absolute Payoff Hurdle — 2026-09-13

Status: **ECONOMIC SENSITIVITY / NOT A RETURN FORECAST**

Purpose: stop P300 from confusing a statistically interesting edge with an economically worthwhile €300 experiment.

## Baseline

For the current Bitvavo BTC-USDC candidate, the base-tier crypto/USDC fee-only round-trip floor is approximately **10 bps** (5 bps per fill each way).

All calculations below are intentionally optimistic because they subtract only that fee floor. They do **not** yet subtract:
- spread or maker opportunity cost;
- slippage;
- adverse selection;
- non-fill cost;
- infrastructure/API cost;
- tax/accounting/admin workload;
- losses/variance/drawdown.

Therefore these figures are ceilings on simple per-round-trip economics, not expected profits.

## Euro value of a claimed gross edge

`optimistic_net_bps = gross_reversion_bps - 10 fee_bps`

`optimistic_pnl_per_round_trip = authorized_notional × optimistic_net_bps / 10,000`

| Authorized notional | 20 bps gross | 30 bps gross | 50 bps gross | 100 bps gross |
|---:|---:|---:|---:|---:|
| €25 | €0.025 | €0.05 | €0.10 | €0.225 |
| €50 | €0.05 | €0.10 | €0.20 | €0.45 |
| €100 | €0.10 | €0.20 | €0.40 | €0.90 |
| €150 | €0.15 | €0.30 | €0.60 | €1.35 |
| €300 | €0.30 | €0.60 | €1.20 | €2.70 |

The corresponding optimistic net edges are 10, 20, 40 and 90 bps respectively.

## How many round trips would be needed to create €50?

Again, this ignores all costs except the 10 bps fee floor.

| Authorized notional | 20 bps gross | 30 bps gross | 50 bps gross | 100 bps gross |
|---:|---:|---:|---:|---:|
| €25 | 2,000 | 1,000 | 500 | 223 |
| €100 | 500 | 250 | 125 | 56 |
| €300 | 167 | 84 | 42 | 19 |

This exposes the central P300 constraint: at low authorized capital, a small-bps edge can be real and still have negligible absolute value.

## Frequency example

Suppose, purely as a sensitivity case, Phase A eventually supported **50 bps gross / 40 bps after fee floor** on each independent realizable round trip.

Approximate annual optimistic PnL without compounding:

| Valid round trips/year | €25 authorized | €100 authorized | €300 authorized |
|---:|---:|---:|---:|
| 52 (1/week) | €5.20 | €20.80 | €62.40 |
| 104 (2/week) | €10.40 | €41.60 | €124.80 |
| 260 (5/week) | €26.00 | €104.00 | €312.00 |
| 520 (10/week) | €52.00 | €208.00 | €624.00 |

These are not forecasts. They show why **frequency is part of the edge economics**, not a secondary metric.

## Sensitivity to only a few extra bps of friction

At full €300 notional and 100 round trips/year:

- 20 bps gross, fee floor only → ~€30/year.
- Add another 10 bps of combined spread/slippage/adverse-selection cost → ~€0/year.
- 30 bps gross, fee floor only → ~€60/year.
- Add another 10 bps → ~€30/year.
- 50 bps gross, fee floor only → ~€120/year.
- Add another 10 bps → ~€90/year.

A few bps matter enormously at this scale. This is why Phase A must measure execution conditions rather than infer profitability from gross reversion.

## Fixed-cost hurdle

At the €300 hard capital ceiling:

- €5/month dedicated infrastructure = €60/year = **20% of the initial capital**.
- €10/month = €120/year = **40% of the initial capital**.

Therefore Phase A has a **zero-new-paid-infrastructure default**. Public/keyless feeds and existing compute should be used first.

If a candidate edge can only be demonstrated or captured with paid low-latency/data infrastructure, that cost enters the Economics Gate before promotion. P300 must not externalize infrastructure cost simply because it is paid outside the trading account.

## Economic promotion implication

Phase A must not answer only:

> Does the dislocation tend to revert?

It must establish whether there is plausible room for the conjunction:

**magnitude × conservative fillability × valid opportunity frequency × usable capital − all execution/operational costs**

to be worth the attention and complexity required.

A small positive expected value is not automatically enough. P300 is competing for scarce attention against other projects.

## Phase A reporting requirement

Alongside convergence/fill metrics, Phase A should report:
- valid independent underpriced episodes per observation day/week;
- fraction with Tier A strict fill evidence;
- fraction with Tier B visible-queue fill evidence;
- gross convergence distribution at each frozen horizon;
- executable net-edge sensitivity after fee floor plus 5/10/20 bps additional friction;
- estimated annualized **absolute euro** opportunity at the currently authorized notional and at the €300 ceiling, clearly labeled as sensitivity rather than forecast;
- attention/operational burden required to maintain the data and system.

## Kill implication

The experiment should be eligible for **PAUSE/KILL even with statistically positive reversion** if plausible absolute payoff at the €300 ceiling is too small to justify its maintenance/attention burden.

Conversely, a strong Phase A result does not authorize using €300 immediately. Upward authorized capital remains human-gated and must progress through the existing P300 governance ladder.