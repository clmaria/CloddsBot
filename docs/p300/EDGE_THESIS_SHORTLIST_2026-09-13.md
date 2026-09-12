# P300 Edge Thesis Shortlist — 2026-09-13

Status: **RESEARCH / PAPER ONLY**. This document authorizes no LIVE trading, no capital increase, no exchange connection, no shorting and no weakening of the Risk Envelope.

## Decision this document supports

Choose the smallest next experiment that can falsify a plausible short-term Spot edge before P300 spends more user attention or builds an execution adapter.

The decision is not “which indicator looks best?” It is: **is there a structural source of realizable net edge, after fees and execution effects, that can plausibly survive at P300 scale?**

## Current venue economics

### Bitvavo EUR crypto pairs — fee tier €0+

- Maker: **0.15% / 15 bps per fill**
- Taker: **0.25% / 25 bps per fill**
- Fee-only round-trip floors:
  - maker/maker: **30 bps**
  - maker/taker: **40 bps**
  - taker/taker: **50 bps**

### Bitvavo USDC crypto pairs — fee tier €0+

- Maker: **0.05% / 5 bps per fill**
- Taker: **0.05% / 5 bps per fill**
- Fee-only round-trip floor: **10 bps** for maker/maker, maker/taker, or taker/taker.

These are **fee floors, not MVE**. Spread, slippage, adverse selection, fill probability, non-fill opportunity cost, infrastructure/operational costs and a safety margin remain to be measured.

Bitvavo currently lists `BTC-USDC`; its trading rules show a minimum order value of 5 (quote-equivalent) and a BTC base minimum. Runtime market metadata remains authoritative and must be fetched before any future order path.

Sources:
- https://bitvavo.com/es/fees
- https://bitvavo.com/es/trading-rules
- https://docs.bitvavo.com/docs/rest-api/get-markets/

### Kraken EUR comparator — current tier 1

- Maker: **0.40% / 40 bps per fill**
- Taker: **0.80% / 80 bps per fill**
- Fee-only round-trip floors:
  - maker/maker: **80 bps**
  - maker/taker: **120 bps**
  - taker/taker: **160 bps**

Kraken remains useful as a regulated comparator, but its default spot fee floor makes short-horizon micro-trading materially harder at P300 scale.

Source:
- https://support.kraken.com/es/articles/cross-platform-fee-tier-changes

## Thesis A — Cross-venue taker lead/lag

**Classification:**
- BTC/EUR: **REJECT as primary P300 strategy; keep only as measurement/control.**
- BTC/USDC: **WATCH / diagnostic experiment only.**

### Anomaly

A global reference venue moves first and Bitvavo reprices later, leaving a temporarily stale executable quote.

### Counterparty and mechanism

The other side would be liquidity providers whose local quote has not yet updated, or local inventory/order flow that temporarily leaves a stale quote available. The proposed sustaining mechanism is venue fragmentation plus network, matching and local inventory/repricing delays.

### Adversarial check

This is one of the most competed HFT anomalies in crypto. Professional market makers already observe multiple venues and can reprice in milliseconds. A public-feed retail bot may see the opportunity only after it has disappeared. Therefore “global venue moved first” is **not** itself evidence of edge.

EUR is especially unattractive because a taker/taker round trip starts at 50 bps before spread/slippage. USDC lowers the fee floor to 10 bps, but that only makes the thesis testable; it does not prove it.

### Falsifiers

Reject the thesis if any of these hold after preregistered validation:
1. conditional target repricing after a reference shock does not exceed measured execution costs;
2. apparent lag disappears when aligned using exchange and local-receive timestamps;
3. the edge exists only at horizons shorter than realistic data + decision + order latency;
4. OOS expectancy is non-positive after costs;
5. results depend on one fitted shock threshold/window;
6. opportunity frequency is too low to justify operational burden.

### Half-life

**Unknown; measure it.** Do not assume milliseconds, seconds, or minutes.

