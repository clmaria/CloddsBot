# P300 Venue Gate — baseline 2026-09-12, updated 2026-09-13

A venue must pass every mandatory gate. Low fees alone never imply venue approval. Regulatory classifications below are evidence snapshots for research, not legal advice; current regulator/ESMA records remain authoritative before any promotion.

## Gate dimensions

1. Regulatory eligibility for a Spain-resident user when the venue is being considered for execution.
2. Pair availability and fresh venue metadata.
3. Order-type-specific market constraints.
4. Risk/reducibility compatibility.
5. Execution economics: fees, spread, slippage, adverse selection and non-fill cost.
6. Reporting/export completeness for a tax-ready ledger.
7. Operational/API reliability.
8. Execution-adapter readiness, considered only after the pre-adapter gates pass.

A venue used only as a public market-data reference is not thereby promoted as an execution venue. Execution eligibility and reference-data usefulness are separate decisions.

Spain's MiCA transition ended on 1 July 2026; CNMV states that only providers with the required authorization may operate after the transition.

## Bitvavo — primary execution/research candidate

Regulatory: PASS provisional.
- Bitvavo states it is licensed by the Dutch AFM as a MiCA CASP and authorized to operate a crypto-asset trading platform across EEA jurisdictions.

Technical research path: PASS provisional.
- P300 can parse Bitvavo market minima/quantity precision and reject non-trading markets.
- Public-book payloads can be normalized into the common read-only microstructure model.
- The local order-book synchronizer follows Bitvavo's published snapshot/buffer/nonce procedure and fails closed on sequence gaps.
- Public market-data research can be keyless.

Economics: UNVERIFIED.
- Bitvavo's crypto/USDC fee schedule makes BTC-USDC materially more interesting for the current short-horizon thesis than the EUR control path, but representative spread/non-fill/adverse-selection evidence is still missing.
- No venue is promoted from fee tables alone.

Current Edge-Thesis role:
- **BTC-USDC: primary Phase-A research target** for long-only anchored passive reversion.
- **BTC-EUR: control/comparator** for the same mechanism under higher transaction-cost economics.
- ETH/EUR is not part of the current thesis sample unless separately preregistered later.

Execution adapter: MISSING.
- No native Bitvavo execution integration was found in upstream CloddsBot.

Operational LIVE gate: OPEN.
- Current Bitvavo Trading Rules impose algorithmic-trading notification/identifier/testing obligations that must be reverified and satisfied before any future LIVE adapter is considered ready.

Overall: RESEARCH_ONLY. If regulatory/technical/reporting checks remain positive and Phase A/Phase B economics survive, the next state is ADAPTER_REQUIRED, not LIVE.

## Kraken — regulated comparator and direct-USDC reference

Regulatory: PASS provisional for execution consideration.
- Kraken states it is MiCA-authorized through the Central Bank of Ireland for EEA services.

Reference-data role: PASS provisional.
- Kraken currently exposes a genuine BTC/USDC Spot market and public Spot market-data APIs/WebSocket infrastructure.
- It is therefore a cleaner direct-USDC reference for the Bitvavo thesis than treating a Coinbase BTC-USDC alias as an independent USDC market.

Execution economics: WEAK / requires evidence.
- Reference Tier 1 Spot Crypto fees checked on 2026-09-12 were 40 bps maker and 80 bps taker per side.
- Fee-only round trip is therefore 80 / 120 / 160 bps for maker-maker / maker-taker / taker-taker before spread/slippage.
- A single observed tight spread does not offset that fee floor or constitute a distribution.

Constraints: runtime refresh required.
- Human-readable minimum documentation has shown inconsistent BTC examples.
- Fresh venue metadata must be authoritative at preflight time.

Execution adapter: MISSING.
- No native Kraken execution integration was found in upstream CloddsBot.

Overall: useful **REFERENCE_DATA + regulated comparator**; RESEARCH_ONLY / weak execution economics until evidence proves otherwise.

## OKX Europe — secondary regulated candidate

