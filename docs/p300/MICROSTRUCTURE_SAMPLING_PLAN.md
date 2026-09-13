# P300 Microstructure Sampling Plan

Goal: collect the minimum representative evidence needed to decide whether a venue/pair or the current Edge Thesis deserves further P300 work. This is research-only and must not place orders.

## Two separate evidence tracks

Do not mix these tracks.

### Track 1 — venue baseline

Purpose: estimate generic spread/depth/slippage economics for venue comparison.

Current scope:
- Bitvavo: primary regulated candidate;
- Kraken: regulated comparator;
- OKX Europe: only after current EEA fee applicability is reconciled;
- Binance: research comparator only while Spain/EU live eligibility remains unverified.

Baseline pairs may include BTC/EUR and ETH/EUR where available. These samples answer venue-quality questions only; they do **not** count as independent Edge-Thesis episodes.

### Track 2 — Edge Thesis Phase A

Purpose: falsify the current primary candidate, long-only cross-venue-anchored passive reversion.

Current target:
- Bitvavo BTC-USDC = primary research pair;
- Bitvavo BTC-EUR = economics/control pair;
- no ETH pair is part of the current thesis unless a later, separately preregistered cohort is approved.

Timing evidence for Track 2 must follow the stricter Phase-A clock protocol. Sequence-correct books alone are not enough to establish cross-feed timing.

## Venue-baseline ticket sizes

For EUR quote tickets:
- EUR 5
- EUR 10
- EUR 25

For USDC quote tickets, use equivalent fixed nominal research tickets declared before collection; do not silently resize tickets to make minimum-order or reducibility constraints easier to satisfy.

The same raw order-book snapshot may be evaluated against several preregistered ticket sizes. Never mix different ticket sizes, venues, symbols or quote assets in one statistical evidence set.

For a quote ticket:
- buy-side analysis spends the declared quote amount across asks;
- sell-side analysis fixes the base quantity equivalent to that quote ticket at best bid, then measures actual proceeds through bid depth;
- the sell model must not silently sell more base merely to preserve requested quote proceeds.

## Track 1 sample targets

Initial venue-baseline target per venue/pair:
- 30 independent snapshots minimum;
- split across at least 3 materially different time windows rather than one burst;
- at least one sample window should include a higher-activity Europe/US overlap;
- if results are near an economic decision boundary or show unstable tails, extend rather than declaring PASS.

Confirmation sample only for candidates surviving the screen:
- target >= 100 snapshots per venue/pair;
- include multiple days;
- include at least one weekend and one weekday when practical;
- preserve receive timestamps and source metadata;
- do not silently drop bad/crossed/empty books: record capture failure separately.

## Track 2 sample target

The Edge Thesis uses the separate preregistered Phase-A protocol:
- 30 **independent dislocation episodes**, not 30 arbitrary snapshots;
- fixed forward horizons already declared in the Phase-A protocol;
- BTC-USDC primary + BTC-EUR control;
- same-process monotonic receive time is required for freshness, ordering and cross-feed skew;
- public maker-fill evidence remains descriptive/PAPER and cannot promote LIVE;
- Phase A observations are never reused as Phase-B OOS evidence.

## Venue-baseline metrics

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
- p99/max are stress diagnostics, not automatically assumed every operation.

The output is `effectiveHurdleBps`, not a signal-search target. A candidate still needs a structural Edge Thesis capable of plausibly clearing that hurdle.

## Stop rules

Stop evidence collection early when any mandatory gate fails decisively, for example:
- regulatory ineligibility;
- pair unavailable;
- market metadata incompatible with the coherent Risk Envelope;
- persistent insufficient depth at P300 ticket sizes;
- fee + microstructure floor already exceeds any credible predeclared Edge Thesis;
- Phase-A timing cannot be measured without mixing clock domains.

Do not collect more data merely because collection is easy.

## Attention-budget rule

Automated/public-data collection itself does not consume human-attention hours unless it requires setup, debugging or manual review. Human analysis and implementation do count.
