# P300 Edge Thesis Shortlist — 2026-09-13

Status: **RESEARCH / PAPER ONLY**. This document authorizes no LIVE trading, capital increase, exchange execution connection, shorting or weakening of the Risk Envelope.

## Decision

Choose the smallest experiment capable of falsifying a plausible short-term Spot edge before P300 spends more user attention or builds an execution adapter.

The question is not “which indicator looks best?” It is: **is there a structural source of realizable net edge, after fees, non-fill/adverse-selection effects and operational burden, that can plausibly survive at P300 scale?**

## Current economics baseline

### Bitvavo EUR crypto pairs — base tier
- Maker: 15 bps per fill
- Taker: 25 bps per fill
- fee-only RT: 30 / 40 / 50 bps for maker-maker / maker-taker / taker-taker.

### Bitvavo USDC crypto pairs — base tier
- Maker: 5 bps per fill
- Taker: 5 bps per fill
- fee-only RT: 10 bps.

These are fee floors, not MVE. Spread, slippage, adverse selection, fill/non-fill economics, infrastructure/operational cost, same-horizon benchmark and safety margin remain downstream terms.

BTC-USDC is the current primary pair because the fee floor leaves materially more economic room than BTC-EUR. Runtime venue metadata remains authoritative for any future executability decision.

## Thesis A — cross-venue taker lead/lag

Classification:
- BTC/EUR: **REJECT primary / CONTROL only**
- BTC/USDC: **WATCH / diagnostic only**

### Proposed anomaly/mechanism
A reference venue moves first and Bitvavo reprices later, leaving a stale local executable quote. The hypothesized counterparty is local liquidity that has not yet repriced or inventory/order flow temporarily pinning a stale quote.

### Adversarial check
This is one of the most competed crypto HFT anomalies. Public-feed P300 should assume professional market makers can observe/reprice faster. “Reference moved first” is not evidence of edge.

### Falsifiers
Reject if:
1. target repricing after a reference shock does not exceed measured costs;
2. the apparent lag disappears under **same-process monotonic receive-time alignment**;
3. any effect exists only below realistic data/decision/order latency;
4. OOS expectancy is non-positive after costs;
5. results require fitted shock thresholds/windows;
6. opportunity frequency does not justify operational burden.

Half-life: unknown; measure rather than assume.

## Thesis B — standalone order-book imbalance

Classification: **COMBINE / filter only**.

Order-book imbalance is public and heavily competed. A statistically predictive few-bps next move is economically irrelevant if fees/execution consume it.

Use it only to:
- reject entries fighting local order flow;
- identify adverse-selection regimes;
- segment results after the primary hypothesis is frozen.

It does not earn a separate strategy slot or multiple-testing budget today.

## Thesis C — cross-venue-anchored passive reversion

Classification: **EXPERIMENT — primary candidate**.

### Anomaly
Bitvavo temporarily overshoots a fresh cross-venue fair-value anchor because of local aggressive flow/inventory pressure, then partially reverts.

This is not raw taker latency arbitrage. The future hypothetical implementation would test whether passive liquidity provision during a local dislocation is compensated after costs.

### Counterparty/mechanism
The proposed counterparty is impatient/inventory-motivated local flow demanding immediacy. The proposed mechanism is compensation for supplying liquidity against a temporary local dislocation while independent venues provide the fair-value anchor.

Plausible, not proven. Phase A must try to kill it.

### Primary reference cohort
For BTC-USDC Phase A:
- target: Bitvavo BTC-USDC;
- reference A: Kraken Spot BTC/USDC;
- reference B: Binance Spot BTCUSDC as public reference data only.

Coinbase is not counted as an independent direct-USDC reference because current public `-USDC` data can alias the corresponding `-USD` product. Synthetic quote conversion, if ever used, is a separate preregistered cohort and is never silently mixed with the primary direct-USDC cohort.

### Timing contract
Cross-feed ordering, freshness, skew and horizon boundaries use **same-process local monotonic receive time only**.
- wall clock = audit/log correlation only;
- exchange timestamps = provenance only where semantics are documented;
- Bitvavo `book.timestamp` is not the timestamp of every book change;
- a collector restart invalidates any open episode.

Any apparent edge that requires mixing venue clocks or wall-clock ordering fails the timing gate.

### Why this candidate outranks the others
1. It does not require winning a pure latency race.
2. BTC-USDC starts with a 10 bps fee-only RT floor rather than 30+ bps on EUR.
3. Cross-venue fair value and local imbalance play different roles instead of multiplying unrelated strategies.
4. It fits low-touch bounded autonomy: no-trade/idle is valid until a preregistered dislocation appears.
5. The mechanism has an identifiable counterparty and falsifiers.

