export type BindingConstraint = 'base' | 'quote' | 'both' | 'none';

export interface MarketConstraintsInput {
  venue: string;
  symbol: string;
  price: number;
  minBaseQty?: number;
  minQuoteNotional?: number;
  stepSize?: number;
  feeAsset?: 'base' | 'quote' | 'other';
}

export interface MarketConstraints extends MarketConstraintsInput {
  minExecutableBaseQty: number;
  minExecutableNotional: number;
  bindingConstraint: BindingConstraint;
}

export interface ReducibilitySnapshot {
  price: number;
  minExecutableBaseQty: number;
  minExecutableNotional: number;
  totalExitSlices: number;
  discretionaryPartialExits: number;
  remainderBaseQty: number;
  bindingConstraint: BindingConstraint;
}

export interface RiskEnvelope {
  authorizedCapital: number;
  maxGrossExposure: number;
  maxDailyLoss: number;
  maxDrawdown: number;
  maxConcurrentSlots: number;
  maxRiskPerPosition: number;
  maxPositionNotional: number;
  minExitSlices?: number;
}

export interface EnvelopeValidation {
  valid: boolean;
  reasons: string[];
}

export interface EconomicsInput {
  grossEdgeBps: number;
  entryFeeBps: number;
  exitFeeBps: number;
  spreadBps: number;
  slippageBps: number;
  adverseSelectionBps?: number;
  infraCostBps?: number;
  adminCostBps?: number;
  safetyMarginBps?: number;
  holdingPeriodMinutes: number;
  expectedTradesPerDay: number;
  benchmarkReturnBpsSameHorizon: number;
}

export interface EconomicsResult {
  allInCostBps: number;
  minimumViableEdgeBps: number;
  strategyAlphaBps: number;
  beatsBenchmark: boolean;
  economicallyViable: boolean;
  holdingPeriodMinutes: number;
  expectedTradesPerDay: number;
}

export interface EdgeThesis {
  id: string;
  anomaly: string;
  counterparty: string;
  whyCounterpartyLoses: string;
  persistenceMechanism: string;
  expectedDecayMinutes: number;
  falsificationCondition: string;
  expectedHoldingPeriodMinutes: number;
}

export interface CapitalAuthority {
  observedBalance: number;
  authorizedCapital: number;
  hardCeiling: number;
}

export type TradingAuthorityState = 'ACTIVE' | 'REDUCING' | 'HALTED';

export interface GovernanceState extends CapitalAuthority {
  tradingState: TradingAuthorityState;
  maxGrossExposure: number;
  maxConcurrentSlots: number;
}
