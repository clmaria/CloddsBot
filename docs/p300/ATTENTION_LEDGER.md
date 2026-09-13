# P300 Attention Ledger

Hard budget: 20 human-attention hours or 21 active days, whichever comes first.

This ledger exists to prevent infrastructure work from quietly becoming an unlimited project.

## Accounting rules

- Human review, setup, architecture, debugging and decision time count.
- Autonomous CI/runtime time does not count unless it requires human intervention.
- Historical work before this ledger is not treated as zero; it remains explicitly marked for conservative reconciliation.
- If exact timing is unavailable, record conservative blocks rather than estimating downward.
- Reaching the budget forces a GO / PAUSE / KILL decision. PAUSE means archived: no background scanner, live keys or recurring maintenance.
- Estimated blocks are conservative accounting units, not claims about exact wall-clock elapsed time.

## Ledger

| Date | Work | Human-attention charge | Status |
|---|---|---:|---|
| pre-2026-09-12 | Earlier P300 / Trading Lab research, architecture and implementation | pending conservative reconciliation | ESTIMATED |
| 2026-09-12 | CloddsBot fork integration: P300 governance, NOFX comparison, CI debugging, market-constraint validation | 0.5 h | ESTIMATED |
| 2026-09-12 | Economics Gate: venue constraints, stressed reducibility, same-horizon benchmark and matrix tests | 0.5 h | ESTIMATED |
| 2026-09-12 | Venue/economics evidence: MiCA gate, fee baselines, effective-hurdle refactor and MVE sensitivity | 0.5 h | ESTIMATED |
| 2026-09-12 | Microstructure methodology: order-book economics, multi-venue normalization, evidence consistency, adapter-readiness and lexicographic venue gate | 0.5 h | ESTIMATED |
| 2026-09-12 | Adversarial hardening: NaN/Infinity fail-closed controls, sell-side fixed-base correction, fillable-only slippage statistics, venue-gate revalidation | 0.5 h | ESTIMATED |
| 2026-09-13 | Clodds capability audit; Binance Spot/Futures correction; Edge Thesis shortlist; Bitvavo BTC-USDC economics and long-only constraint | 0.5 h | ESTIMATED |
| 2026-09-13 | Precision-safe Bitvavo sync, conservative maker-fill model, bounded active window and public-evidence collector design | 0.5 h | ESTIMATED |
| 2026-09-13 | Phase A clock audit, keyless collector specification, Evidence Envelope v1 and absolute-payoff hurdle analysis | 0.5 h | ESTIMATED |
| 2026-09-13 | Direct-USDC reference audit; monotonic-clock correction; authorization-hash, supervisor, projected-state fast-gate and Spot-envelope hardening; protocol/venue/evidence reconciliation | 1.0 h | ESTIMATED |

## Remaining budget

Cannot be stated honestly until the historical block is reconciled. It must not be reported as a numeric remaining-hour balance yet.

The explicit post-ledger charges above total **5.0 h estimated**, but this is not the same thing as saying 15.0 h remain because the pre-ledger historical block is unresolved.
