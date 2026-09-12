# P300 Economics Gate

Status: research/preflight only. This document does not authorize LIVE trading.

## Purpose

The Economics Gate must answer whether a venue/pair/strategy combination has enough economic room to justify further work at P300 scale. It is a falsification gate, not a strategy generator.

## Required sequence

1. Refresh venue constraints from authoritative APIs.
2. Identify the binding constraint (base quantity, quote notional, or both).
3. Compute current and stressed exit granularity.
4. Build a coherent risk envelope; do not increase risk merely to obtain reducibility.
5. Compute all-in execution cost and Minimum Viable Edge (MVE).
6. Attach the MVE to an explicit holding horizon and expected trade frequency.
7. Compare net strategy return to a same-horizon benchmark.
8. Require an Edge Thesis naming the counterparty, persistence mechanism, decay hypothesis and falsification condition.
9. Return GO / NO-GO for research. A high MVE is not an instruction to search harder for a signal that claims a high edge.

## Dynamic market constraints

Constraints are venue-, pair-, and order-type-specific. They must never be hardcoded as a single global `minOrder`.

### Binance

The exchange exposes symbol filters including `LOT_SIZE`, `MIN_NOTIONAL`, `NOTIONAL` and `MARKET_LOT_SIZE`. The adapter must distinguish limit/maker constraints from market-order constraints and fail closed on unknown filter combinations.

Reference: https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/account

### Kraken

The public `AssetPairs` endpoint provides trading metadata such as `ordermin`, price precision and volume precision. Funding minimums are a separate concept and must not be used as spot order minimums.

References:
- https://support.kraken.com/articles/360042589912-order-minimums-deposit-and-withdrawal-minimums-etc-
- https://support.kraken.com/articles/360000920306-api-symbols-and-tickers

## Cost model

`allInCostBps = entryFee + exitFee + spread + slippage + adverseSelection + infra + admin`

`MVE = allInCostBps + safetyMargin`

The gate must also compare the net strategy return against the benchmark return over the same holding period. This prevents longer holding periods from manufacturing apparent edge by capturing ordinary market beta.

### Current Kraken reference tier

As of 2026-09-12, Kraken Pro's published Tier 1 Spot Crypto fees are 0.40% maker and 0.80% taker. These values are inputs, not permanent constants; they must be refreshed before analysis.

Reference: https://www.kraken.com/features/fee-schedule

## Reducibility

If the binding minimum is expressed in base quantity, price changes alone do not change the number of base-quantity slices. If the binding minimum is expressed in quote notional, stressed price changes can alter the minimum executable base quantity and therefore the number of exit slices.

The final remainder is not a free partial exit. Step-size rounding, partial fills, fee asset and dust can reduce practical flexibility. Reducibility must therefore be recalculated from the actually sellable quantity before exit.

## Risk-envelope invariants

A candidate envelope is invalid if its components contradict one another. At minimum:

- gross exposure <= authorized capital
- slots × max risk per position <= daily loss limit
- slot capacity must be able to represent declared gross exposure
- max drawdown >= max daily loss
- any required exit-slice count must be achievable both now and under the declared stress case

Additional spot-only consistency checks remain a tracked follow-up before LIVE integration.

## Governance

P300 may veto or reduce authority. It may not override a rejection from Clodds' native RiskEngine, increase a Clodds-adjusted position size, or place orders directly.

The system Attention Budget remains 20 human-attention hours or 21 active days, whichever comes first. Reaching the budget forces GO / PAUSE / KILL; PAUSE means archived, not background monitoring.
