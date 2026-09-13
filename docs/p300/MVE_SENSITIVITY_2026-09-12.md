# P300 MVE Sensitivity — 2026-09-12

This note intentionally avoids invented live spreads/slippage. It expresses the economic hurdle parametrically until bid/ask and fill evidence is available.

## Formula

Let:
- `FEE_RT` = round-trip venue fees in bps
- `X` = spread + slippage + adverse selection + infra/admin allocation in bps
- `S` = safety margin in bps
- `B` = benchmark return over the exact same holding horizon in bps

Then:

`allInCost = FEE_RT + X`

`effectiveHurdle = allInCost + max(S, B)`

A strategy whose expected gross edge is below `effectiveHurdle` is not economically viable for P300.

## Fee-only lower bound (X = 0)

Assuming a 10 bps safety margin and a zero same-horizon benchmark solely to establish the absolute best-case lower bound:

| Venue / mode | Fee RT | Absolute lower-bound gross hurdle |
|---|---:|---:|
| Binance maker/maker | 20 bps | 30 bps |
| Binance maker/taker | 25 bps | 35 bps |
| Binance taker/taker | 30 bps | 40 bps |
| Kraken maker/maker | 80 bps | 90 bps |
| Kraken maker/taker | 120 bps | 130 bps |
| Kraken taker/taker | 160 bps | 170 bps |

These are NOT expected real hurdles. Real values must be higher because `X` and often `B` are positive.

## Parameter sensitivity

With safety margin = 10 bps and benchmark = 0 bps:

| Venue / mode | X=10 bps | X=25 bps | X=50 bps |
|---|---:|---:|---:|
| Binance maker/maker | 40 | 55 | 80 |
| Binance maker/taker | 45 | 60 | 85 |
| Binance taker/taker | 50 | 65 | 90 |
| Kraken maker/maker | 100 | 115 | 140 |
| Kraken maker/taker | 140 | 155 | 180 |
| Kraken taker/taker | 180 | 195 | 220 |

If the same-horizon benchmark exceeds the 10 bps safety margin, replace the +10 term with the benchmark return. Example: with `X=20` and `B=70`, Binance maker/maker requires 110 bps gross edge, not 50 bps.

## Interpretation

- Kraken can only survive for short-horizon P300 strategies if a repeatable edge is large enough to clear a very high fee floor or if an eligible lower-fee/rebate pair is found and independently validated.
- Binance has much more favorable pure execution economics, but it remains outside the live candidate set while its Spain/EU regulatory eligibility is unverified by the Venue Gate.
- The next highest-value measurement is not another architecture feature. It is fresh spread/depth/fill evidence for eligible venues and candidate pairs.
