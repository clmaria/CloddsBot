# P300 Phase A — Evidence Envelope v1

Status: **SPECIFICATION ONLY / RESEARCH / NO EXECUTION**

Purpose: define the minimum immutable evidence needed to reproduce, falsify and audit one Phase A episode without introducing a database or execution capability.

## Storage principle

For the small Phase A sample, prefer append-only files over a database:
- raw market-data events: NDJSON, partitioned by source/session/day;
- one immutable episode envelope JSON per episode/control;
- one manifest containing file hashes, collector/config version and cohort identity.

Do not add a database, queue or dashboard unless evidence volume proves flat append-only storage insufficient. Phase A is an experiment, not a platform.

## Envelope identity

Every envelope must include:
- `schemaVersion`: `p300.phase-a.envelope.v1`;
- `cohortId`;
- `episodeId`;
- `kind`: `underpriced_episode`, `overpriced_control`, `background_control`, or `invalid_episode`;
- collector/source commit SHA;
- `configHash` of the frozen Phase-A configuration;
- `createdAtUtc` for human audit;
- `contentHash`: canonical SHA-256 of the finalized envelope excluding the hash field itself.

An envelope is never updated in place after finalization. Corrections create a superseding envelope naming the superseded `episodeId` and reason.

## Clock fields

Never collapse distinct clocks into one generic timestamp.

For every received source event record:
- `receivedWallMs`: local wall-clock receive time for human-readable audit/log correlation only;
- `receivedMonoNs`: same-process monotonic receive time, stored as a precision-safe decimal string;
- `exchangeEventTime`: optional and only populated where the venue documents its semantics for that event type;
- `exchangeEventTimeSemantics`: explicit label such as `trade_execution`, `server_event`, `last_transaction`, or `not_available`.

**Phase-A ordering, freshness, age, cross-feed skew and active-window boundaries use `receivedMonoNs` only.** Wall time must not drive causal ordering because NTP/system adjustments may move it. Exchange time is provenance/diagnostic unless a later protocol explicitly establishes a valid shared-clock mapping.

All timing-compared events in one episode must belong to the same collector process / monotonic clock domain. A collector restart invalidates any open episode.

Bitvavo `book.timestamp` must not be labeled `book_update`; current documentation describes it as the timestamp of the last transaction event. Bitvavo `trade.timestampNs` may be stored as trade-execution provenance, but it must not be compared directly with locally observed signal activation for Phase-A fill timing.

## Target state

Store the synchronized Bitvavo BTC-USDC state used at the actionable observation:
- market status evidence;
- book `nonce`;
- BBO ticker values + `receivedWallMs` + `receivedMonoNs`;
- local-book BBO + its latest relevant receive clocks;
- whether ticker and synchronized book agree;
- actionable observation `receivedMonoNs` = later monotonic receive instant of the agreeing target state;
- top-N or ticket-sufficient depth used for economics;
- spread, midpoint, fixed-ticket VWAP/slippage;
- imbalance value and depth definition;
- dynamic executability metadata: base minimum, quote minimum, quantity precision, tick size, market status and metadata-observed time.

If ticker/book agreement is not reached inside the frozen sync-quality rule, the candidate is invalid rather than backdated.

## Reference state

The primary Phase-A direct-USDC cohort uses:
- Kraken Spot `BTC/USDC`;
- Binance Spot `BTCUSDC` as public reference data only.

Store independently for each reference:
- venue and exact market;
- BBO used;
- midpoint used;
- `receivedWallMs` for audit;
- `receivedMonoNs` for timing;
- optional documented exchange event time + semantics;
- feed/channel identifier;
- monotonic freshness at actionable target time.

Also store:
- reference-composite method/version;
- reference price;
- cross-reference dispersion in bps;
- cross-feed monotonic receive skew;
- all quality-gate PASS/FAIL flags.

Coinbase may appear as an auxiliary USD diagnostic source but is not counted as an independent primary direct-USDC component because its public `-USDC` channels can alias the corresponding `-USD` data.

Do not replace a missing primary reference with another venue inside the same cohort. A different source set means a different `cohortId`.

## Dislocation state

Store:
- signed target/reference deviation in bps;
- absolute deviation in bps;
- preregistered deviation bin;
- `direction`: underpriced / overpriced / flat;
- whether the observation belongs to the currently executable long-only side;
- trigger/rearm state used by the episode detector once frozen.

No field named `predictedEdge` is allowed in Phase A. The experiment measures behavior; it does not label a realized signal with an invented expected return.

## Raw-evidence pointers

