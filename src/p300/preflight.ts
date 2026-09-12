import type { EconomicsInput, EdgeThesis, MarketConstraintsInput, RiskEnvelope } from './types';
import { deriveMarketConstraints, calculateStressedReducibility } from './market-constraints';
import { evaluateEconomics, validateEdgeThesis } from './economics';
import { assertMakerCheckerIndependence, validateRiskEnvelope } from './governance';

export interface AttentionBudget {
  maxHumanHours: number;
  consumedHumanHours: number;
  maxActiveDays: number;
  activeDays: number;
}

export type SystemGateDecision = 'GO' | 'REVIEW_REQUIRED';

export interface StrategyPreflightInput {
  makerId: string;
  checkerId: string;
  market: MarketConstraintsInput;
  positionBaseQty: number;
  adverseExitPrice: number;
  riskEnvelope: RiskEnvelope;
  economics: EconomicsInput;
  edgeThesis: EdgeThesis;
  attention: AttentionBudget;
}

export interface StrategyAuthorizationProfile {
  authorized: boolean;
  reasons: string[];
  market: ReturnType<typeof deriveMarketConstraints>;
  stressedReducibility: ReturnType<typeof calculateStressedReducibility>;
  economics: ReturnType<typeof evaluateEconomics>;
  systemGate: SystemGateDecision;
  generatedAt: string;
}

export function evaluateAttentionGate(attention: AttentionBudget): SystemGateDecision {
  if (!Number.isFinite(attention.maxHumanHours) || attention.maxHumanHours <= 0) {
    throw new Error('maximum human hours must be finite and > 0');
  }
  if (!Number.isFinite(attention.consumedHumanHours) || attention.consumedHumanHours < 0) {
    throw new Error('consumed human hours must be finite and >= 0');
  }
  if (!Number.isInteger(attention.maxActiveDays) || attention.maxActiveDays <= 0) {
    throw new Error('maximum active days must be a positive integer');
  }
  if (!Number.isInteger(attention.activeDays) || attention.activeDays < 0) {
    throw new Error('active days must be a non-negative integer');
  }

  return attention.consumedHumanHours >= attention.maxHumanHours ||
    attention.activeDays >= attention.maxActiveDays
    ? 'REVIEW_REQUIRED'
    : 'GO';
}

/**
 * Slow-path preflight. Run when enabling or materially changing a strategy/venue,
 * never inside the order hot path. Invalid material inputs throw and therefore
 * cannot produce an authorization profile.
 */
export function runStrategyPreflight(input: StrategyPreflightInput): StrategyAuthorizationProfile {
  const reasons: string[] = [];

  try {
    assertMakerCheckerIndependence(input.makerId, input.checkerId);
  } catch (error) {
    reasons.push((error as Error).message);
  }

  const market = deriveMarketConstraints(input.market);
  const stressedReducibility = calculateStressedReducibility(
    input.positionBaseQty,
    input.market,
    input.adverseExitPrice
  );

  const envelope = validateRiskEnvelope(input.riskEnvelope);
  reasons.push(...envelope.reasons);

  const economics = evaluateEconomics(input.economics);
  if (!economics.economicallyViable) reasons.push('minimum viable edge / benchmark gate failed');

  reasons.push(...validateEdgeThesis(input.edgeThesis));

  if (
    input.riskEnvelope.minExitSlices !== undefined &&
    stressedReducibility.totalExitSlices < input.riskEnvelope.minExitSlices
  ) {
    reasons.push('stressed reducibility below strategy requirement');
  }

  const systemGate = evaluateAttentionGate(input.attention);
  if (systemGate === 'REVIEW_REQUIRED') reasons.push('system GO/PAUSE/KILL review required');

  return {
    authorized: reasons.length === 0,
    reasons,
    market,
    stressedReducibility,
    economics,
    systemGate,
    generatedAt: new Date().toISOString(),
  };
}
