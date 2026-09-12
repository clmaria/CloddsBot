import { deriveMarketConstraints, calculateReducibility, calculateStressedReducibility } from './market-constraints';
import { evaluateEconomics } from './economics';
import type { EconomicsInput, MarketConstraintsInput } from './types';

export interface EconomicsMatrixCandidate {
  venue: string;
  symbol: string;
  market: MarketConstraintsInput;
  positionBaseQty: number;
  adverseExitPrice: number;
  economics: EconomicsInput;
  requiredExitSlices?: number;
}

export interface EconomicsMatrixRow {
  venue: string;
  symbol: string;
  tradable: boolean;
  reasons: string[];
  minExecutableNotional: number;
  bindingConstraint: string;
  exitSlicesNow: number;
  exitSlicesStress: number;
  minimumViableEdgeBps: number;
  strategyAlphaBps: number;
  economicallyViable: boolean;
  holdingPeriodMinutes: number;
  expectedTradesPerDay: number;
}

/**
 * Pure research/preflight evaluator. It does not fetch market data and cannot
 * place orders. Inputs must come from an independently refreshed venue parser.
 */
export function evaluateEconomicsMatrixCandidate(
  candidate: EconomicsMatrixCandidate
): EconomicsMatrixRow {
  const reasons: string[] = [];
  const constraints = deriveMarketConstraints(candidate.market);
  const now = calculateReducibility(candidate.positionBaseQty, candidate.market);
  const stressed = calculateStressedReducibility(
    candidate.positionBaseQty,
    candidate.market,
    candidate.adverseExitPrice
  );
  const economics = evaluateEconomics(candidate.economics);
  const requiredExitSlices = candidate.requiredExitSlices ?? 1;

  if (!(candidate.positionBaseQty > 0)) reasons.push('position quantity must be > 0');
  if (now.totalExitSlices < 1) reasons.push('position is not currently executable');
  if (now.totalExitSlices < requiredExitSlices) {
    reasons.push('insufficient current exit granularity');
  }
  if (stressed.totalExitSlices < requiredExitSlices) {
    reasons.push('insufficient stressed exit granularity');
  }
  if (!economics.economicallyViable) {
    reasons.push('strategy does not clear MVE and same-horizon benchmark');
  }

  return {
    venue: candidate.venue,
    symbol: candidate.symbol,
    tradable: reasons.length === 0,
    reasons,
    minExecutableNotional: constraints.minExecutableNotional,
    bindingConstraint: constraints.bindingConstraint,
    exitSlicesNow: now.totalExitSlices,
    exitSlicesStress: stressed.totalExitSlices,
    minimumViableEdgeBps: economics.minimumViableEdgeBps,
    strategyAlphaBps: economics.strategyAlphaBps,
    economicallyViable: economics.economicallyViable,
    holdingPeriodMinutes: economics.holdingPeriodMinutes,
    expectedTradesPerDay: economics.expectedTradesPerDay,
  };
}

export function rankEconomicsMatrix(rows: EconomicsMatrixRow[]): EconomicsMatrixRow[] {
  return [...rows].sort((a, b) => {
    if (a.tradable !== b.tradable) return a.tradable ? -1 : 1;
    if (a.economicallyViable !== b.economicallyViable) return a.economicallyViable ? -1 : 1;
    if (a.strategyAlphaBps !== b.strategyAlphaBps) return b.strategyAlphaBps - a.strategyAlphaBps;
    return a.minimumViableEdgeBps - b.minimumViableEdgeBps;
  });
}
