# P300 Phase A — Anchored Passive Reversion Screening Protocol

Date: 2026-09-13
Status: **RESEARCH / PAPER ONLY**

This protocol is preregistered before representative evidence is collected. It is designed to falsify the current Bitvavo BTC-USDC anchored passive-reversion thesis, not to optimize a trading strategy.

## 1. Decision supported

Phase A answers one question only:

> Is there enough observable, mechanically plausible economic room in long-only BTC-USDC anchored passive reversion to justify a larger OOS Phase B?

Phase A cannot authorize LIVE, cannot increase capital/autonomy, cannot select a final strategy, and cannot establish statistical significance.

## 2. Current hypothesis

Target venue/pair: Bitvavo BTC-USDC.

Hypothesis: transient local aggressive flow/inventory pressure can leave Bitvavo temporarily cheap relative to a fresh cross-venue reference, after which some of the local dislocation reverts.

Current envelope can monetize only the buy-first / long-only side. Overpriced observations are retained as research/control evidence but are not treated as executable opportunities.

## 3. Reference construction

The primary Phase-A reference contains at least two independent venues with genuine BTC/USDC Spot markets:
- Kraken Spot `BTC/USDC`;
- Binance Spot `BTCUSDC` as public reference data only.

Bitvavo itself is the target and is never counted as one of its own reference components.

Coinbase is not counted as an independent direct-USDC component in the primary cohort because current public Advanced Trade documentation aliases most `-USDC` subscriptions to the corresponding `-USD` market data. Coinbase may be retained as a USD diagnostic/control source only.

A synthetic USD/USDT→USDC reference is permitted only as a separately preregistered fallback cohort. It must never be silently substituted into, or pooled with, the primary direct-USDC cohort.

A reference observation is invalid if a required component is stale, malformed, unavailable, or if the independent direct-USDC reference mids disagree beyond the declared data-quality bound.

Reference source choice is frozen for Phase A. If a source becomes unavailable, the current cohort stops; any replacement starts a new evidence cohort rather than being silently mixed into the original sample.

## 4. Clock semantics

Three timing concepts must remain distinct:

1. **Exchange/event timestamp** — retained only as provenance where the source documents exactly what the timestamp represents. It is not used to compare venue clocks.
2. **Local wall-clock receive timestamp** — retained for human-readable audit/log correlation only. It is not authoritative for causal ordering, freshness or cross-feed skew because wall time may jump under NTP/system adjustments.
3. **Same-process local monotonic receive timestamp** — the sole Phase-A authority for ordering, freshness/age, active-window boundaries and cross-feed receive skew.

All compared feeds in one episode must be stamped in the same process/monotonic clock domain. A collector restart closes/invalidates any open episode; monotonic timestamps from separate process lifetimes are not directly comparable.

Bitvavo `book.timestamp` must not be interpreted as the timestamp of every book change. Bitvavo documents it on the book subscription as the timestamp of the last transaction event. It may be retained as provenance but cannot establish timing for placements, cancellations or BBO changes.

Bitvavo `trade.timestampNs` is a transaction timestamp. It is useful provenance, but a locally detected signal activation must not be compared directly to that exchange timestamp unless an explicit, validated clock mapping exists.

Nanosecond source timestamps must be retained as decimal strings or bigint until safely reduced; parsing them first as JavaScript numbers is invalid evidence.

## 5. Target book integrity

Bitvavo order-book state is valid only when the documented snapshot/buffer procedure has succeeded and subsequent `nonce` values remain exactly contiguous.

On any sequence gap, duplicate, disconnect with uncertain continuity, crossed book, malformed level, or synchronization uncertainty:
- invalidate the current local book;
- invalidate observations dependent on that interval;
- resynchronize before collecting further comparable observations.

No gap interpolation is allowed.

A Bitvavo `ticker` BBO-change event may trigger a candidate observation, but the observation is not actionable until the synchronized local book agrees with the same BBO. The activation time is the later **local monotonic receive time** of the agreeing ticker/book state. We delay evidence rather than backdate it.

## 6. Observation fields

Each immutable observation envelope must contain at minimum:
- target venue/pair;
- target sequence/nonce;
- target local wall-clock receive timestamp for audit;
- target local monotonic receive timestamp for timing;
- precision-safe exchange/source timestamps where semantically valid;
- synchronized target bids/asks sufficient for the fixed research ticket;
- target ticker best bid/ask and local monotonic receipt;
- target best bid/ask, mid, spread and fixed-ticket VWAP/slippage;
- target local depth imbalance as a conditioning variable only;
- Kraken BTC/USDC reference BBO + monotonic receipt;
- Binance BTCUSDC reference BBO + monotonic receipt;
- direct-USDC reference midpoint estimator and dispersion;
- target/reference deviation in bps;
- market-status evidence when available;
- Bitvavo public trades around the episode with taker side, precision-safe exchange timestamp and local monotonic receipt when captured live;
- source/schema/policy version identifiers.

## 7. Screening bins

Phase A records both signs of deviation but does not treat bins as entry rules.

Absolute deviation is classified into fixed descriptive bins:
- < 10 bps;
- 10 to < 20 bps;
- 20 to < 40 bps;
- 40 to < 80 bps;
- >= 80 bps.

