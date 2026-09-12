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

function validatePolicy(policy: ProfitReservePolicy): void {
  const values: Array<[string, number]> = [
    ['protected principal', policy.protectedPrincipal],
    ['minimum sweep amount', policy.minSweepAmount],
    ['maximum sweep cost percentage', policy.maxSweepCostPct],
  ];
  for (const [name, value] of values) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and >= 0`);
  }
}

export function calculateProfitReserve(
  equity: number,
  policy: ProfitReservePolicy
): ProfitReserveState {
  validatePolicy(policy);
  if (!Number.isFinite(equity) || equity < 0) throw new Error('equity must be finite and >= 0');
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
  validatePolicy(policy);
  if (!Number.isFinite(state.equity) || state.equity < 0) throw new Error('equity must be finite and >= 0');
  if (!Number.isFinite(state.reserve) || state.reserve < 0) throw new Error('reserve must be finite and >= 0');
  if (!Number.isFinite(estimatedSweepCost) || estimatedSweepCost < 0) {
    throw new Error('estimated sweep cost must be finite and >= 0');
  }

  const expectedReserve = Math.max(0, state.equity - policy.protectedPrincipal);
  if (Math.abs(state.reserve - expectedReserve) > 1e-9) {
    throw new Error('profit reserve state is inconsistent with protected principal');
  }

  if (state.reserve < policy.minSweepAmount) {
    return { allowed: false, amount: 0, reason: 'profit reserve below minimum sweep amount' };
  }

  const costPct = state.reserve > 0 ? (estimatedSweepCost / state.reserve) * 100 : Infinity;
  if (!Number.isFinite(costPct) || costPct > policy.maxSweepCostPct) {
    return { allowed: false, amount: 0, reason: 'sweep cost percentage too high' };
  }

  return { allowed: true, amount: state.reserve };
}
