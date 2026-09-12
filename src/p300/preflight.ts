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
  if (attention.maxHumanHours <= 0 || attention.maxActiveDays <= 0) {
    throw new Error('attention budget limits must be > 0');
  }
  return attention.consumedHumanHours >= attention.maxHumanHours ||
    attention.activeDays >= attention.maxActiveDays
    ? 'REVIEW_REQUIRED'
    : 'GO';
}

/**
 * Slow-path preflight. Run when enabling or materially changing a strategy/venue,
 * never inside the order hot path.
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