Regulatory: PASS provisional.
- OKX Europe states it holds a MiCA CASP authorization from the Malta Financial Services Authority, passported across the EEA.

Technical research path: PASS provisional.
- P300 has read-only OKX public order-book normalization.
- Pair metadata and exact usable constraints still require fresh verification before committing sampling effort.

Economics: UNVERIFIED.
- Current EEA fee applicability must be reconciled before a dated fee baseline is frozen.
- Representative spread/depth/slippage evidence is also missing.

Execution adapter: MISSING.
- No native OKX trading integration was found in upstream CloddsBot.

Overall: RESEARCH_ONLY / WATCH until fees, metadata and microstructure are reconciled.

## Binance — direct-USDC reference; blocked/unverified for LIVE execution

Reference-data role: PASS provisional.
- Binance currently exposes an active BTC/USDC Spot market and public Spot market data.
- It may be used as an independent public BTC-USDC reference for Phase A without promoting Binance as an execution venue.

Economics: materially stronger fee floor in the dated EUR baseline, but this does not affect the regulatory gate.
- Reference regular-user EUR fiat fees checked on 2026-09-12 were 10 bps maker and 15 bps taker per side.

Regulatory: BLOCKED / UNVERIFIED for Spain execution.
- Binance stated on 24 June 2026 that it withdrew its Greek MiCA application and would pursue authorization in another EU Member State.
- No later primary evidence has yet been accepted by this gate showing a MiCA CASP authorization applicable to Spain.
- Cheaper execution cannot compensate for an unresolved mandatory regulatory gate.

Technical integration: PARTIAL, not native Spot-ready.
- Upstream CloddsBot has Binance market data and Futures execution.
- A verified Binance Spot execution adapter suitable for P300 was **not** established by the upstream audit.
- P300 size-filter research models LOT_SIZE and quote-notional minima, but market-order-specific `MARKET_LOT_SIZE` / notional-application semantics remain incomplete.

Overall: **REFERENCE_DATA / RESEARCH COMPARATOR**; BLOCKED_REGULATORY/UNVERIFIED for LIVE execution until current authorization applicable to Spain is demonstrated.

## Coinbase — diagnostic only for the direct-USDC thesis

Coinbase remains useful as an independent broad-market/USD diagnostic source, but it is not counted as one of the two primary direct-USDC references for Phase A.

Reason:
- current Coinbase Advanced Trade public-channel documentation states that subscriptions to most `-USDC` products return the same data as the corresponding `-USD` product;
- product metadata can expose `BTC-USDC` as an alias of `BTC-USD`.

Counting that alias as a second direct-USDC venue would create false independence. Any later Coinbase-based synthetic normalization must be preregistered as a separate cohort and must not be silently mixed with the Kraken+Binance direct-USDC cohort.

## Selection rule

Execution-venue ranking is lexicographic, not a weighted score:

REGULATORY ELIGIBILITY
  -> TECHNICAL TRADABILITY
  -> RISK / REDUCIBILITY
  -> ECONOMICS / EFFECTIVE HURDLE
  -> REPORTING / OPERATIONS
  -> ADAPTER BUILD DECISION
  -> PAPER / TESTNET
  -> HUMAN-GATED LIVE

A failure in a mandatory execution gate is not compensated by strength in another gate.

Reference-data selection is separate: data must be public/usable, semantically understood, independent enough for the intended estimator, fresh, and quality-controlled. Reference selection never grants execution eligibility.

## Next evidence required

Highest-value next evidence:
- complete the Phase-A monotonic receive-time refactor before cross-feed timing collection;
- collect Bitvavo BTC-USDC independent dislocation episodes using **Kraken BTC/USDC + Binance BTCUSDC** as the primary direct-USDC reference pair;
- collect Bitvavo BTC-EUR as the control cohort for the same mechanism;
- keep generic venue-baseline sampling separate from Edge-Thesis episodes;
- resolve maker-fill timing into the same-process monotonic domain before reporting fill probability/non-fill cost;
- current authoritative Binance MiCA/CASP status applicable to Spain before any execution reconsideration.
