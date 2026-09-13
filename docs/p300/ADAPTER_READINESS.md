# P300 Adapter Readiness

This document records execution-adapter readiness separately from venue economics.
A venue may be economically attractive and still be expensive to integrate.

## Upstream CloddsBot evidence

### Binance
Status: **PARTIAL NATIVE SUPPORT — MARKET DATA + FUTURES, NOT SPOT EXECUTION**

The upstream repository contains:
- Binance-backed crypto market-data feed support;
- Binance credentials/agent plumbing;
- explicit `binance-futures` execution handlers for long/short/close and leverage.

The audited handler path imports `exchanges/binance-futures`; no Binance **spot** execution adapter was verified.

Implication: Binance is cheaper to reuse for reference market data than a venue with no integration at all, but P300 must **not** count Futures execution as Spot readiness. Because leverage/futures are outside the P300 Risk Envelope, an eventual Binance Spot path would still require separate implementation and validation if Binance ever passed the Spain/EU regulatory gate.

### Bitvavo
Status: **NO NATIVE EXECUTION ADAPTER FOUND**

No Bitvavo execution integration was found in the upstream repository code audit.
P300 currently contains read-only market-constraint and order-book normalization support only.

Bitvavo does expose the public/read-only primitives needed for evidence collection (market metadata, order book and trades), so **research-data integration is materially smaller than execution integration**.

Implication: do not build an execution adapter until Bitvavo first passes economics and Edge Thesis falsification gates. Adapter work is an opportunity cost, not free infrastructure.

### Kraken
Status: **NO NATIVE EXECUTION ADAPTER FOUND**

No Kraken execution integration was found in the upstream repository code audit.
P300 currently contains read-only market-constraint and order-book normalization support only.

Implication: Kraken must justify both its higher trading fees and the cost of adding execution support.

### OKX
Status: **NO NATIVE EXECUTION ADAPTER FOUND**

No verified OKX trading integration was found in the upstream audit.
P300 currently contains read-only order-book normalization support only.

Implication: treat OKX as research-only until economics, regulatory applicability and integration value justify adapter work.

### Hyperliquid
Status: **NATIVE SPOT EXECUTION EXISTS UPSTREAM — NOT PROMOTED FOR P300**

Upstream CloddsBot contains explicit Hyperliquid Spot handlers for:
- listing spot markets;
- reading the order book;
- spot buy;
- spot sell;
- market and limit execution.

That is technically useful evidence: Clodds is capable of a real Spot execution integration. It does **not** make Hyperliquid a P300 candidate automatically.

P300 currently has no recorded regulatory PASS for Hyperliquid under the Spain/EEA Venue Gate, and its quote-asset/operational model differs from the EUR-first shortlist. Under the lexicographic gate, technical convenience cannot compensate for an unresolved/failed higher-order gate.

Implication: keep Hyperliquid as an implementation reference, not an execution target.

## Upstream strategy audit note

Several upstream “crypto” strategies do **not** provide reusable Spot edge/execution evidence:
- `crypto-hft` is 15-minute Polymarket crypto-binary trading;
- `hft-divergence` uses Spot prices as a leading signal but executes/tracks Polymarket positions;
- the generic BotManager mean-reversion/momentum strategies are scaffolds, not validated P300 edge evidence;
- the BotManager's simplified backtest currently returns an empty result rather than replaying historical market data.

Therefore P300 must not treat upstream strategy names or backtest plumbing as evidence of a realizable Spot edge.

## Promotion rule

Adapter implementation is downstream of evidence:

REGULATORY PASS
  -> MARKET-DATA / CONSTRAINTS PASS
  -> MICROSTRUCTURE EVIDENCE PASS
  -> ECONOMICS / EFFECTIVE HURDLE PASS
  -> EDGE THESIS SURVIVES FALSIFICATION
  -> ADAPTER BUILD DECISION
  -> PAPER / TESTNET
  -> HUMAN-GATED LIVE

Do not invert this sequence. Building adapters before economic evidence consumes the P300 attention budget without proving that the venue deserves to exist in the system.

## Current implementation decision

The only new build justified by the current evidence is a **read-only evidence collector/analyzer** for the primary Edge Thesis. It must have no order-submission capability and must fail closed on stale, malformed, out-of-sequence or incomparable data.