# P300 Phase A — Evidence Envelope v1

Status: **SPECIFICATION ONLY / RESEARCH / NO EXECUTION**

Purpose: define the minimum immutable evidence needed to reproduce, falsify and audit one Phase A episode without introducing a database or execution capability.

## Storage principle

For the small Phase A sample, prefer append-only files over a database:

- raw market-data events: newline-delimited JSON (NDJSON), partitioned by source/session/day;
- one immutable episode envelope JSON per episode/control;
- one manifest containing file hashes, collector/config version and cohort identity.

Do not add a database, queue or dashboard unless the evidence volume proves that flat append-only storage is insufficient. Phase A is an experiment, not a platform.

## Envelope identity

Every envelope must include:

- `schemaVersion`: fixed to `p300.phase-a.envelope.v1`;
- `cohortId`: identifies the frozen source/methodology cohort;
- `episodeId`: stable unique ID;
- `kind`: `underpriced_episode`, `overpriced_control`, `background_control`, or `invalid_episode`;
- `collectorVersion` / source commit SHA;
- `configHash`: hash of the exact preregistered thresholds/horizons/data-quality limits;
- `createdAtUtc`;
- `contentHash`: canonical SHA-256 of the finalized envelope excluding the hash field itself.

An envelope is never updated in place after finalization. Corrections create a superseding envelope that names the superseded `episodeId` and reason.

## Clock fields

Never collapse distinct clocks into one generic timestamp.

For every source observation record:

- `receivedWallMs`: local UTC wall-clock receive time;
- `receivedMonoNs`: local monotonic receive time, stored as a decimal string/bigint-safe value;
- `exchangeEventTime`: optional and only populated when the venue documents its semantics for that event type;
- `exchangeEventTimeSemantics`: explicit label, for example `trade_execution`, `book_update`, `server_event`, or `not_available`.

Cross-feed actionable ordering and skew use `receivedMonoNs`. Wall time supports audit/reconciliation. Exchange time is provenance/diagnostic unless the protocol explicitly allows it.

Bitvavo `book.timestamp` must not be labeled `book_update`; current documentation describes it as the timestamp of the last transaction event.

## Target state

Store the synchronized Bitvavo BTC-USDC state used at the actionable observation:

- market status evidence;
- book `nonce`;
- BBO ticker values and local receive clocks;
- local-book BBO and local receive clocks;
- whether ticker and synchronized book agree;
- actionable observation clock = later monotonic receive instant of the agreeing target state;
- top-N or ticket-sufficient book depth used for economics;
- spread, midpoint, fixed-ticket VWAP/slippage;
- imbalance value and depth definition;
- dynamic market metadata relevant to executability: base minimum, quote minimum, quantity precision, tick size, market status and metadata-observed time.

If ticker/book agreement is not reached inside the frozen sync-quality rule, the candidate is invalid rather than backdated.

## Reference state

For the primary direct-USDC cohort, store independently for each frozen reference venue:

- venue and exact market (`BTC-USDC`/`BTCUSDC`);
- BBO used;
- midpoint used;
- local receive clocks;
- optional documented exchange event time + semantics;
- feed/channel identifier;
- freshness at actionable target time.

Also store:

- reference-composite method/version;
- reference price;
- cross-reference dispersion in bps;
- cross-feed receive skew;
- all quality-gate PASS/FAIL flags.

Do not replace a missing primary reference with another venue inside the same cohort. A different source set means a different `cohortId`.

## Dislocation state

Store:

- signed target/reference deviation in bps;
- absolute deviation in bps;
- preregistered deviation bin;
- `direction`: underpriced / overpriced / flat;
- whether the observation belongs to the currently executable long-only side;
- trigger/rearm state used by the episode detector once that rule is finalized.

No field named `predictedEdge` is allowed in Phase A. The experiment measures behavior; it does not label a realized signal with an invented expected return.

## Raw-evidence pointers

