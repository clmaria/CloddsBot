import type { TradingAuthorityState } from './types';

export interface FastGateProfile {
  strategyId: string;
  authorized: boolean;
  authorizedCapital: number;
  maxGrossExposure: number;
  maxConcurrentSlots: number;
  tradingState: TradingAuthorityState;
}

export interface FastGateContext {
  strategyId: string;
  requestedNotional: number;
  currentGrossExposure: number;
  projectedGrossExposure: number;
  currentOpenSlots: number;
  projectedOpenSlots: number;
}

export interface FastGateDecision {
  allowed: boolean;
  reason?: string;
}

function validNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Hot-path gate: deterministic, synchronous, no network and no LLM calls.
 * It consumes a precomputed authorization profile created by slow preflight.
 *
 * The caller must provide projected post-fill exposure/slots. The gate derives
 * whether risk increases from state deltas rather than trusting a declarative
 * `isOpeningExposure` boolean. This prevents a mislabeled order from bypassing
 * REDUCING or profile limits.
 */
export function evaluateFastGate(
  profile: FastGateProfile,
  ctx: FastGateContext
): FastGateDecision {
  if (!profile.strategyId.trim() || !ctx.strategyId.trim()) {
    return { allowed: false, reason: 'strategy id is missing' };
  }
  if (!profile.authorized) return { allowed: false, reason: 'strategy not authorized by P300 preflight' };
  if (profile.strategyId !== ctx.strategyId) return { allowed: false, reason: 'strategy authorization mismatch' };

  if (!validNonNegative(profile.authorizedCapital)) {
    return { allowed: false, reason: 'invalid P300 authorized capital' };
  }
  if (!validNonNegative(profile.maxGrossExposure)) {
    return { allowed: false, reason: 'invalid P300 gross exposure limit' };
  }
  if (!Number.isInteger(profile.maxConcurrentSlots) || profile.maxConcurrentSlots < 0) {
    return { allowed: false, reason: 'invalid P300 concurrent slot limit' };
  }
  if (profile.maxGrossExposure > profile.authorizedCapital + 1e-12) {
    return { allowed: false, reason: 'P300 profile gross exposure exceeds authorized capital' };
  }

  if (!Number.isFinite(ctx.requestedNotional) || ctx.requestedNotional <= 0) {
    return { allowed: false, reason: 'requested notional must be finite and > 0' };
  }
  if (!validNonNegative(ctx.currentGrossExposure) || !validNonNegative(ctx.projectedGrossExposure)) {
    return { allowed: false, reason: 'current/projected gross exposure is invalid' };
  }
  if (!Number.isInteger(ctx.currentOpenSlots) || ctx.currentOpenSlots < 0 ||
      !Number.isInteger(ctx.projectedOpenSlots) || ctx.projectedOpenSlots < 0) {
    return { allowed: false, reason: 'current/projected open slots are invalid' };
  }

  if (profile.tradingState === 'HALTED') return { allowed: false, reason: 'P300 authority halted' };

  const exposureIncreases = ctx.projectedGrossExposure > ctx.currentGrossExposure + 1e-12;
  const slotsIncrease = ctx.projectedOpenSlots > ctx.currentOpenSlots;
  const exposureDecreases = ctx.projectedGrossExposure < ctx.currentGrossExposure - 1e-12;
  const slotsDecrease = ctx.projectedOpenSlots < ctx.currentOpenSlots;
  const riskIncreasing = exposureIncreases || slotsIncrease;
  const strictlyReducing = !exposureIncreases && !slotsIncrease && (exposureDecreases || slotsDecrease);

  if (profile.tradingState === 'REDUCING' && !strictlyReducing) {
    return { allowed: false, reason: 'REDUCING requires projected exposure/slots to strictly decrease without increasing another dimension' };
  }

  // Limits govern any risk-increasing transition. Risk-reducing transitions may
  // be allowed even if the current state is already above a newly tightened
  // limit, otherwise the gate could trap exposure outside the envelope.
  if (riskIncreasing) {
    if (ctx.projectedOpenSlots > profile.maxConcurrentSlots) {
      return { allowed: false, reason: 'P300 concurrent slot limit exceeded' };
    }
    if (ctx.projectedGrossExposure > profile.maxGrossExposure + 1e-12) {
      return { allowed: false, reason: 'P300 gross exposure limit exceeded' };
    }
    if (ctx.projectedGrossExposure > profile.authorizedCapital + 1e-12) {
      return { allowed: false, reason: 'P300 authorized capital exceeded' };
    }
  }

  return { allowed: true };
}
