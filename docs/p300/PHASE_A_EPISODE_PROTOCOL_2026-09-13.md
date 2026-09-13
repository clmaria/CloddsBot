# P300 Phase A — Frozen Episode Protocol

Date: 2026-09-13
Status: **PREREGISTERED SCREENING RULE / RESEARCH ONLY / NO EXECUTION**

This file freezes the episode-counting rule before representative Phase-A outcomes are collected. It exists to prevent outcome-driven threshold hunting and to make `30 independent episodes` operationally testable.

## Economic anchor, not a claimed edge

BTC-USDC currently has an approximately 10 bps fee-only round-trip floor at the frozen Bitvavo base-tier assumption (5 bps per side). Therefore Phase A uses **10 bps absolute target/reference deviation as the minimum dislocation observation trigger**.

This does **not** mean 10 bps is profitable or is the future entry threshold. A 10 bps gross move cannot clear the same 10 bps fee floor before spread, non-fill, slippage, adverse selection, infrastructure/admin burden and safety margin. The threshold only avoids spending the 30-episode sample on observations that are already below the fee-only floor.

Do not optimize this threshold from Phase-A outcomes. Changing it later creates a new cohort/protocol version and cannot retroactively relabel collected episodes.

## Frozen deviation bins

Absolute deviation bins are descriptive, not strategy-entry rules:
- `<10 bps` — below trigger / rearm region;
- `10–<20 bps`;
- `20–<30 bps`;
- `30–<50 bps`;
- `50–<100 bps`;
- `>=100 bps`.

The breakpoints are tied to the already-declared fee floor and payoff-sensitivity levels, not selected from observed outcomes. Both signs are retained. Under the current Spot-only/no-short envelope, only the underpriced side is executable in principle; the overpriced side remains a control/research observation.

## Independence and rearm

The detector starts **unarmed**. It must first observe a quality-valid causal snapshot with `abs(deviation) < 10 bps`.

Once armed, the next quality-valid observation with `abs(deviation) >= 10 bps` starts one episode. The episode has a fixed 60-second measurement window.

After the episode closes or is invalidated, the detector returns to **awaiting rearm**. It may not count another episode until a new quality-valid observation is again below 10 bps. Only a later crossing back to `>=10 bps` can start a new episode.

Consequences:
- a persistent five-minute dislocation is still one episode, not five;
- a collector restart cannot manufacture a new episode from an already-live shock;
- a sign flip observed while the process never rearmed below threshold remains part of the same shock;
- invalid data cannot silently end an episode and immediately start another.

This is intentionally conservative. Missing ambiguous opportunities is preferable to overstating independence.

## Fixed horizons

Every started episode schedules the already-preregistered horizons from its causal actionable target time:
- 1s;
- 2s;
- 5s;
- 15s;
- 30s;
- 60s.

Horizon boundaries use same-process `receivedMonoNs` only. Wall clock and exchange timestamps remain audit/provenance fields and cannot move a horizon backward or forward.

A later horizon recorder must store missing/invalid horizons as such and must never forward-fill them.

## Quality failure

Loss of target-book continuity, source freshness, reference comparability, clock-domain integrity, market status or other mandatory Phase-A quality gates invalidates an open episode. Invalid episodes are retained as invalid evidence but do not count toward the 30 valid episodes.

After invalidation, a fresh below-trigger observation is required before the detector can arm again.

## Promotion boundary

This protocol defines **sample identity**, not a trade signal. It authorizes no order, no PAPER promotion, no LIVE connection, no capital increase and no risk-envelope change.

If Phase A appears positive, Phase B still requires at least 100 new independent OOS episodes under a newly frozen validation protocol. Phase-A data cannot be reused as Phase-B OOS evidence.
