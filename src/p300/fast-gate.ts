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
  currentOpenSlots: number;
  isOpeningExposure: boolean;
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
 * Invalid runtime state fails closed instead of relying on JS comparison semantics.
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
  if (!validNonNegative(ctx.currentGrossExposure)) {
    return { allowed: false, reason: 'current gross exposure is invalid' };
  }
  if (!Number.isInteger(ctx.currentOpenSlots) || ctx.currentOpenSlots < 0) {
    return { allowed: false, reason: 'current open slots are invalid' };
  }

  if (profile.tradingState === 'HALTED') return { allowed: false, reason: 'P300 authority halted' };

  if (profile.tradingState === 'REDUCING' && ctx.isOpeningExposure) {
    return { allowed: false, reason: 'REDUCING permits only exposure-reducing orders' };
  }

  if (ctx.isOpeningExposure) {
    if (ctx.currentOpenSlots + 1 > profile.maxConcurrentSlots) {
      return { allowed: false, reason: 'P300 concurrent slot limit exceeded' };
    }
    if (ctx.currentGrossExposure + ctx.requestedNotional > profile.maxGrossExposure + 1e-12) {
      return { allowed: false, reason: 'P300 gross exposure limit exceeded' };
    }
    if (ctx.currentGrossExposure + ctx.requestedNotional > profile.authorizedCapital + 1e-12) {
      return { allowed: false, reason: 'P300 authorized capital exceeded' };
    }
  }

  return { allowed: true };
}