The envelope must point to immutable raw-event ranges rather than duplicating the complete stream:

- source file/hash;
- first and last record offsets or sequence IDs used;
- target book snapshot reference;
- Bitvavo book/ticker/trade event range;
- Coinbase/Binance (or frozen fallback-cohort) reference event ranges.

The raw evidence must be sufficient to rebuild the target/reference observation without trusting derived fields in the envelope.

## Public-trade reconciliation

For every episode that reports fill-dependent evidence, store:

- Bitvavo WebSocket trade IDs captured in the active/reconciliation interval;
- public REST trade-query interval;
- REST trade IDs returned;
- missing-in-WebSocket IDs;
- unexpected/duplicate IDs;
- `tradeStreamIntegrityVerified` boolean;
- reconciliation timestamp and raw response hash.

If reconciliation fails, maker-fill results for that episode are invalid. Non-fill-dependent market/reversion measurements may remain usable if their own integrity gates pass.

## PAPER maker-fill evidence

Store separate evidence tiers; never collapse them into one result.

### Tier A — strict trade-through

For each preregistered active quote window:
- hypothetical side/price/quantity;
- activation clock and expiry clock;
- whether post-only would have rejected at activation;
- whether a correctly sided reconciled trade executed through the hypothetical limit before expiry;
- first strict-fill evidence time.

### Tier B — visible-queue model

Additionally store:
- visible queue ahead at activation;
- reconciled correctly sided volume at the exact price while active;
- queue remaining;
- inferred filled quantity/status under the conservative queue model;
- first/complete inferred fill times.

Cancellations never reduce queue-ahead in Tier B.

If Tier A and Tier B disagree, preserve the disagreement. Tier B success may not be presented as Tier A evidence.

## Forward outcomes

At every preregistered horizon, store:

- horizon label;
- target BBO/mid known at the observation point;
- reference components and composite known at that point;
- signed deviation;
- absolute deviation;
- gross convergence from episode start;
- target-only return;
- reference return;
- same-horizon no-trade/hold benchmark field once finalized;
- data-quality validity.

A missing/invalid horizon is stored as missing/invalid; never forward-fill it.

## Economics fields

Phase A economics are descriptive and must separate measured from assumed values:

- venue fee schedule identity/source date;
- maker/taker fee assumptions applicable to the hypothetical path;
- fee-only round-trip floor;
- observed spread;
- fixed-ticket slippage/depth metrics;
- maker fill tier/window;
- adverse-selection measurement after hypothetical fill;
- infrastructure cost assumption (currently zero incremental paid infrastructure for Phase A);
- operational/admin cost fields, allowed to remain `unknown` rather than fabricated.

Do not include tax as a synthetic per-trade fee. Tax/accounting remains a separate operational/after-tax layer.

## Quality and invalidation

Every envelope contains an explicit list of quality checks, each with status and reason. At minimum:

- target book continuity;
- target ticker/book agreement;
- market status;
- clock sanity;
- source freshness;
- reference dispersion;
- cross-feed receive skew;
- raw payload parse validity;
- trade reconciliation integrity when fill evidence is used;
- forward-horizon completeness.

An invalid episode is stored rather than silently dropped, with the invalidation reason. It does not count toward the valid Phase A sample.

## Separation from tax/execution ledger

Phase A contains no real executions, so the research envelope must not be overloaded with future tax-lot or account/order fields.

If the project ever reaches human-approved LIVE, real fills require a separate tax-ready execution ledger containing order/fill IDs, fees, EUR valuation, acquisition-lot linkage and realized gains/losses. That ledger is downstream and must not be faked from PAPER evidence.

## Promotion rule

A future collector implementation is acceptable only if tests demonstrate that an envelope can be rebuilt from recorded raw evidence and that malformed/stale/out-of-sequence inputs fail closed.

Completing this envelope contract does not make the strategy PAPER_READY or LIVE_READY; it only defines what evidence must exist before those decisions can be made.