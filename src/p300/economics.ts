import type { EconomicsInput, EconomicsResult, EdgeThesis } from './types';

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function requireFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and >= 0`);
}

export function evaluateEconomics(input: EconomicsInput): EconomicsResult {
  requireFinite(input.grossEdgeBps, 'gross edge');
  requireFinite(input.benchmarkReturnBpsSameHorizon, 'same-horizon benchmark return');
  requireFiniteNonNegative(input.entryFeeBps, 'entry fee');
  requireFiniteNonNegative(input.exitFeeBps, 'exit fee');
  requireFiniteNonNegative(input.spreadBps, 'spread');
  requireFiniteNonNegative(input.slippageBps, 'slippage');
  requireFiniteNonNegative(input.adverseSelectionBps ?? 0, 'adverse selection');
  requireFiniteNonNegative(input.infraCostBps ?? 0, 'infrastructure cost');
  requireFiniteNonNegative(input.adminCostBps ?? 0, 'admin cost');
  requireFiniteNonNegative(input.safetyMarginBps ?? 0, 'safety margin');

  if (!Number.isFinite(input.holdingPeriodMinutes) || input.holdingPeriodMinutes <= 0) {
    throw new Error('holdingPeriodMinutes must be finite and > 0');
  }
  if (!Number.isFinite(input.expectedTradesPerDay) || input.expectedTradesPerDay < 0) {
    throw new Error('expectedTradesPerDay must be finite and >= 0');
  }

  const allInCostBps =
    input.entryFeeBps +
    input.exitFeeBps +
    input.spreadBps +
    input.slippageBps +
    (input.adverseSelectionBps ?? 0) +
    (input.infraCostBps ?? 0) +
    (input.adminCostBps ?? 0);

  const safetyMarginBps = input.safetyMarginBps ?? 0;
  const costFloorBps = allInCostBps + safetyMarginBps;

  // A strategy must clear both execution economics and the return of doing
  // nothing / holding the benchmark over the exact same horizon. The economic
  // hurdle is therefore the stricter of the two requirements.
  const benchmarkHurdleBps = allInCostBps + input.benchmarkReturnBpsSameHorizon;
  const effectiveHurdleBps = Math.max(costFloorBps, benchmarkHurdleBps);

  const netStrategyReturnBps = input.grossEdgeBps - allInCostBps;
  const strategyAlphaBps = netStrategyReturnBps - input.benchmarkReturnBpsSameHorizon;
  const beatsBenchmark = strategyAlphaBps > 0;
  const economicallyViable = input.grossEdgeBps >= effectiveHurdleBps && beatsBenchmark;

  if (
    !Number.isFinite(allInCostBps) ||
    !Number.isFinite(costFloorBps) ||
    !Number.isFinite(effectiveHurdleBps) ||
    !Number.isFinite(netStrategyReturnBps) ||
    !Number.isFinite(strategyAlphaBps)
  ) {
    throw new Error('derived economics are not finite');
  }

  return {
    allInCostBps,
    costFloorBps,
    effectiveHurdleBps,
    // Backward-compatible alias. New consumers should prefer effectiveHurdleBps.
    minimumViableEdgeBps: effectiveHurdleBps,
    netStrategyReturnBps,
    strategyAlphaBps,
    beatsBenchmark,
    economicallyViable,
    holdingPeriodMinutes: input.holdingPeriodMinutes,
    expectedTradesPerDay: input.expectedTradesPerDay,
  };
}

export function validateEdgeThesis(thesis: EdgeThesis): string[] {
  const reasons: string[] = [];
  if (!thesis.id.trim()) reasons.push('missing thesis id');
  if (!thesis.anomaly.trim()) reasons.push('missing anomaly');
  if (!thesis.counterparty.trim()) reasons.push('missing counterparty');
  if (!thesis.whyCounterpartyLoses.trim()) reasons.push('missing counterparty loss mechanism');
  if (!thesis.persistenceMechanism.trim()) reasons.push('missing persistence mechanism');
  if (!Number.isFinite(thesis.expectedDecayMinutes) || thesis.expectedDecayMinutes <= 0) {
    reasons.push('expected decay must be finite and > 0');
  }
  if (!thesis.falsificationCondition.trim()) reasons.push('missing falsification condition');
  if (!Number.isFinite(thesis.expectedHoldingPeriodMinutes) || thesis.expectedHoldingPeriodMinutes <= 0) {
    reasons.push('expected holding period must be finite and > 0');
  }
  if (
    Number.isFinite(thesis.expectedDecayMinutes) &&
    Number.isFinite(thesis.expectedHoldingPeriodMinutes) &&
    thesis.expectedDecayMinutes < thesis.expectedHoldingPeriodMinutes
  ) reasons.push('edge is expected to decay before the intended holding period ends');
  return reasons;
}
