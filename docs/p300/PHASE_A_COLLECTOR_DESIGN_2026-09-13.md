# P300 Phase A — Keyless Collector Design

Date: 2026-09-13
Status: **DESIGN ONLY / RESEARCH / NO EXECUTION**

This document describes the minimum public-data collector needed to execute the preregistered Phase A screening protocol. It deliberately contains no private API client, order path, credential handling or LIVE capability.

## Design decision

Phase A should use only public/keyless market-data surfaces. The experiment asks whether an observable edge exists from the collector's own point of reception. It does **not** attempt to reconstruct matching-engine latency or prove sub-millisecond venue leadership.

WS Market Data Pro is therefore not required for Phase A. Bitvavo's standard REST/WebSocket APIs remain available, while Market Data Pro is an optional authenticated low-latency/full-fidelity upgrade. Any future need for Pro must be justified by surviving economics, not assumed upfront.

## Primary comparable markets

Use direct USDC-quoted markets where available:
- target: Bitvavo `BTC-USDC`;
- reference A: Coinbase Exchange `BTC-USDC`;
- reference B: Binance Spot `BTCUSDC`.

Direct USDC references are preferred over synthetic USD/USDT conversions because they remove stablecoin-basis conversion from the primary path. Synthetic normalization remains a fallback cohort only and must never be silently mixed with the direct-USDC cohort.

## Bitvavo public surfaces

Use one standard public WebSocket connection where practical, subscribing to:
- `ticker` — BBO-change trigger; emits whenever best bid or ask changes;
- `book` — synchronized depth and `nonce` state;
- `trades` — public executed trades and taker side.

Use public REST for:
- `/{market}/book` — initial/resynchronization snapshot;
- `/markets` — market status, minimums, tick/precision and fee category metadata;
- `/{market}/trades` — post-episode reconciliation of WebSocket trade capture.

No Bitvavo API key is required for these public endpoints. Authentication may provide higher rate limits but should not be introduced into Phase A unless public limits prove insufficient.

## Reference surfaces

### Coinbase Exchange

Use the public `level2_batch` feed for `BTC-USDC` if the pair is accepted by the feed at runtime. It delivers Level-2 updates in 50 ms batches without authentication. Maintain a local BBO from the snapshot/update stream.

If the direct pair is unavailable at runtime, fail the direct-USDC cohort closed. Do not silently substitute a synthetic reference inside an existing cohort.

### Binance Spot

Use the public `BTCUSDC@bookTicker` stream. It pushes best-bid/best-ask price or size changes in real time and requires no user-data authentication.

The `bookTicker` payload does not provide an event timestamp, so it must be stamped on receipt with the same local clocks used for the other feeds.

## Clock model

Timestamp every received market-data message immediately on callback entry with:
1. local wall-clock epoch milliseconds for age/audit;
2. local monotonic nanoseconds for ordering and receive-time deltas.

Retain exchange timestamps separately when present and semantically documented, but do not use them as the primary cross-venue alignment clock.

Bitvavo `book.timestamp` is specifically **not** the event time of every book mutation; documentation describes it as the nanosecond timestamp of the last transaction event. It may be stored as provenance only.

Bitvavo `trade.timestampNs` is a transaction timestamp and should remain precision-safe text/bigint until intentional conversion.

## Actionable target observation

A Bitvavo `ticker` event is the primary BBO-change trigger. Do not immediately create an observation unless the latest synchronized Bitvavo local book agrees with the ticker BBO.

If ticker and local-book BBO disagree:
- wait for the synchronized book to catch up;
- create the observation only once both represent the same BBO;
- timestamp the actionable observation at the **later local monotonic receive time** of the matching ticker/book state;
- invalidate the candidate if synchronization/freshness bounds are exceeded.

This intentionally delays rather than backdates evidence. Missing a short-lived opportunity is preferable to inventing one.

## Reference observation

At each actionable target observation, read the latest valid Coinbase and Binance direct-USDC BBO states as known at or before that local monotonic instant.

Reject the observation if:
- either reference is missing/stale;
- a reference book is crossed or malformed;
- reference receive-time skew exceeds the preregistered data-quality limit;
- reference mids disagree beyond the preregistered dispersion limit.

The reference fair-value estimator should remain deliberately simple in Phase A: use the two direct-USDC midpoint observations plus an explicit dispersion diagnostic. Do not optimize venue weights from Phase A outcomes.

## Trade-stream integrity

WebSocket connection continuity alone is insufficient proof that no public trade event was missed.

After each completed/invalidated episode, query public Bitvavo `GET /{market}/trades` for a time window covering the episode and reconcile by unique trade ID against the WebSocket capture.

For conservative maker-fill evidence:
- if a REST trade in the relevant interval is absent from the WebSocket capture, mark `tradeStreamIntegrityVerified = false`;
- do not infer maker fills for that episode;
- keep the episode only for non-fill-dependent market/reversion measurements if the other data-quality gates remain valid.

## Fill evidence tiers

Maintain two explicitly separate PAPER evidence tiers:

**Tier A — strict:** a correctly sided public trade executes through the hypothetical maker limit while the quote is active and trade-stream integrity is verified. This is the strongest public evidence of a fill.

**Tier B — visible-queue model:** correctly sided public trades at the hypothetical limit consume the entire displayed queue that was already resting ahead plus the hypothetical order quantity, using the conservative price-time model. Cancellations never reduce queue-ahead in this model.

Do not merge Tier A and Tier B into one fill-rate statistic. If the thesis only works under Tier B, report that dependency as execution-model fragility.

Current public rules/API do not expose an iceberg/hidden-limit option that was found in this review, but absence of documented support is not proof that no undisplayed liquidity can ever exist. Keeping Tier A separate protects against overconfidence.

## Standard feed vs Market Data Pro

Standard public feeds are adequate for Phase A if they can produce enough integrity-valid episodes under the receive-time methodology above.

Escalate to Market Data Pro only if Phase A cannot answer the economic question because standard-feed conflation/fidelity is demonstrably the binding limitation. Such escalation would create a new evidence cohort and a new operational-cost term; it cannot retroactively upgrade standard-feed evidence.

## Fail-closed conditions

Stop collecting comparable observations and resynchronize/reconnect on:
- Bitvavo nonce gap/duplicate or uncertain order-book continuity;
- WebSocket disconnect with uncertain continuity;
- crossed/malformed book;
- stale/missing reference;
- ticker/local-book BBO mismatch beyond the allowed sync window;
- clock anomaly;
- REST/WebSocket trade reconciliation failure for fill-dependent evidence;
- market status other than normal `trading` when status evidence is available.

## Promotion boundary

This collector, when eventually implemented, may only write immutable evidence. It must have no module dependency on order submission, private account state, credentials, capital authorization or LIVE execution.

A successful Phase A still does not justify an execution adapter. Phase B OOS evidence, Economics Gate, Risk Envelope, regulatory/operational gates and explicit human approval remain downstream.