### Spot asymmetry — long-only executable side
P300 forbids leverage, futures, margin and shorting.
- Bitvavo cheap vs reference: potentially monetizable buy-first path.
- Bitvavo expensive vs reference: monetization requires pre-existing BTC inventory or a short path.

Persistent BTC inventory would add continuous exposure and change the Risk Envelope. It is not auto-authorized. Phase A records both directions, but only the **underpriced/buy-first** direction is executable under the current envelope. If the effect lives only on the overpriced side: NO-GO under the current envelope or a new human-gated inventory decision.

### USDC operational trade-off
Lower USDC fees do not remove tax/accounting complexity. BTC↔USDC activity requires accurate EUR valuation/lot accounting for a Spanish individual investor. Treat this as ledger/admin complexity and after-tax analysis, not as a fabricated per-trade tax fee inside MVE.

### Regime/data-quality requirements
A valid candidate observation requires:
- target market normal/trading;
- sequence-correct Bitvavo local book;
- Bitvavo ticker/local-book BBO agreement;
- fixed ticket with sufficient depth;
- fresh Kraken+Binance BTC-USDC references;
- reference dispersion inside frozen quality limit;
- same-process monotonic timing integrity;
- dynamic market metadata available;
- no risk increase merely to gain granularity.

### Falsifiers
Reject/PAUSE if:
1. reversion magnitude cannot plausibly clear the effective hurdle;
2. measured effect disappears under monotonic receive-time alignment;
3. source dispersion/noise explains the apparent dislocation;
4. the effect vanishes OOS or under modestly worse assumptions;
5. it requires parameter hunting across bins/windows;
6. its useful half-life is shorter than a realistic future execution path;
7. operational/tax-ledger burden dominates net economic value;
8. valid independent opportunities are too scarce to earn attention;
9. the effect exists only on the unauthorized overpricing side;
10. once the fill clock gate is resolved, non-fill/adverse selection destroys expectancy.

### Fill-model status
The conservative visible-queue logic is useful fixture/research logic but **is not Phase-A-valid fill-probability evidence yet**. Its current active window uses Bitvavo exchange-trade timestamps while signal activation is local.

Until activation/expiry and trade arrivals are all represented in the same-process monotonic receive-time domain (or another explicitly validated conservative clock mapping exists):
- do not report maker fill probability;
- do not use the helper to promote the thesis;
- Phase A may still measure dislocation/reversion/depth economics.

### Half-life
Unknown. Measure only fixed preregistered forward horizons: 1s, 2s, 5s, 15s, 30s, 60s. These are measurement buckets, not fitted trading parameters.

## Minimal evidence experiment

### Phase A — screening
Collect **30 independent dislocation episodes**, not ticks:
- BTC-USDC primary;
- BTC-EUR control;
- both signs retained, but only underpriced side counts as executable under current long-only envelope.

Each envelope follows `EVIDENCE_ENVELOPE_V1.md` and includes immutable raw-data pointers, monotonic timing, synchronized target state, Kraken+Binance references, deviation, spread/depth/slippage, fixed forward horizons and quality/invalidation reasons.

Fill fields remain `not_evaluated_clock_gate` until the maker-fill timing refactor is validated.

Phase A answers only whether enough economic room exists to justify a larger OOS test. It cannot promote LIVE or establish statistical significance.

### Phase B — only if Phase A survives
Freeze source set, signal definition, selected execution assumptions, horizon/active-window policy, primary metric, cost model and kill criteria. Then collect at least **100 new independent episodes OOS**. Phase A data may not be reused as Phase B validation evidence.

## Risk decision

**No Risk Envelope changes.** Cheaper USDC fees do not justify more exposure, daily loss, drawdown, slots, risk per position or persistent BTC inventory.

## Promotion state

- Thesis A BTC/EUR taker lag: REJECT primary / CONTROL
- Thesis A BTC/USDC taker lag: WATCH / diagnostic
- Thesis B standalone imbalance: COMBINE / filter
- Thesis C BTC-USDC underpriced side: EXPERIMENT
- Thesis C BTC-USDC overpriced side: RESEARCH ONLY
- Thesis C BTC-EUR: CONTROL

No thesis is GO, PAPER_READY or LIVE_READY.

## Next action

Complete the **monotonic receive-time evidence/collector path** before representative Phase-A collection. Do not build an execution adapter. The collector must remain public/read-only, incapable of placing orders, and fail closed on stale, malformed, out-of-sequence, mixed-clock-domain or incomparable data.
