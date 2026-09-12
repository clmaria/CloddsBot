# P300 Microstructure Sampling Plan

Goal: collect the minimum representative evidence needed to decide whether a venue/pair deserves further P300 work. This is research-only and must not place orders.

## Phase A — screening sample

Venues:
- Bitvavo: primary regulated candidate.
- Kraken: regulated comparator.
- OKX Europe: only after current EEA fee applicability is reconciled.
- Binance: research comparator only while Spain/EU live eligibility remains unverified.

Pairs:
- BTC/EUR
- ETH/EUR

Quote-ticket sizes:
- EUR 5
- EUR 10
- EUR 25

The same raw order-book snapshot may be evaluated against all three ticket sizes. Never mix different ticket sizes, venues or symbols in one statistical evidence set.

For a quote ticket:
- buy-side analysis spends the declared EUR amount across asks;
- sell-side analysis fixes the base quantity equivalent to that EUR ticket at best bid, then measures the actual proceeds through bid depth;
- the sell model must not silently sell more base merely to preserve the requested EUR proceeds.

Initial sample target per venue/pair:
- 30 independent snapshots minimum;
- split across at least 3 materially different time windows rather than one burst;
- at least one sample window should include a higher-activity Europe/US overlap;
- if Phase A results are near an economic decision boundary or show unstable tails, extend to Phase B rather than declaring PASS.

## Phase B — confirmation sample

Only for candidates surviving Phase A:
- target >= 100 snapshots per venue/pair;
- include multiple days;
- include at least one weekend and one weekday when practical;
- preserve timestamps and source metadata;
- do not silently drop bad/crossed/empty books: record the capture failure separately.

## Metrics

For each venue / pair / ticket combination:
- spread bps p50 / p90 / p99 / max across valid snapshots;
- buy slippage bps p50 / p90 / p99 / max across fully fillable buy snapshots only;
- sell slippage bps p50 / p90 / p99 / max across fully fillable sell snapshots only;
- fully-fillable sample count by side;
- insufficient-depth rate for buys and sells;
- capture/error rate;
- observation window start/end;
- total sample count.

If a side has zero fully-fillable observations, its slippage distribution is `null`; that is evidence of insufficient depth, not zero slippage.

## Economics use

Microstructure metrics do not create a standalone PASS threshold. They feed the economics model together with:
- maker/taker fees;
- adverse selection;
- maker non-fill opportunity cost when applicable;
- infrastructure/admin cost;
- same-horizon benchmark;
- safety margin.

Use representative/tail scenarios, not only p50:
- base case may use p50 observations;
- conservative case should include p90;
- p99/max are stress diagnostics, not automatically assumed every trade.

The output is `effectiveHurdleBps`, not a signal-search target. A strategy still needs a structural Edge Thesis capable of plausibly clearing that hurdle.

## Stop rules

Stop evidence collection early when any mandatory gate fails decisively, for example:
- regulatory ineligibility;
- pair unavailable;
- market metadata incompatible with the coherent Risk Envelope;
- persistent insufficient depth at P300 ticket sizes;
- fee + microstructure floor already exceeds any credible predeclared Edge Thesis.

Do not collect more data merely because collection is easy.

## Attention-budget rule

Automated/public-data collection itself does not consume human-attention hours unless it requires setup, debugging or manual review. Human analysis and implementation do count.
