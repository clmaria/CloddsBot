export type GateState = 'PASS' | 'FAIL' | 'UNVERIFIED';

export interface VenueGateInput {
  venue: string;
  regulatory: GateState;
  technicalTradability: GateState;
  riskReducibility: GateState;
  economics: GateState;
  reportingOperations: GateState;
  executionAdapter: 'READY' | 'MISSING';
}

export type VenueGateStatus =
  | 'BLOCKED_REGULATORY'
  | 'NO_GO'
  | 'RESEARCH_ONLY'
  | 'ADAPTER_REQUIRED'
  | 'PAPER_READY';

export interface VenueGateResult {
  venue: string;
  status: VenueGateStatus;
  reasons: string[];
}

/**
 * Mandatory venue gates are lexicographic: a cheap venue cannot compensate for
 * a regulatory, technical, risk or economics failure. PAPER_READY is still not
 * permission for LIVE trading.
 */
export function evaluateVenueGate(input: VenueGateInput): VenueGateResult {
  if (!input.venue.trim()) throw new Error('venue is required');
  const reasons: string[] = [];

  if (input.regulatory !== 'PASS') {
    reasons.push(`regulatory gate is ${input.regulatory}`);
    return { venue: input.venue, status: 'BLOCKED_REGULATORY', reasons };
  }

  const mandatory: Array<[string, GateState]> = [
    ['technical tradability', input.technicalTradability],
    ['risk/reducibility', input.riskReducibility],
    ['economics', input.economics],
    ['reporting/operations', input.reportingOperations],
  ];

  for (const [name, state] of mandatory) {
    if (state === 'FAIL') reasons.push(`${name} gate failed`);
  }
  if (reasons.length) return { venue: input.venue, status: 'NO_GO', reasons };

  const unverified = mandatory.filter(([, state]) => state === 'UNVERIFIED').map(([name]) => name);
  if (unverified.length) {
    return {
      venue: input.venue,
      status: 'RESEARCH_ONLY',
      reasons: unverified.map((name) => `${name} gate is unverified`),
    };
  }

  if (input.executionAdapter === 'MISSING') {
    return {
      venue: input.venue,
      status: 'ADAPTER_REQUIRED',
      reasons: ['all pre-adapter gates pass but execution adapter is missing'],
    };
  }

  return {
    venue: input.venue,
    status: 'PAPER_READY',
    reasons: ['all venue gates pass; PAPER only, LIVE still requires separate promotion'],
  };
}
