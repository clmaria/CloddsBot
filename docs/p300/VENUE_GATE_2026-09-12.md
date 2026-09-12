# P300 Venue Gate — 2026-09-12

A venue must pass every mandatory gate. Low fees alone never imply venue approval. Regulatory classifications below are evidence snapshots for research, not legal advice; current regulator/ESMA records remain authoritative before any promotion.

## Gate dimensions

1. Regulatory eligibility for a Spain-resident user.
2. Pair availability and fresh venue metadata.
3. Order-type-specific market constraints.
4. Risk/reducibility compatibility.
5. Execution economics: fees, spread, slippage, adverse selection and non-fill cost.
6. Reporting/export completeness for a tax-ready ledger.
7. Operational/API reliability.
8. Execution-adapter readiness, considered only after the pre-adapter gates pass.

Spain's MiCA transition ended on 1 July 2026; CNMV states that only providers with the required authorization may operate after the transition.

## Bitvavo — primary research candidate

Regulatory: PASS provisional.
- Bitvavo states it is licensed by the Dutch AFM as a MiCA CASP and authorized to operate a crypto-asset trading platform across EEA jurisdictions.

Technical research path: PASS provisional.
- P300 can parse Bitvavo market minima/quantity precision and reject non-trading markets.
- Public-book payloads can be normalized into the common read-only microstructure model.

Economics: UNVERIFIED.
- Fee structure is materially below Kraken's reference Spot Crypto tier, but representative BTC/EUR and ETH/EUR spread/slippage distributions have not yet been captured.
- No venue is promoted from fee tables alone.

Execution adapter: MISSING.
- No native Bitvavo execution integration was found in upstream CloddsBot.

Overall: RESEARCH_ONLY. If regulatory/technical/reporting checks remain positive and microstructure/economics pass, the next state is ADAPTER_REQUIRED, not LIVE.

## Kraken — regulated comparator

Regulatory: PASS provisional.
- Kraken states it is MiCA-authorized through the Central Bank of Ireland for EEA services.

Economics: WEAK / requires evidence.
- Reference Tier 1 Spot Crypto fees checked on 2026-09-12 were 40 bps maker and 80 bps taker per side.
- Fee-only round trip is therefore 80 / 120 / 160 bps for maker-maker / maker-taker / taker-taker before spread/slippage.
- A single observed tight spread does not offset that fee floor or constitute a distribution.

Constraints: runtime refresh required.
- Human-readable minimum documentation has shown inconsistent BTC examples.
- Fresh AssetPairs metadata must be authoritative at preflight time.

Execution adapter: MISSING.
- No native Kraken execution integration was found in upstream CloddsBot.

Overall: RESEARCH_ONLY / weak economics comparator until representative evidence proves otherwise.

## OKX Europe — secondary regulated candidate

Regulatory: PASS provisional.
- OKX Europe states it holds a MiCA CASP authorization from the Malta Financial Services Authority, passported across the EEA.

Technical research path: PASS provisional.
- P300 has read-only OKX public order-book normalization.
- BTC/EUR appears in OKX EEA API documentation/examples, but pair metadata and exact usable constraints still require fresh verification.

Economics: UNVERIFIED.
- Current EEA fee applicability must be reconciled before a dated fee baseline is frozen.
- Representative spread/depth/slippage evidence is also missing.

Execution adapter: MISSING.
- No native OKX trading integration was found in upstream CloddsBot.

Overall: RESEARCH_ONLY / WATCH until fees, metadata and microstructure are reconciled.

## Binance — research comparator, blocked for LIVE eligibility

Economics: materially stronger fee floor in the dated baseline.
- Reference regular-user EUR fiat fees checked on 2026-09-12 were 10 bps maker and 15 bps taker per side.
- Fee-only round trip: 20 / 25 / 30 bps.

Regulatory: BLOCKED / UNVERIFIED for Spain.
- Binance stated on 24 June 2026 that it withdrew its Greek MiCA application and would pursue authorization in another EU Member State.
- No later primary evidence has yet been accepted by this gate showing a MiCA CASP authorization applicable to Spain.
- Cheaper execution cannot compensate for an unresolved mandatory regulatory gate.

Technical integration: strongest of the four.
- Upstream CloddsBot already contains native Binance integration.
- P300 size filters model LOT_SIZE and quote-notional minima, but market-order-specific `MARKET_LOT_SIZE` / notional-application semantics remain incomplete.

Overall: BLOCKED_REGULATORY for LIVE; research comparator only until current authorization applicable to Spain is demonstrated.

## Selection rule

Venue ranking is lexicographic, not a weighted score:

REGULATORY ELIGIBILITY
  -> TECHNICAL TRADABILITY
  -> RISK / REDUCIBILITY
  -> ECONOMICS / EFFECTIVE HURDLE
  -> REPORTING / OPERATIONS
  -> ADAPTER BUILD DECISION
  -> PAPER / TESTNET
  -> HUMAN-GATED LIVE

A failure in a mandatory gate is not compensated by strength in another gate.

## Next evidence required

Highest-value next evidence:
- Phase-A microstructure samples for Bitvavo BTC/EUR and ETH/EUR using the bounded sampling plan;
- equivalent Kraken samples as the regulated comparator;
- current OKX EEA fee and pair-metadata reconciliation before spending sampling effort there;
- maker fill probability/non-fill cost only if a maker-style Edge Thesis survives the basic cost gate;
- current authoritative Binance MiCA/CASP status applicable to Spain before reconsideration.
