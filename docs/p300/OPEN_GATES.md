# P300 Open Gates

This file records unresolved gates so the draft PR cannot be mistaken for LIVE-ready.

## 1. Dynamic venue metadata is mandatory

Do not authorize trading from hardcoded exchange minimums.

Kraken's public support material currently contains conflicting BTC minimum examples: one overview lists a 0.00005 BTC trade minimum while another support page still contains example text stating 0.0001 BTC. Kraken itself states that Assets/AssetPairs provide the market metadata needed for trading and that minimums can change.

Operational rule: AssetPairs / exchange metadata wins. Human-readable support tables are evidence only.

For Binance, symbol filters such as LOT_SIZE / MARKET_LOT_SIZE / MIN_NOTIONAL / NOTIONAL must be parsed dynamically. Market-order filters must not be assumed equal to limit-order filters.

## 2. Public export gap

`src/p300/venue-constraints.ts` and `src/p300/economics-matrix.ts` exist and are tested but are not yet exported through `src/p300/index.ts` because the repository write operation for that change was blocked by tooling controls.

This is an integration gap, not a reason to bypass controls.

## 3. Risk Envelope invariants still to harden

Current validation already checks key relationships such as:
- gross exposure <= authorized capital,
- slots × max risk per position <= daily loss,
- slot capacity can represent declared gross exposure,
- drawdown >= daily loss.

Still pending explicit validation before any LIVE consideration:
- max risk per position <= max position notional,
- max drawdown must be coherent with authorized capital for spot/no-leverage mode,
- all values must be finite and not NaN/Infinity,
- correlation/aggregate-loss assumptions when multiple slots are not independent,
- exit granularity requirement must be satisfiable under stressed venue constraints.

## 4. Economics evidence still missing

Fee baseline is documented, but a venue/par cannot pass Economics Gate until we also have representative evidence for:
- spread distribution,
- expected slippage by size/order type,
- fill probability / non-fill cost for maker orders,
- adverse selection,
- same-horizon benchmark,
- API/infrastructure allocation,
- tax/admin workload and reporting quality.

A single live spread snapshot is not sufficient evidence.

## 5. Edge Thesis gate

If the resulting Minimum Viable Edge is high, Clodds must not be instructed merely to search for a signal above that threshold.

A candidate needs a predeclared structural thesis:
- named counterparty,
- reason that counterparty repeatedly accepts worse economics,
- persistence mechanism,
- expected half-life/decay,
- holding horizon,
- falsification condition.

No credible thesis -> NO-GO for that candidate.

## 6. Execution remains disconnected

P300 currently remains research/preflight/governance code. It is not authorized to place orders and has not been connected to LIVE execution.

P300 may veto or reduce authority. It may not override a Clodds rejection, increase risk, or bypass the native Clodds risk engine.
