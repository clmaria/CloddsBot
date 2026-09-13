# P300 ↔ Clodds Integration Contract

This document defines the boundary between P300 governance and Clodds' native trading/risk stack.

## Principle

P300 is a pre-authorisation and capital-governance layer. It does not replace Clodds' RiskEngine, execution adapters, VaR/CVaR, Kelly sizing, volatility regime, circuit breakers, signal routing, or market data.

## Slow path — before a strategy is allowed to trade

A strategy must have a preflight profile that records:

- maker and independent checker identity;
- edge thesis and falsification/decay assumptions;
- venue/symbol market constraints;
- current and stressed reducibility;
- horizon-aware economics and same-horizon benchmark;
- coherent risk envelope;
- observed vs authorised capital;
- system attention gate state;
- exact preflight generation time / validity context;
- an immutable authorisation fingerprint before runtime promotion.

Any missing or stale material input means NOT AUTHORISED.

The current branch contains a deterministic SHA-256 fingerprint utility, but the fingerprint is **not yet wired into native Clodds runtime/execution**. Until that integration exists and is tested, its presence is not evidence that a runtime order has been bound to a specific approved profile.

The fingerprint is intended to bind the exact authorised snapshot, including its generated-at context. If a separate semantic-policy identity is later needed across fresh preflights, create a separate `policyHash`; do not weaken the exact authorisation fingerprint by silently excluding freshness/version fields.

## Fast path — per order

The per-order P300 gate must be deterministic and local. It may only permit or veto; it must not increase size or relax Clodds controls.

It checks only precomputed authority plus current **and projected post-fill** risk state:

- strategy identity matches authorised profile;
- authority state is not HALTED;
- current/projected gross exposure and slots are finite/valid;
- in REDUCING, projected gross exposure and slots may not increase in any dimension and at least one risk dimension must strictly decrease;
- any risk-increasing transition remains inside authorised-capital, gross-exposure and slot ceilings;
- supervisor safe-mode/throttle state;
- once integrated, the exact authorisation fingerprint still matches the approved profile.

The caller may not bypass this contract by labeling an order “reducing” or “not opening.” Risk direction is derived from the projected state rather than trusted from a declarative boolean.

If required P300 runtime context is unavailable, new exposure fails closed.

After P300 permits an order, Clodds' native RiskEngine remains authoritative for its own checks. P300 approval never bypasses a Clodds rejection.

## Degradation asymmetry

Automatic actions may reduce authorised capital, exposure, slots or move ACTIVE → REDUCING → HALTED.

Automatic actions may never increase authorised capital, exposure, slots or move to a more permissive state because of profits or a winning streak. Any upward change requires explicit human authorisation and a fresh preflight fingerprint.

## Execution boundary

No P300 module is allowed to submit an exchange order directly. Orders continue to flow only through Clodds' execution layer after a venue/adapter has actually earned promotion.

The current audit found no Spot execution adapter that is both suitable and promoted for P300. Binance upstream support includes market data/Futures rather than a verified P300 Spot path; Bitvavo/Kraken/OKX Spot execution adapters were not found; Hyperliquid Spot exists upstream but has not passed the P300 venue gate.

## Venue constraints

Venue filters are data, not constants. They must be refreshed from the venue before authorisation and revalidated when material constraints change. Lot/step rounding is part of the gate; calculations may not assume continuous divisibility.

Market-order-specific filters must be treated separately from limit/maker-order constraints when a venue exposes different rules.

## Profit reserve

Protected principal is not automatically distributable. Profit reserve sweeps require both a minimum amount and an acceptable transfer-cost ratio. Profit does not automatically expand trading authority.

## Attention/system gate

The Trading experiment has a hard attention/time gate: 20 human-attention hours or 21 active days, whichever occurs first. Reaching it forces GO / PAUSE / KILL. PAUSE means archived, not a continuing background scanner.
