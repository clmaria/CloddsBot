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

/**
 * Hot-path gate: deterministic, synchronous, no network and no LLM calls.
 * It consumes a precomputed authorization profile created by slow preflight.
 */
export function evaluateFastGate(
  profile: FastGateProfile,
  ctx: FastGateContext
): FastGateDecision {
  if (!profile.authorized) return { allowed: false, reason: 'strategy not authorized by P300 preflight' };
  if (profile.strategyId !== ctx.strategyId) return { allowed: false, reason: 'strategy authorization mismatch' };
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
