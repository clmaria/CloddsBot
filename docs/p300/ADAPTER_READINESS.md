# P300 Adapter Readiness

This document records execution-adapter readiness separately from venue economics.
A venue may be economically attractive and still be expensive to integrate.

## Upstream CloddsBot evidence

### Binance
Status: NATIVE SUPPORT

Upstream CloddsBot contains Binance-specific agent handlers, credentials flow, Binance Futures integration, platform routing and crypto feed support.

Implication: if Binance ever passes the Spain/EU regulatory gate, implementation cost is materially lower than adding a new venue from scratch.

### Bitvavo
Status: NO NATIVE EXECUTION ADAPTER FOUND

No Bitvavo integration was found in the upstream repository code search.
P300 currently contains read-only market-constraint and order-book normalization support only.

Implication: do not build an execution adapter until Bitvavo first passes economics and evidence gates. Adapter work is an opportunity cost, not free infrastructure.

### Kraken
Status: NO NATIVE EXECUTION ADAPTER FOUND

No Kraken integration was found in the upstream repository code search.
P300 currently contains read-only market-constraint and order-book normalization support only.

Implication: Kraken must justify both its higher trading fees and the cost of adding execution support.

### OKX
Status: NO NATIVE EXECUTION ADAPTER FOUND

No OKX trading integration was found in upstream code search; the only `OKX` match was unrelated NOAA weather metadata.
P300 currently contains read-only order-book normalization support only.

Implication: treat OKX as research-only until economics, regulatory applicability and integration value justify adapter work.

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
