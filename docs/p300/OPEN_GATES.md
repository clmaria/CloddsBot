# P300 Open Gates

This file records unresolved gates so the draft PR cannot be mistaken for LIVE-ready.

## 1. Dynamic venue metadata is mandatory

Do not authorize trading from hardcoded exchange minimums.

Size constraints now fail closed on non-finite data, missing executable minima and malformed step sizes. Kraken/Bitvavo/Binance size metadata parsers are covered by tests.

Still open before a limit/market execution path can be considered complete:
- explicit price tick / price precision in the common market-constraint model;
- order-type-specific size/notional rules where venues distinguish market from limit orders;
- Binance `MARKET_LOT_SIZE` and market-application semantics for notional filters if Binance Spot is ever reconsidered;
- fresh runtime metadata rather than support-table constants.

Kraken human-readable minimum documentation has shown conflicting BTC examples, so fresh exchange metadata remains authoritative.

## 2. Public research surface

The anchored-reversion evidence analyzer and the fail-closed Bitvavo local-book synchronizer are now re-exported through `src/p300/index.ts`.

Some older research/helper modules may still be intentionally imported directly rather than surfaced through the barrel. That is not a LIVE blocker by itself. Any module required by a future integration path must be explicitly exported and covered by integration tests before promotion.

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

The code can now normalize Bitvavo/Kraken/OKX public books, compute spread/VWAP/slippage, separate partial fills from fillable slippage distributions, validate comparable evidence sets, build an anchored cross-venue observation and maintain a sequence-checked Bitvavo local book.

What is still missing is representative real evidence. A venue/pair cannot pass Economics Gate until we have:
- spread distribution rather than a single snapshot;
- fillable slippage distributions by ticket size and side;
- insufficient-depth/capture-error rates;
- conservative maker fill probability / non-fill opportunity cost;
- adverse selection after a hypothetical fill;
- same-horizon benchmark;
- API/infrastructure allocation;
- tax/admin workload and reporting quality.

A single live spread snapshot is not sufficient evidence.

## 5. Edge Thesis gate

A high effective hurdle is not an instruction to make Clodds search for a signal that claims an equally high edge.

The current primary research candidate is **long-only cross-venue-anchored passive reversion on Bitvavo BTC-USDC**. It remains EXPERIMENT, not GO. The overpriced side is research-only under the current envelope because monetizing it in Spot would require pre-existing BTC inventory or a forbidden short path.

Any candidate still needs a predeclared structural thesis:
- named counterparty;
- reason that counterparty repeatedly accepts worse economics;
- persistence mechanism;
- expected half-life/decay;
- holding horizon;
- falsification condition.

No credible thesis -> NO-GO for that candidate.

## 6. Venue adapters are downstream of evidence

The upstream audit corrected an earlier assumption:
- Binance integration provides market data and **Futures** execution, not a verified Binance Spot execution adapter;
- Hyperliquid has real Spot execution upstream but has not passed the P300 Spain/EEA Venue Gate and is not promoted;
- Bitvavo, Kraken and OKX Spot execution adapters were not found.

Therefore P300 currently has **no execution adapter that is both Spot-suitable and promoted for the experiment**.

Do not build an execution adapter until the venue has passed regulatory, technical, risk, economics and reporting gates. Adapter work consumes the Attention Budget.

## 7. Bitvavo algorithmic-trading operational gate

Bitvavo's current Trading Rules state that participants engaging in algorithmic trading must, before deployment, provide prior notice for a new algorithm or material algorithm change, provide a description and unique algorithm identifier, and perform appropriate successful testing. The unique identifier is to be included in orders/quotes generated or governed by the algorithm.

This does not block public read-only research or PAPER analysis. It **does block treating a future Bitvavo LIVE adapter as ready merely because the API works**.

Before any Bitvavo LIVE consideration, P300 must have evidence that:
- the required notification/registration process for the user's account has been completed;
- the algorithm identifier is represented in the adapter in the manner Bitvavo requires at that time;
- the required pre-deployment testing evidence exists;
- any later material algorithm change repeats the required governance step.

Runtime/current Bitvavo rules remain authoritative; re-verify before LIVE.

## 8. Execution remains disconnected

P300 remains research/preflight/governance code. It is not authorized to place orders and has not been connected to LIVE execution.

Attempts to wire P300 directly into native execution/risk code were blocked by tooling controls and were not bypassed.

P300 may veto or reduce authority. It may not override a Clodds rejection, increase risk, or bypass the native Clodds risk engine.
