# P300 Economics Baseline

Status: research evidence for preflight only. This document does not authorize trading or select a venue.

## Verified fee baseline (2026-09-12)

### Binance EUR fiat spot
Source: https://www.binance.com/en/fee/fiatSpot

Regular user:
- Maker: 0.1000% = 10 bps per side
- Taker: 0.1500% = 15 bps per side
- Round-trip fee floor, maker/maker: ~20 bps
- Round-trip fee floor, taker/taker: ~30 bps

### Kraken Spot Crypto
Source: https://www.kraken.com/features/fee-schedule

Tier 1 ($0+ spot 30-day volume):
- Maker: 0.40% = 40 bps per side
- Taker: 0.80% = 80 bps per side
- Round-trip fee floor, maker/maker: ~80 bps
- Round-trip fee floor, taker/taker: ~160 bps

BTC/EUR and ETH/EUR must use the Spot Crypto schedule, not the stablecoin/FX schedule.

## Interpretation

Fees alone are not the Minimum Viable Edge. The Economics Gate must add:
- spread,
- slippage,
- adverse selection,
- execution/non-fill effects,
- infrastructure cost allocation,
- compliance/admin cost allocation,
- safety margin,
- same-horizon benchmark return.

Therefore:

MVE = fees + spread + slippage + adverse selection + infra/admin allocation + safety margin

A strategy is not economically viable merely because gross edge > MVE. It must also beat the benchmark over the same holding horizon after costs.

## Venue constraints

Do not hardcode exchange filters from this document. Minimum quantity, minimum notional, lot/step size and related filters are dynamic market metadata and must be obtained by the venue-constraint adapter/preflight.

The gate must distinguish whether the binding constraint is in base quantity or quote notional, because stressed reducibility behaves differently.

## Current provisional implication

At P300 scale, Kraken Spot Crypto starts with a substantially higher fee hurdle than Binance EUR fiat spot. This is not a final venue decision: regulatory suitability, reporting quality, live constraints, spreads, liquidity, slippage, API reliability and tax/admin burden still need to be evaluated.

No LIVE authorization follows from this document.