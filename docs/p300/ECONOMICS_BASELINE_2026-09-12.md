# P300 Economics Baseline — 2026-09-12

Purpose: freeze a dated evidence snapshot for the Economics Gate. These values are research inputs, not runtime constants. Runtime/preflight must refresh venue metadata and fee schedules before promotion or LIVE.

## Fee-floor comparison

### Binance EUR fiat pairs — regular user

Official Binance fiat spot fee table (checked 2026-09-12):
- Maker: 0.1000% = 10 bps per side
- Taker: 0.1500% = 15 bps per side

Fee-only round trip:
- maker/maker: 20 bps
- maker/taker: 25 bps
- taker/taker: 30 bps

Source: Binance Fees & Transactions Overview, fiat spot fee table.

### Kraken Spot Crypto — Tier 1

Official Kraken fee schedule (checked 2026-09-12):
- Maker: 0.40% = 40 bps per side
- Taker: 0.80% = 80 bps per side

Fee-only round trip:
- maker/maker: 80 bps
- maker/taker: 120 bps
- taker/taker: 160 bps

BTC/EUR and ETH/EUR are Spot Crypto pairs, not Stablecoin/FX fee-schedule pairs.

Source: Kraken Fee Structures, Spot Crypto Tier 1.

## Immediate implication

Holding spread, slippage, adverse selection, infrastructure and benchmark constant, Kraken requires:
- +60 bps more gross edge than Binance in maker/maker mode;
- +95 bps more in maker/taker mode;
- +130 bps more in taker/taker mode.

For a €300 experiment this difference is economically material. It does not, by itself, select Binance because regulatory eligibility, actual pair availability, market constraints, reporting burden and execution quality are separate gates.

## Market-price snapshot

Public market pages on 2026-09-12 showed approximately:
- BTC/EUR Kraken: ~€66.6k
- ETH/EUR Kraken: ~€2.16k–€2.25k depending crawl timestamp

These prices are orientation only and must not be used as execution inputs.

## Required next measurements

Before a venue/pair can be ECONOMICS PASS:
1. Fresh pair metadata from venue API (min base quantity, quote/notional minimum, lot/step size, order-type-specific filters).
2. Fresh bid/ask and spread sample series, not a single snapshot.
3. Depth at feasible P300 ticket sizes.
4. Estimated slippage and adverse selection by maker/taker mode.
5. Same-horizon benchmark return.
6. Regulatory/CASP eligibility for a Spain-resident user.
7. Reporting/export completeness for tax-ready ledger reconstruction.

## Fail-closed notes

- Binance market-order constraints are not yet fully modeled: MARKET_LOT_SIZE and notional market-application flags must be parsed before market orders can be promoted.
- Kraken public documentation has shown inconsistent human-readable BTC minimum examples; runtime must trust fresh AssetPairs metadata rather than hardcoded docs.
- No venue is selected by fee level alone.
