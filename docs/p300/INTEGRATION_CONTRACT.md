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
- immutable authorisation fingerprint.

Any missing or stale material input means NOT AUTHORISED.

## Fast path — per order

The per-order P300 gate must be deterministic and local. It may only permit or veto; it must not increase size or relax Clodds controls.

It checks only precomputed authority and current exposure state:

- strategy identity matches authorised profile;
- authority state is not HALTED;
- REDUCING cannot open new exposure;
- authorised-capital ceiling;
- gross-exposure ceiling;
- slot ceiling;
- supervisor safe-mode/throttle state;
- authorisation fingerprint still matches the approved profile.

If required P300 runtime context is unavailable, new exposure fails closed.

After P300 permits an order, Clodds' native RiskEngine remains authoritative for its own checks. P300 approval never bypasses a Clodds rejection.

## Degradation asymmetry

Automatic actions may reduce authorised capital, exposure, slots or move ACTIVE → REDUCING → HALTED.

Automatic actions may never increase authorised capital, exposure, slots or move to a more permissive state because of profits or a winning streak. Any upward change requires explicit human authorisation and a fresh preflight fingerprint.

## Execution boundary

No P300 module is allowed to submit an exchange order directly. Orders continue to flow only through Clodds' existing execution layer.

## Venue constraints

Venue filters are data, not constants. They must be refreshed from the venue before authorisation and revalidated when material constraints change. Lot/step rounding is part of the gate; calculations may not assume continuous divisibility.

Market-order-specific filters must be treated separately from limit/maker-order constraints when a venue exposes different rules.

## Profit reserve

Protected principal is not automatically distributable. Profit reserve sweeps require both a minimum amount and an acceptable transfer-cost ratio. Profit does not automatically expand trading authority.

## Attention/system gate

The Trading experiment has a hard attention/time gate: 20 human-attention hours or 21 active days, whichever occurs first. Reaching it forces GO / PAUSE / KILL. PAUSE means archived, not a continuing background scanner.