## Thesis B — Standalone order-book imbalance

**Classification: COMBINE, not a standalone Edge Thesis.**

Top-of-book/depth imbalance can be predictive, but it is public, common and heavily competed. A statistically predictive few-bps next move is not economically useful if fees and execution consume it.

Do **not** build an “imbalance strategy.” Use imbalance only as a conditioning / veto feature inside another thesis:
- reject entries that fight local order flow;
- identify adverse-selection regimes;
- segment results by imbalance bucket after the primary hypothesis is fixed.

It may improve another edge; it does not earn a separate strategy slot or separate multiple-testing budget today.

## Thesis C — Cross-venue-anchored passive reversion

**Classification: EXPERIMENT — current primary candidate.**

### Anomaly

Bitvavo temporarily **overshoots** a fresh cross-venue fair-value reference because of local aggressive flow or inventory pressure, then partially reverts.

This differs from taker lead/lag. The bot is not trying to win a raw latency race by crossing a stale ask/bid. It waits for a local dislocation and tests whether providing liquidity on the reversion side is compensated after costs.

### Counterparty and sustaining mechanism

The proposed counterparty is impatient or inventory-motivated local flow demanding immediacy during a transient shock. The proposed edge is compensation for supplying liquidity during that temporary imbalance, with an external venue composite acting as a fair-value anchor.

This mechanism is plausible but **unproven**. The experiment must attempt to falsify it.

### Why this candidate outranks the others

1. It does not require P300 to win a pure latency race against professional market makers.
2. It can use maker execution in a future implementation.
3. BTC/USDC on Bitvavo has a 10 bps fee-only round-trip floor versus 30 bps maker/maker on BTC/EUR.
4. Cross-venue fair value and local imbalance can be used as independent guards instead of multiplying unrelated strategies.
5. It fits low-touch bounded autonomy better than continuous two-sided market making: the system may stay idle until a preregistered dislocation appears.

### Spot asymmetry: Phase A is long-only for executable hypotheses

P300 does not permit leverage, futures, margin or shorting. A Spot reversion thesis is therefore **not symmetric** unless P300 deliberately carries a base-asset inventory.

- If Bitvavo BTC-USDC is **cheap** versus the reference, a future Spot implementation could buy BTC and later sell it after reversion.
- If Bitvavo BTC-USDC is **expensive** versus the reference, monetizing that side requires pre-existing BTC inventory to sell first and buy back later.

Maintaining BTC inventory would add continuous market exposure unrelated to the transient trade and would change the Risk Envelope. That is **not automatically authorized**.

Therefore Phase A records both directions for research, but only the **underpriced / buy-first** direction counts as executable under the current long-only envelope. If evidence exists only on the overpricing side, the result is not “add inventory”; it is **NO-GO under the current envelope or a new human-gated inventory decision**.

### Important trade-off: USDC

The lower USDC fee schedule is not free economics.

For a Spanish individual investor, exchanging one virtual currency for another is a taxable exchange (“permuta”) that can generate a capital gain/loss. A BTC↔USDC workflow therefore requires accurate EUR valuation and lot/accounting for the assets involved. This increases reporting/ledger burden even if the exchange fee is lower.

This tax/accounting burden must be automated if the thesis survives. It is an **operational cost and complexity term**, not a reason to invent a per-trade tax fee inside MVE.

Source:
- https://sede.agenciatributaria.gob.es/Sede/Ayuda/23Presentacion/100/7_6_6_2/ganancias_perdidas_monedas_virtuales.html

### Regime

Candidate observations must meet all of the following:
- target book and trades fresh;
- global reference fresh;
- target market status `trading`;
- dynamic min-order/tick metadata available;
- complete book synchronization / no sequence gap;
- fixed ticket executable with sufficient depth;
- stablecoin/reference basis observable;
- no automatic risk increase to gain order-size granularity.

### Falsifiers

