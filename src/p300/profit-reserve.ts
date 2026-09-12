export interface ProfitReservePolicy {
  protectedPrincipal: number;
  minSweepAmount: number;
  maxSweepCostPct: number;
}

export interface ProfitReserveState {
  equity: number;
  reserve: number;
}

export interface SweepDecision {
  allowed: boolean;
  amount: number;
  reason?: string;
}

export function calculateProfitReserve(
  equity: number,
  policy: ProfitReservePolicy
): ProfitReserveState {
  if (equity < 0) throw new Error('equity must be >= 0');
  if (policy.protectedPrincipal < 0) throw new Error('protected principal must be >= 0');
  return {
    equity,
    reserve: Math.max(0, equity - policy.protectedPrincipal),
  };
}

export function evaluateSweep(
  state: ProfitReserveState,
  policy: ProfitReservePolicy,
  estimatedSweepCost: number
): SweepDecision {
  if (estimatedSweepCost < 0) throw new Error('estimated sweep cost must be >= 0');
  if (state.reserve < policy.minSweepAmount) {
    return { allowed: false, amount: 0, reason: 'profit reserve below minimum sweep amount' };
  }

  const costPct = state.reserve > 0 ? (estimatedSweepCost / state.reserve) * 100 : Infinity;
  if (costPct > policy.maxSweepCostPct) {
    return { allowed: false, amount: 0, reason: 'sweep cost percentage too high' };
  }

  return { allowed: true, amount: state.reserve };
}
