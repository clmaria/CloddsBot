# P300 Open Gates

This file records unresolved gates so the draft PR cannot be mistaken for LIVE-ready.

## 1. Dynamic venue metadata is mandatory

Do not authorize trading from hardcoded exchange minimums.

Size constraints now fail closed on non-finite data, missing executable minima and malformed step sizes. Kraken/Bitvavo/Binance size metadata parsers are covered by tests.

Still open before a limit/market execution path can be considered complete:
- explicit price tick / price precision in the common market-constraint model;
- order-type-specific size/notional rules where venues distinguish market from limit orders;
- Binance `MARKET_LOT_SIZE` and market-application semantics for notional filters;
- fresh runtime metadata rather than support-table constants.

Kraken human-readable minimum documentation has shown conflicting BTC examples, so fresh exchange metadata remains authoritative.

## 2. Public export gap

Several newer P300 modules exist and are tested but are not yet re-exported through `src/p300/index.ts`, including venue constraints, economics matrix and microstructure/venue-gate helpers. Earlier repository write attempts for that barrel-file change were blocked by tooling controls.

This is an integration gap, not a reason to bypass controls.

## 3. Remaining Risk Envelope hardening

Resolved in the current branch:
- all critical capital/risk numeric inputs reject NaN/Infinity;
- gross exposure <= authorized capital;
- slots × max risk per position <= daily loss;
- slot capacity can represent declared gross exposure;
- max drawdown >= max daily loss;
- max risk per position <= max position notional;
- stressed exit-slice requirements are checked in strategy preflight;
- corrupted automatic-degradation inputs fail closed.

Still pending before any LIVE consideration:
- explicit max-drawdown coherence with authorized capital for spot/no-leverage mode;
- correlation/aggregate-loss assumptions when concurrent slots are not independent;
- portfolio-level interaction of several individually valid envelopes.

## 4. Microstructure and Economics evidence still missing

The code can now normalize Bitvavo/Kraken/OKX public books, compute spread/VWAP/slippage, separate partial fills from fillable slippage distributions and validate comparable evidence sets.

What is still missing is representative real evidence. A venue/pair cannot pass Economics Gate until we have:
- spread distribution rather than a single snapshot;
- fillable slippage distributions by ticket size and side;
- insufficient-depth/capture-error rates;
- maker fill probability / non-fill opportunity cost where maker orders are relevant;
- adverse selection;
- same-horizon benchmark;
- API/infrastructure allocation;
- tax/admin workload and reporting quality.

A single live spread snapshot is not sufficient evidence.

## 5. Edge Thesis gate

A high effective hurdle is not an instruction to make Clodds search for a signal that claims an equally high edge.

A candidate needs a predeclared structural thesis:
- named counterparty;
- reason that counterparty repeatedly accepts worse economics;
- persistence mechanism;
- expected half-life/decay;
- holding horizon;
- falsification condition.

No credible thesis -> NO-GO for that candidate.

## 6. Venue adapters are downstream of evidence

Upstream Clodds has native Binance support, but Bitvavo, Kraken and OKX execution adapters were not found. P300 only has read-only normalization/constraint support for the research path.

Do not build new execution adapters until the venue has passed regulatory, technical, risk, economics and reporting gates. Adapter work consumes the Attention Budget.

## 7. Execution remains disconnected

P300 remains research/preflight/governance code. It is not authorized to place orders and has not been connected to LIVE execution.

Attempts to wire P300 directly into native execution/risk code were blocked by tooling controls and were not bypassed.

P300 may veto or reduce authority. It may not override a Clodds rejection, increase risk, or bypass the native Clodds risk engine.
