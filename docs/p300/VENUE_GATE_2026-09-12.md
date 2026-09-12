# P300 Venue Gate — 2026-09-12

A venue must pass every mandatory gate. Low fees alone never imply venue approval.

## Gate dimensions

1. Regulatory eligibility for a Spain-resident user.
2. Pair availability and fresh venue metadata.
3. Order-type-specific market constraints.
4. Execution economics: fees, spread, slippage, adverse selection.
5. Reducibility and stressed reducibility.
6. Reporting/export completeness for a tax-ready ledger.
7. Operational/API reliability.

## Kraken — provisional state

Regulatory: PASS provisional.
- Spain's MiCA transition ended on 1 July 2026; CNMV states that only authorized providers may operate after the transition.
- Kraken states it is MiCA-authorized through the Central Bank of Ireland for EEA services.

Economics: WEAK / requires evidence.
- Standard Spot Crypto Tier 1: 40 bps maker, 80 bps taker per side.
- Fee-only round trip: 80 / 120 / 160 bps for maker-maker / maker-taker / taker-taker.
- Therefore frequent micro-trading requires unusually large repeatable gross edge before spread/slippage.

Constraints: runtime refresh required.
- Human-readable Kraken minimum documentation has shown inconsistent BTC examples.
- AssetPairs metadata must be authoritative at preflight time.

Reporting: provisionally favorable.
- Kraken exposes trades/ledger/history exports and API-accessible records suitable for automated ledger reconstruction, subject to implementation verification.

Overall: WATCH / candidate for evidence collection, not yet ECONOMICS PASS.

## Binance — provisional state

Economics: materially stronger fee floor.
- Binance fiat pair table for regular users: 10 bps maker, 15 bps taker per side.
- Fee-only round trip: 20 / 25 / 30 bps.

Regulatory: NO-GO / UNVERIFIED for Spain until proven otherwise.
- Binance stated on 24 June 2026 that it withdrew its Greek MiCA application and would pursue authorization in another EU Member State.
- No later primary evidence has yet been accepted by this gate showing a MiCA CASP authorization applicable to Spain.
- Therefore lower fees cannot promote Binance to an eligible live venue.

Constraints: incomplete for market orders.
- LOT_SIZE and quote-notional filters are modeled.
- MARKET_LOT_SIZE and market-application flags still need explicit order-type-aware handling.

Reporting: available but administrative burden must be measured rather than assumed.

Overall: NO-GO/UNVERIFIED for live P300 in Spain until regulatory eligibility is demonstrated. May remain useful as a research comparator only.

## Selection rule

Venue ranking is lexicographic, not a weighted score that can trade legality/safety for cheap fees:

REGULATORY ELIGIBILITY
  -> TECHNICAL TRADABILITY
  -> RISK/REDUCIBILITY
  -> ECONOMICS / MVE
  -> REPORTING / OPERATIONS

A failure in a mandatory gate is not compensated by strength in another gate.

## Next evidence required

- Fresh Kraken AssetPairs metadata for BTC/EUR and ETH/EUR.
- Fresh bid/ask sample series and book depth at P300-sized tickets.
- Actual maker fill probability and non-fill opportunity cost.
- Order-type-aware constraint model.
- Current authoritative Binance MiCA/CASP status applicable to Spain before reconsideration.