The envelope must point to immutable raw-event ranges rather than duplicating the complete stream:
- source file/hash;
- first and last record offsets or sequence IDs used;
- target book snapshot reference;
- Bitvavo book/ticker/trade event range;
- Kraken BTC/USDC reference event range;
- Binance BTCUSDC reference event range;
- optional auxiliary diagnostic source ranges.

Raw evidence must be sufficient to rebuild the observation without trusting derived fields in the envelope.

## Public-trade reconciliation

For any episode that eventually reports fill-dependent evidence, store:
- Bitvavo WebSocket trade IDs captured in the relevant interval;
- public REST reconciliation interval/query semantics;
- REST trade IDs returned where unambiguous reconciliation is possible;
- missing-in-WebSocket IDs;
- unexpected/duplicate IDs;
- `tradeStreamIntegrityVerified`;
- reconciliation timestamp and raw response hash.

If reconciliation/integrity cannot be established, fill-dependent evidence is invalid. Non-fill-dependent market/reversion measurements may remain usable if their own gates pass.

## PAPER maker-fill evidence — currently gated

The current queue helper is useful fixture/research logic but **must not yet produce Phase-A fill probability** because its active window is in Bitvavo exchange-trade time while signal activation is observed locally.

Before any fill evidence is promoted, activation, expiry and every captured trade arrival must be represented in the same-process `receivedMonoNs` domain (or another explicitly validated conservative clock mapping must be preregistered).

After that gate is resolved, preserve two separate evidence tiers:

### Tier A — strict trade-through
- hypothetical side/price/quantity;
- activation and expiry `receivedMonoNs`;
- whether post-only would have rejected at activation;
- whether a correctly sided, integrity-valid trade received while active executed through the hypothetical limit;
- first strict-fill evidence receive time.

### Tier B — visible-queue model
Additionally store:
- visible queue ahead at activation;
- correctly sided public traded volume at the exact price while active;
- queue remaining;
- inferred filled quantity/status under the conservative queue model;
- first/complete inferred fill receive times.

Cancellations never reduce queue-ahead in Tier B. If Tier A and Tier B disagree, preserve the disagreement. Tier B success may not be presented as Tier A evidence.

Until the monotonic fill-timing refactor is implemented and tested, these fields remain `not_evaluated_clock_gate` rather than false/zero.

## Forward outcomes

At every preregistered horizon measured from actionable `receivedMonoNs`, store:
- horizon label;
- target BBO/mid known at that point;
- Kraken/Binance direct-USDC reference components and composite known at that point;
- signed/absolute deviation;
- gross convergence from episode start;
- target-only return;
- reference return;
- same-horizon no-trade/hold benchmark field once finalized;
- data-quality validity.

A missing/invalid horizon is stored as missing/invalid; never forward-fill it.

## Economics fields

Phase A economics are descriptive and separate measured from assumed values:
- venue fee schedule identity/source date;
- maker/taker fee assumptions applicable to the hypothetical path;
- fee-only round-trip floor;
- observed spread;
- fixed-ticket slippage/depth metrics;
- maker-fill tier/window only after the fill clock gate is resolved;
- adverse-selection measurement only after valid hypothetical fill evidence exists;
- infrastructure cost assumption;
- operational/admin cost fields, allowed to remain `unknown` rather than fabricated.

Do not include tax as a synthetic per-trade fee. Tax/accounting remains a separate operational/after-tax layer.

## Quality and invalidation

Every envelope contains explicit quality checks with status/reason. At minimum:
- target book continuity;
- target ticker/book agreement;
- market status;
- monotonic clock-domain sanity;
- source freshness;
- reference dispersion;
- cross-feed monotonic receive skew;
- raw payload parse validity;
- trade integrity when fill evidence is used;
- forward-horizon completeness.

An invalid episode is stored rather than silently dropped, with the invalidation reason. It does not count toward the valid Phase A sample.

## Separation from tax/execution ledger

Phase A contains no real executions, so the research envelope must not be overloaded with future tax-lot or account/order fields.

If the project ever reaches human-approved LIVE, real fills require a separate tax-ready execution ledger containing order/fill IDs, fees, EUR valuation, acquisition-lot linkage and realized gains/losses. That ledger is downstream and must not be faked from PAPER evidence.

## Promotion rule

A future collector implementation is acceptable only if tests demonstrate that an envelope can be rebuilt from raw evidence and that malformed, stale, out-of-sequence, mixed-clock-domain inputs fail closed.

Completing this envelope contract does not make the strategy PAPER_READY or LIVE_READY; it only defines what evidence must exist before those decisions can be made.
