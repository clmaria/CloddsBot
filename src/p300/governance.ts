import type {
  CapitalAuthority,
  EnvelopeValidation,
  GovernanceState,
  RiskEnvelope,
} from './types';

function requireFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and >= 0`);
}

function validateCapitalState(state: CapitalAuthority): void {
  requireFiniteNonNegative(state.observedBalance, 'observed balance');
  requireFiniteNonNegative(state.authorizedCapital, 'authorized capital');
  requireFiniteNonNegative(state.hardCeiling, 'hard ceiling');
  if (state.authorizedCapital > state.observedBalance) {
    throw new Error('authorized capital exceeds observed balance');
  }
  if (state.authorizedCapital > state.hardCeiling) {
    throw new Error('authorized capital exceeds hard ceiling');
  }
}

export function authorizeCapital(
  state: CapitalAuthority,
  requested: number,
  humanApproved: boolean
): CapitalAuthority {
  validateCapitalState(state);
  requireFiniteNonNegative(requested, 'requested capital');
  if (requested > state.hardCeiling) throw new Error('requested capital exceeds hard ceiling');
  if (requested > state.observedBalance) throw new Error('requested capital exceeds observed balance');
  if (requested > state.authorizedCapital && !humanApproved) {
    throw new Error('capital increase requires explicit human approval');
  }
  return { ...state, authorizedCapital: requested };
}

export function validateRiskEnvelope(envelope: RiskEnvelope): EnvelopeValidation {
  const reasons: string[] = [];

  const finiteNonNegative: Array<[string, number]> = [
    ['authorized capital', envelope.authorizedCapital],
    ['max gross exposure', envelope.maxGrossExposure],
    ['max risk per position', envelope.maxRiskPerPosition],
    ['max position notional', envelope.maxPositionNotional],
  ];
  for (const [name, value] of finiteNonNegative) {
    if (!Number.isFinite(value) || value < 0) reasons.push(`${name} must be finite and >= 0`);
  }

  if (!Number.isFinite(envelope.maxDailyLoss) || envelope.maxDailyLoss <= 0) {
    reasons.push('max daily loss must be finite and > 0');
  }
  if (!Number.isFinite(envelope.maxDrawdown) || envelope.maxDrawdown <= 0) {
    reasons.push('max drawdown must be finite and > 0');
  }
  if (!Number.isInteger(envelope.maxConcurrentSlots) || envelope.maxConcurrentSlots < 0) {
    reasons.push('max concurrent slots must be a non-negative integer');
  }
  if (
    envelope.minExitSlices !== undefined &&
    (!Number.isInteger(envelope.minExitSlices) || envelope.minExitSlices < 1)
  ) {
    reasons.push('minimum exit slices must be a positive integer when configured');
  }

  // Only evaluate relational invariants when the inputs involved are finite.
  if (
    Number.isFinite(envelope.maxGrossExposure) &&
    Number.isFinite(envelope.authorizedCapital) &&
    envelope.maxGrossExposure > envelope.authorizedCapital
  ) {
    reasons.push('gross exposure exceeds authorized capital');
  }

  // P300 is a no-leverage Spot envelope. A loss/drawdown limit larger than all
  // authorized capital cannot function as a protective bound and is internally
  // inconsistent with the capital authority.
  if (
    Number.isFinite(envelope.maxDailyLoss) &&
    Number.isFinite(envelope.authorizedCapital) &&
    envelope.maxDailyLoss > envelope.authorizedCapital + 1e-12
  ) {
    reasons.push('max daily loss exceeds authorized capital');
  }

  if (
    Number.isFinite(envelope.maxDrawdown) &&
    Number.isFinite(envelope.authorizedCapital) &&
    envelope.maxDrawdown > envelope.authorizedCapital + 1e-12
  ) {
    reasons.push('max drawdown exceeds authorized capital');
  }

  if (
    Number.isFinite(envelope.maxRiskPerPosition) &&
    Number.isFinite(envelope.maxDailyLoss) &&
    Number.isInteger(envelope.maxConcurrentSlots) &&
    envelope.maxConcurrentSlots * envelope.maxRiskPerPosition > envelope.maxDailyLoss + 1e-12
  ) {
    reasons.push('slots × max risk per position exceeds daily loss limit');
  }

  if (
    Number.isFinite(envelope.maxPositionNotional) &&
    Number.isFinite(envelope.maxGrossExposure) &&
    Number.isInteger(envelope.maxConcurrentSlots) &&
    envelope.maxConcurrentSlots * envelope.maxPositionNotional < envelope.maxGrossExposure - 1e-12
  ) {
    reasons.push('slot capacity cannot represent declared max gross exposure');
  }

  if (
    Number.isFinite(envelope.maxDrawdown) &&
    Number.isFinite(envelope.maxDailyLoss) &&
    envelope.maxDrawdown < envelope.maxDailyLoss
  ) {
    reasons.push('max drawdown is smaller than max daily loss');
  }

  if (
    Number.isFinite(envelope.maxRiskPerPosition) &&
    Number.isFinite(envelope.maxPositionNotional) &&
    envelope.maxRiskPerPosition > envelope.maxPositionNotional + 1e-12
  ) {
    reasons.push('max risk per position exceeds max position notional');
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
  validateCapitalState(state);
  requireFiniteNonNegative(state.maxGrossExposure, 'current max gross exposure');
  if (!Number.isInteger(state.maxConcurrentSlots) || state.maxConcurrentSlots < 0) {
    throw new Error('current max concurrent slots must be a non-negative integer');
  }

  requireFiniteNonNegative(next.authorizedCapital, 'next authorized capital');
  requireFiniteNonNegative(next.maxGrossExposure, 'next max gross exposure');
  if (!Number.isInteger(next.maxConcurrentSlots) || next.maxConcurrentSlots < 0) {
    throw new Error('next max concurrent slots must be a non-negative integer');
  }

  if (next.authorizedCapital > state.authorizedCapital) {
    throw new Error('automatic degradation cannot increase authorized capital');
  }
  if (next.maxGrossExposure > state.maxGrossExposure) {
    throw new Error('automatic degradation cannot increase gross exposure');
  }
  if (next.maxConcurrentSlots > state.maxConcurrentSlots) {
    throw new Error('automatic degradation cannot increase concurrent slots');
  }
  if (next.maxGrossExposure > next.authorizedCapital) {
    throw new Error('next gross exposure exceeds next authorized capital');
  }

  return {
    ...state,
    ...next,
    tradingState: next.authorizedCapital === 0 || next.maxConcurrentSlots === 0 ? 'HALTED' : 'REDUCING',
  };
}
