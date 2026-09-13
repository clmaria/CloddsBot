# P300 Phase A — Keyless Collector Design

Date: 2026-09-13
Status: **DESIGN ONLY / RESEARCH / NO EXECUTION**

This document describes the minimum public-data collector needed to execute the preregistered Phase A screening protocol. It deliberately contains no private API client, order path, credential handling or LIVE capability.

## Design decision

Phase A should use only public/keyless market-data surfaces. The experiment asks whether an observable edge exists from the collector's own point of reception. It does **not** attempt to reconstruct matching-engine latency or prove sub-millisecond venue leadership.

WS Market Data Pro is therefore not required for Phase A. Bitvavo's standard REST/WebSocket APIs remain available, while Market Data Pro is an optional authenticated low-latency/full-fidelity upgrade. Any future need for Pro must be justified by surviving economics, not assumed upfront.

## Primary comparable markets

Use genuine direct USDC-quoted markets:
- target: Bitvavo `BTC-USDC`;
- reference A: Kraken Spot `BTC/USDC`;
- reference B: Binance Spot `BTCUSDC`.

This replaces the earlier Coinbase `BTC-USDC` proposal. Coinbase's current public Advanced Trade documentation states that subscriptions to most `-USDC` products on public channels return the same data as the corresponding `-USD` product, and its product metadata can expose `BTC-USDC` as an alias of `BTC-USD`. It therefore must not be counted as an independent direct-USDC reference in the primary cohort.

Kraken currently exposes a real BTC/USDC Spot market and public Spot market-data APIs/WebSocket infrastructure. Binance currently exposes a real BTC/USDC Spot market. Neither reference venue is an execution candidate merely because its public data is used.

Direct USDC references avoid stablecoin-basis conversion in the primary path. Synthetic USD/USDT normalization remains a separate fallback cohort only and must never be silently mixed with direct-USDC evidence.

## Bitvavo public surfaces

Use one standard public WebSocket connection where practical, subscribing to:
- `ticker` — BBO-change trigger; emits whenever best bid or ask changes;
- `book` — synchronized depth and `nonce` state;
- `trades` — public executed trades and taker side.

Use public REST for:
- `/{market}/book` — initial/resynchronization snapshot;
- `/markets` — market status, minimums, tick/precision and fee category metadata;
- `/{market}/trades` — post-episode reconciliation of WebSocket trade capture.

No Bitvavo API key is required for these public market-data endpoints. Authentication may provide higher rate limits but should not be introduced into Phase A unless public limits prove insufficient.

## Reference surfaces

### Kraken Spot

Use public Spot WebSocket v2 market data for `BTC/USDC`, with ticker/book data as needed to maintain a current BBO. Kraken's public Spot market currently lists BTC/USDC. Phase A must stamp each accepted update at callback entry with the same local monotonic clock used for all other feeds.

Do not use Kraken as an execution venue merely because it is a reference-data source. Reference suitability and execution suitability are separate gates.

### Binance Spot

Use the public `BTCUSDC@bookTicker` stream, subject to runtime symbol/status verification from Spot exchange metadata. It pushes best-bid/best-ask changes and requires no private account state.

Do not rely on an exchange event timestamp for cross-feed alignment when the selected payload does not provide one. Stamp the update on receipt with the same local monotonic clock used for Bitvavo and Kraken.

Binance remains research/reference-only for P300 while its Spain/EEA LIVE venue gate is unresolved. Public reference data does not constitute promotion as an execution venue.

## Clock model

Timestamp every received market-data message immediately on callback entry with:
1. local wall-clock epoch milliseconds for human-readable audit/log correlation only;
2. local monotonic nanoseconds for ordering, freshness/age, receive-time deltas, cross-feed skew and hypothetical active windows.

Retain exchange timestamps separately when present and semantically documented, but do not use them as the primary cross-venue alignment clock.

Bitvavo `book.timestamp` is specifically **not** the event time of every book mutation; documentation describes it as the nanosecond timestamp of the last transaction event. It may be stored as provenance only.

Bitvavo `trade.timestampNs` is a transaction timestamp and should remain precision-safe text/bigint until intentional conversion. It must not be compared directly with a locally observed signal activation unless both are deliberately mapped into one defensible clock domain.

## Actionable target observation

A Bitvavo `ticker` event is the primary BBO-change trigger. Do not immediately create an observation unless the latest synchronized Bitvavo local book agrees with the ticker BBO.

If ticker and local-book BBO disagree:
- wait for the synchronized book to catch up;
- create the observation only once both represent the same BBO;
- timestamp the actionable observation at the **later local monotonic receive time** of the matching ticker/book state;
- invalidate the candidate if synchronization/freshness bounds are exceeded.

This intentionally delays rather than backdates evidence. Missing a short-lived opportunity is preferable to inventing one.

## Reference observation

At each actionable target observation, read the latest valid Kraken and Binance BTC-USDC BBO states that were received at or before that local monotonic instant.

Reject the observation if:
- either reference is missing/stale;
- a reference book/BBO is crossed or malformed;
- reference receive-time skew exceeds the preregistered data-quality limit;
- the two reference mids disagree beyond the preregistered dispersion limit.

The reference fair-value estimator should remain deliberately simple in Phase A: use the two direct-USDC midpoint observations plus an explicit dispersion diagnostic. Do not optimize venue weights from Phase A outcomes.

Coinbase may be retained only as a diagnostic USD market/control source. It is not counted as an independent direct-USDC component in the primary reference.

## Trade-stream integrity

WebSocket connection continuity alone is insufficient proof that no public trade event was missed.

After each completed/invalidated episode, query public Bitvavo trade history for a time window covering the episode and reconcile by unique trade ID against the WebSocket capture when the public API supports the required window unambiguously.

For conservative maker-fill evidence:
- if trade capture integrity cannot be established, do not infer maker fills for that episode;
- keep the episode only for non-fill-dependent market/reversion measurements if the other data-quality gates remain valid.

## Fill evidence tiers

Maintain two explicitly separate PAPER evidence tiers after the clock-domain blocker is resolved:

**Tier A — strict:** a correctly sided public trade executes through the hypothetical maker limit while the quote is active and trade-stream integrity is verified. This is the strongest public evidence of a fill.

**Tier B — visible-queue model:** correctly sided public trades at the hypothetical limit consume the entire displayed queue that was already resting ahead plus the hypothetical order quantity, using the conservative price-time model. Cancellations never reduce queue-ahead in this model.

Do not merge Tier A and Tier B into one fill-rate statistic. If the thesis only works under Tier B, report that dependency as execution-model fragility.

The existing queue model is currently fixture/research logic only because its active window is expressed in the exchange trade-timestamp domain while signal activation is observed locally. It must not produce Phase-A fill-probability claims until activation/trade arrivals share the same-process monotonic clock or another explicitly validated latency mapping is introduced.

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
- local monotonic clock anomaly or collector restart that changes the clock domain during an open episode;
- unresolved trade-stream integrity failure for fill-dependent evidence;
- market status other than normal `trading` when status evidence is available.

## Promotion boundary

This collector, when eventually implemented, may only write immutable evidence. It must have no module dependency on order submission, private account state, credentials, capital authorization or LIVE execution.

A successful Phase A still does not justify an execution adapter. Phase B OOS evidence, Economics Gate, Risk Envelope, regulatory/operational gates and explicit human approval remain downstream.
