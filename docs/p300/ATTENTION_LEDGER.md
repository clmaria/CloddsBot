# P300 Attention Ledger

Hard budget: 20 human-attention hours or 21 active days, whichever comes first.

This ledger exists to prevent infrastructure work from quietly becoming an unlimited project.

## Accounting rules

- Human review, setup, architecture, debugging and decision time count.
- Autonomous CI/runtime time does not count unless it requires human intervention.
- Historical work before this ledger is not treated as zero; it remains explicitly marked for conservative reconciliation.
- If exact timing is unavailable, record conservative blocks rather than estimating downward.
- Reaching the budget forces a GO / PAUSE / KILL decision. PAUSE means archived: no background scanner, live keys or recurring maintenance.

## Ledger

| Date | Work | Human-attention charge | Status |
|---|---|---:|---|
| pre-2026-09-12 | Earlier P300 / Trading Lab research, architecture and implementation | pending conservative reconciliation | ESTIMATED |
| 2026-09-12 | CloddsBot fork integration: P300 governance, NOFX comparison, CI debugging, market-constraint validation | 0.5 h | ESTIMATED |
| 2026-09-12 | Economics Gate: venue constraints, stressed reducibility, same-horizon benchmark and matrix tests | 0.5 h | ESTIMATED |

## Remaining budget

Cannot be stated honestly until the historical block is reconciled. It must not be reported as 19.0 h remaining.
