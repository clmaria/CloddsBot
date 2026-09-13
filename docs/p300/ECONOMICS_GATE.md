# P300 Economics Gate

Status: research/preflight only. This document does not authorize LIVE trading.

## Purpose

The Economics Gate asks whether a venue/pair/strategy combination has enough economic room to justify further P300 work. It is a falsification gate, not a strategy generator and not an instruction to search for ever-larger claimed signals.

## Required sequence

1. Pass the venue's mandatory regulatory gate.
2. Refresh venue/pair/order-type constraints from authoritative exchange metadata.
3. Identify the binding constraint: base quantity, quote notional, both, or none.
4. Compute current and stressed exit granularity from actually executable quantities.
5. Build a coherent Risk Envelope without increasing acceptable risk merely to obtain exchange granularity.
6. Measure or conservatively model fees, spread, slippage, adverse selection, non-fill effects, infrastructure and admin burden.
7. Compute the cost floor and effective economic hurdle for a declared holding horizon and expected frequency.
8. Compare the strategy with the benchmark over exactly the same horizon.
9. Require a predeclared Edge Thesis with counterparty, persistence mechanism, decay and falsification condition.
10. Return research GO / NO-GO. Adapter construction comes only after the pre-adapter gates pass.

## Dynamic market constraints

Constraints are venue-, pair-, and order-type-specific. They must never be represented by a single global `minOrder`.

The preflight must fail closed when material filters are unknown, stale or incompatible. Human-readable support tables are supporting evidence only; fresh exchange metadata is authoritative for runtime constraints.

For venues that expose separate market-order filters, market orders must not inherit limit-order assumptions. In particular, Binance-style `LOT_SIZE`, `MARKET_LOT_SIZE`, `MIN_NOTIONAL` and `NOTIONAL` semantics must be handled according to order type before market orders can be promoted.

## Cost model

`allInCostBps = entryFee + exitFee + spread + slippage + adverseSelection + infra + admin`

`costFloorBps = allInCostBps + safetyMargin`

`benchmarkHurdleBps = allInCostBps + benchmarkReturnBpsSameHorizon`

`effectiveHurdleBps = max(costFloorBps, benchmarkHurdleBps)`

The strategy is economically viable only when its expected gross edge clears `effectiveHurdleBps` and its net return is strictly above the benchmark over the same holding horizon.

`minimumViableEdgeBps` is retained in code only as a backward-compatible alias for `effectiveHurdleBps`; new consumers should use the explicit name.

This prevents a longer holding period from manufacturing apparent alpha by capturing ordinary market beta.

## Microstructure evidence

A single spread snapshot is not sufficient. For a venue/pair/ticket evidence set, the research layer should preserve comparable observations and summarize at least:

- spread p50 / p90 / p99 / max;
- buy and sell slippage p50 / p90 / p99 / max;
- insufficient-depth rate;
- sample count and observation window;
- capture/error rate where available.

Do not mix venues, symbols or ticket sizes in one statistical evidence set.

## Reducibility

If the binding minimum is expressed in base quantity, price changes alone do not change the number of base-quantity slices. If the binding minimum is expressed in quote notional, adverse price changes can increase the minimum executable base quantity and reduce exit slices.

The final remainder is not a free partial exit. Step-size rounding, partial fills, fees charged in base asset and dust can reduce practical flexibility. Reducibility must therefore be recalculated from the actually sellable quantity before exit.

## Risk-envelope invariants

A candidate envelope is invalid when its components contradict one another. Current checks include:

- gross exposure <= authorized capital;
- slots × max risk per position <= daily loss limit;
- slot capacity can represent declared gross exposure;
- max drawdown >= max daily loss;
- required stressed exit slices must be achievable.

Additional spot-only consistency checks remain explicit open gates before any LIVE integration.

## Venue selection rule

Venue selection is lexicographic, not a weighted score:

REGULATORY ELIGIBILITY
  -> TECHNICAL TRADABILITY
  -> RISK / REDUCIBILITY
  -> ECONOMICS / EFFECTIVE HURDLE
  -> REPORTING / OPERATIONS
  -> ADAPTER BUILD DECISION
  -> PAPER / TESTNET
  -> HUMAN-GATED LIVE

A failure in a mandatory gate is not compensated by cheaper fees elsewhere in the scorecard.

## Governance

P300 may veto or reduce authority. It may not override a rejection from Clodds' native RiskEngine, increase a Clodds-adjusted position size, or submit exchange orders directly.

The system Attention Budget remains 20 human-attention hours or 21 active days, whichever comes first. Reaching the budget forces GO / PAUSE / KILL; PAUSE means archived, not a continuing background scanner.