The 10 bps boundary is economically interpretable because it is the current Bitvavo crypto/USDC fee-only round-trip floor at the base fee tier; it is not a claim that 10 bps is sufficient MVE.

No new bins may be introduced after outcomes are inspected in Phase A. If later research requires different bins, it starts a new cohort.

## 8. Fixed forward horizons

For every valid episode, measure target/reference evolution at the already-declared horizons:
- 1 second;
- 2 seconds;
- 5 seconds;
- 15 seconds;
- 30 seconds;
- 60 seconds.

Horizon boundaries are measured from the Phase-A local monotonic activation time. Missing a horizon because data integrity is broken yields missing evidence, not carry-forward/interpolation.

Phase A may describe all fixed horizons. It must not announce the best-looking horizon as the validated strategy horizon.

## 9. Episode independence

Phase A requires **30 independent episodes**, not 30 ticks from one shock.

A new episode may start only after the prior episode is closed. An episode closes at the earlier of:
- the final 60-second measurement horizon; or
- loss of data integrity, in which case the episode is invalid rather than completed.

During an open episode, further threshold crossings are part of the same episode and may be stored as path data, but they do not increase the independent-episode count.

This deliberately conservative definition prevents a volatile burst from masquerading as many independent observations.

## 10. Conservative maker-fill evidence

Maker execution remains PAPER-only.

The existing queue model correctly implements useful conservative ideas:
- hypothetical post-only order joins behind all displayed quantity already resting at the same price;
- touching the hypothetical price is not a fill;
- only correctly sided public taker trades consume queue ahead;
- cancellations do not grant unobservable queue improvement;
- trade-through is stronger evidence than merely touching the price.

However, its current active-window filtering uses Bitvavo exchange trade timestamps while signal activation is observed locally. Therefore **the existing helper is not yet Phase-A-valid fill-probability evidence**.

Before Phase A may report maker fill/non-fill statistics, the model must be refactored so that:
- signal activation and quote expiry use same-process local monotonic receive time;
- each captured trade has a local monotonic receive time in that same process/clock domain;
- exchange trade timestamps remain provenance, not the active-window comparison clock;
- stream integrity remains fail-closed;
- any explicit simulated decision/network latency is preregistered and conservative.

Until then, Phase A may collect reversion/depth evidence without claiming maker fill probability.

## 11. Phase A primary evidence

For each independent underpriced episode, report:
- initial deviation bin;
- forward reduction/increase in the target/reference deviation at each fixed horizon;
- spread/depth/slippage at the observation time;
- reference dispersion and monotonic feed-receive skew;
- no-trade / target hold movement over the same horizon;
- maker-fill evidence only if and after the monotonic fill-timing gate has been implemented and validated.

Overpriced episodes are retained as a symmetry/control cohort but do not authorize inventory or short exposure.

## 12. Phase A kill / pause criteria

The thesis should be rejected or paused rather than promoted if any of the following is observed:

1. **No economic room:** even an optimistic gross-reversion bound at the fixed horizons does not clear known fee floors plus a non-zero execution/safety allowance.
2. **Fill illusion:** if fill modeling is activated later, apparent convergence exists but conservative fill evidence is absent or depends on permissive timing/queue assumptions.
3. **Adverse selection:** hypothetical fills, once validly modeled, are systematically followed by continuation against the passive quote rather than reversion.
4. **Reference instability:** direct-USDC reference dispersion is large enough that the local dislocation cannot be distinguished reliably from reference noise.
5. **Timing illusion:** the effect disappears when alignment uses same-process monotonic receive clocks rather than exchange-clock or wall-clock shortcuts.
6. **Single-shock dependence:** most apparent evidence comes from one or a few highly autocorrelated episodes.
7. **Operational burden:** the number/quality of valid independent episodes is too low to justify further P300 attention.
8. **Mechanism failure:** observed behavior is better explained by broad market movement/beta than by temporary local dislocation and reversion.

A NO-GO at Phase A is a successful experiment if it prevents adapter/LIVE work with no plausible economic edge.

## 13. Phase B promotion gate

Only if Phase A shows credible economic room may Phase B start.

Before Phase B begins, freeze:
- source set;
- signal/dislocation definition;
- selected execution-policy assumptions;
- active quote window if fill modeling is used;
- primary metric;
- cost model;
- benchmark;
- kill criteria;
- sample plan.

Then collect at least 100 **new** independent episodes OOS. Phase A observations may not be reused as Phase B validation evidence.

## 14. Explicit non-goals

Phase A does not:
- place, amend or cancel orders;
- use private account data;
- require API keys for the primary public-data path;
- maintain BTC inventory to enable the short side;
- build an execution adapter;
- weaken P300 risk limits;
- increase authorized capital;
- optimize thresholds/windows from realized PnL;
- declare LIVE readiness.

## 15. Regulatory / operational separation

Public read-only research does not satisfy Bitvavo's requirements for algorithmic deployment. Any future LIVE path remains separately gated by current Bitvavo Trading Rules, required algorithm notice/identification/testing, current account/API requirements, P300 governance and explicit human approval.
