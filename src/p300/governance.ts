import type {
  CapitalAuthority,
  EnvelopeValidation,
  GovernanceState,
  RiskEnvelope,
} from './types';

export function authorizeCapital(
  state: CapitalAuthority,
  requested: number,
  humanApproved: boolean
): CapitalAuthority {
  if (requested < 0) throw new Error('requested capital must be >= 0');
  if (requested > state.hardCeiling) throw new Error('requested capital exceeds hard ceiling');
  if (requested > state.observedBalance) throw new Error('requested capital exceeds observed balance');
  if (requested > state.authorizedCapital && !humanApproved) {
    throw new Error('capital increase requires explicit human approval');
  }
  return { ...state, authorizedCapital: requested };
}

export function validateRiskEnvelope(envelope: RiskEnvelope): EnvelopeValidation {
  const reasons: string[] = [];

  if (envelope.authorizedCapital < 0) reasons.push('authorized capital must be >= 0');
  if (envelope.maxGrossExposure < 0) reasons.push('max gross exposure must be >= 0');
  if (envelope.maxDailyLoss <= 0) reasons.push('max daily loss must be > 0');
  if (envelope.maxDrawdown <= 0) reasons.push('max drawdown must be > 0');
  if (!Number.isInteger(envelope.maxConcurrentSlots) || envelope.maxConcurrentSlots < 0) {
    reasons.push('max concurrent slots must be a non-negative integer');
  }
  if (envelope.maxRiskPerPosition < 0) reasons.push('max risk per position must be >= 0');
  if (envelope.maxPositionNotional < 0) reasons.push('max position notional must be >= 0');

  if (envelope.maxGrossExposure > envelope.authorizedCapital) {
    reasons.push('gross exposure exceeds authorized capital');
  }

  if (envelope.maxConcurrentSlots * envelope.maxRiskPerPosition > envelope.maxDailyLoss + 1e-12) {
    reasons.push('slots × max risk per position exceeds daily loss limit');
  }

  if (envelope.maxConcurrentSlots * envelope.maxPositionNotional < envelope.maxGrossExposure - 1e-12) {
    reasons.push('slot capacity cannot represent declared max gross exposure');
  }

  if (envelope.maxDrawdown < envelope.maxDailyLoss) {
    reasons.push('max drawdown is smaller than max daily loss');
  }

  if (envelope.minExitSlices !== undefined && envelope.minExitSlices < 1) {
    reasons.push('minimum exit slices must be >= 1 when configured');
  }

  return { valid: reasons.length === 0, reasons };
}

export function assertMakerCheckerIndependence(makerId: string, checkerId: string): void {
  if (!makerId.trim() || !checkerId.trim()) throw new Error('maker and checker ids are required');
  if (makerId === checkerId) throw new Error('maker and checker must be independent');
}

/**
 * Losses may reduce autonomy automatically. Profits never expand it.
 */
export function degradeAuthority(
  state: GovernanceState,
  next: Pick<GovernanceState, 'authorizedCapital' | 'maxGrossExposure' | 'maxConcurrentSlots'>
): GovernanceState {
  if (next.authorizedCapital > state.authorizedCapital) {
    throw new Error('automatic degradation cannot increase authorized capital');
  }
  if (next.maxGrossExposure > state.maxGrossExposure) {
    throw new Error('automatic degradation cannot increase gross exposure');
  }
  if (next.maxConcurrentSlots > state.maxConcurrentSlots) {
    throw new Error('automatic degradation cannot increase concurrent slots');
  }

  return {
    ...state,
    ...next,
    tradingState: next.authorizedCapital === 0 || next.maxConcurrentSlots === 0 ? 'HALTED' : 'REDUCING',
  };
}