Reject or PAUSE if:
1. reversion magnitude after realistic maker fills does not clear the **effective hurdle**;
2. maker fills are systematically adverse — fills occur mainly when the reference continues moving against the quote;
3. non-fill rate removes the apparent expectancy;
4. profitability vanishes OOS or under modestly worse fill assumptions;
5. the effect requires parameter hunting across many windows/bins;
6. the best effect occurs only at a half-life shorter than realistic cancel/replace latency;
7. net economic edge is too small relative to operational/tax-ledger burden;
8. the number of independent opportunities is too small to earn P300 attention;
9. the measurable edge exists only on the overpricing side that requires unauthorized base inventory.

### Half-life

Unknown. Measure forward reversion at **fixed, preregistered horizons** rather than optimizing the horizon after seeing outcomes. Initial research horizons: 1s, 2s, 5s, 15s, 30s, 60s. These are measurement buckets, not trading parameters.

## Minimal evidence experiment

### Phase A — screening, no performance claim

Collect **30 independent dislocation episodes** for BTC-USDC plus BTC-EUR as a control. Each episode stores one immutable evidence envelope containing:
- venue / pair;
- direction (`underpriced` or `overpriced`);
- whether the direction is executable under the current long-only envelope;
- exchange timestamp and local receive timestamp;
- raw target best bid/ask + depth snapshot;
- local trades around the event;
- reference price inputs and timestamps;
- target/reference deviation;
- local spread and imbalance;
- fixed-ticket executable VWAP/slippage;
- forward target/reference values at preregistered horizons;
- hypothetical maker price and conservative fill state;
- constraints/policy/source-version hashes.

Phase A answers only: **is there enough economic room to justify a larger test?** It cannot promote LIVE or establish statistical significance.

### Phase B — only if Phase A survives

Freeze the signal definition, deviation bins, horizons, fill models, primary metric, cost assumptions and kill criteria. Then collect at least **100 additional independent episodes** and evaluate OOS. Keep dual/adversarial fill assumptions. Do not select the winning window from the same sample used to report performance.

## Required market-data path

Bitvavo standard WebSocket exposes the necessary read-only primitives:
- `book` subscription with order-book updates, nonce and nanosecond timestamp;
- `trades` subscription with millisecond and nanosecond timestamps;
- public `GET /markets` for status, minimums, tick size and fee category.

Sources:
- https://docs.bitvavo.com/docs/websocket-api/book-subscription/
- https://docs.bitvavo.com/docs/websocket-api/trades-subscription/
- https://docs.bitvavo.com/docs/rest-api/get-markets/

The existing Clodds `CryptoFeed` can be reused conceptually as a global reference source, but its current implementation is Binance USDT / Coinbase USD oriented and is **not** target-venue BTC/EUR or BTC/USDC evidence. It must not be treated as a substitute for Bitvavo book/trade data.

## Risk decision

**No Risk Envelope changes.**

Cheaper USDC fees do not justify increasing exposure, daily loss, drawdown, slots, risk per position or persistent BTC inventory. First determine whether an edge exists within the already acceptable long-only envelope; if the venue/pair cannot implement it safely, the correct answer is NO-GO.

## Promotion state

- Thesis A BTC/EUR taker lag: **REJECT primary / CONTROL only**
- Thesis A BTC/USDC taker lag: **WATCH / diagnostic only**
- Thesis B standalone imbalance: **COMBINE as filter; no independent strategy**
- Thesis C BTC-USDC anchored passive reversion, underpriced side: **EXPERIMENT**
- Thesis C BTC-USDC anchored passive reversion, overpriced side: **RESEARCH ONLY unless inventory is separately human-authorized**
- Thesis C BTC/EUR anchored passive reversion: **CONTROL / comparator**

No thesis is GO, PAPER_READY or LIVE_READY yet.

## Next action

Build only a **read-only evidence collector/analyzer** for Thesis C. Do not build an execution adapter. The collector must be incapable of submitting orders and must fail closed on stale, malformed, out-of-sequence or incomparable data.