import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizeCapital,
  calculateReducibility,
  calculateStressedReducibility,
  degradeAuthority,
  evaluateEconomics,
  evaluateFastGate,
  runStrategyPreflight,
  validateRiskEnvelope,
} from '../../src/p300/index';

test('capital increases require explicit human approval', () => {
  const state = { observedBalance: 300, authorizedCapital: 25, hardCeiling: 300 };
  assert.throws(() => authorizeCapital(state, 50, false));
  assert.equal(authorizeCapital(state, 50, true).authorizedCapital, 50);
});

test('automatic degradation can only reduce autonomy', () => {
  const state = {
    observedBalance: 300,
    authorizedCapital: 50,
    hardCeiling: 300,
    tradingState: 'ACTIVE' as const,
    maxGrossExposure: 30,
    maxConcurrentSlots: 3,
  };
  const reduced = degradeAuthority(state, {
    authorizedCapital: 25,
    maxGrossExposure: 18,
    maxConcurrentSlots: 2,
  });
  assert.equal(reduced.tradingState, 'REDUCING');
  assert.throws(() => degradeAuthority(state, {
    authorizedCapital: 75,
    maxGrossExposure: 30,
    maxConcurrentSlots: 3,
  }));
});

test('quote minimum erodes reducibility when price falls', () => {
  const market = {
    venue: 'example', symbol: 'BTC/EUR', price: 70_000,
    minQuoteNotional: 5, stepSize: 0.000001,
  };
  const qty = 10 / 70_000;
  const now = calculateReducibility(qty, market);
  const stressed = calculateStressedReducibility(qty, market, 35_000);
  assert.ok(now.totalExitSlices >= 2);
  assert.ok(stressed.totalExitSlices < now.totalExitSlices);
  assert.equal(stressed.bindingConstraint, 'quote');
});

test('base minimum preserves slice count across price changes', () => {
  const market = {
    venue: 'example', symbol: 'BTC/EUR', price: 70_000,
    minBaseQty: 0.0001, minQuoteNotional: 0.45, stepSize: 0.00000001,
  };
  const qty = 0.0002;
  const now = calculateReducibility(qty, market);
  const stressed = calculateStressedReducibility(qty, market, 35_000);
  assert.equal(now.totalExitSlices, 2);
  assert.equal(stressed.totalExitSlices, 2);
  assert.equal(stressed.bindingConstraint, 'base');
});

test('risk envelope rejects internally inconsistent slots and daily loss', () => {
  const result = validateRiskEnvelope({
    authorizedCapital: 30,
    maxGrossExposure: 24,
    maxDailyLoss: 3,
    maxDrawdown: 15,
    maxConcurrentSlots: 3,
    maxRiskPerPosition: 2,
    maxPositionNotional: 8,
  });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some(r => r.includes('slots × max risk')));
});

test('MVE is horizon-aware and must beat same-horizon benchmark', () => {
  const result = evaluateEconomics({
    grossEdgeBps: 95,
    entryFeeBps: 10,
    exitFeeBps: 10,
    spreadBps: 5,
    slippageBps: 5,
    safetyMarginBps: 10,
    holdingPeriodMinutes: 60,
    expectedTradesPerDay: 2,
    benchmarkReturnBpsSameHorizon: 70,
  });
  assert.equal(result.minimumViableEdgeBps, 40);
  assert.equal(result.economicallyViable, false);
  assert.ok(result.strategyAlphaBps < 0);
});

test('slow preflight rejects maker/checker collision and attention gate expiry', () => {
  const profile = runStrategyPreflight({
    makerId: 'same-agent', checkerId: 'same-agent',
    market: { venue: 'x', symbol: 'BTC/EUR', price: 50_000, minQuoteNotional: 5 },
    positionBaseQty: 0.0002,
    adverseExitPrice: 45_000,
    riskEnvelope: {
      authorizedCapital: 25,
      maxGrossExposure: 15,
      maxDailyLoss: 3,
      maxDrawdown: 15,
      maxConcurrentSlots: 3,
      maxRiskPerPosition: 1,
      maxPositionNotional: 5,
      minExitSlices: 1,
    },
    economics: {
      grossEdgeBps: 100,
      entryFeeBps: 10,
      exitFeeBps: 10,
      spreadBps: 5,
      slippageBps: 5,
      holdingPeriodMinutes: 30,
      expectedTradesPerDay: 1,
      benchmarkReturnBpsSameHorizon: 0,
    },
    edgeThesis: {
      id: 't1', anomaly: 'x', counterparty: 'y', whyCounterpartyLoses: 'z',
      persistenceMechanism: 'p', expectedDecayMinutes: 60,
      falsificationCondition: 'f', expectedHoldingPeriodMinutes: 30,
    },
    attention: { maxHumanHours: 20, consumedHumanHours: 20, maxActiveDays: 21, activeDays: 10 },
  });
  assert.equal(profile.authorized, false);
  assert.equal(profile.systemGate, 'REVIEW_REQUIRED');
  assert.ok(profile.reasons.some(r => r.includes('maker and checker')));
});

test('fast gate is deterministic and REDUCING blocks new exposure only', () => {
  const profile = {
    strategyId: 's1', authorized: true, authorizedCapital: 25,
    maxGrossExposure: 15, maxConcurrentSlots: 3, tradingState: 'REDUCING' as const,
  };
  assert.equal(evaluateFastGate(profile, {
    strategyId: 's1', requestedNotional: 5, currentGrossExposure: 10,
    currentOpenSlots: 2, isOpeningExposure: true,
  }).allowed, false);
  assert.equal(evaluateFastGate(profile, {
    strategyId: 's1', requestedNotional: 5, currentGrossExposure: 10,
    currentOpenSlots: 2, isOpeningExposure: false,
  }).allowed, true);
});
