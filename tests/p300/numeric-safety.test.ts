import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizeCapital,
  canOpenNewExposure,
  createSupervisorState,
  degradeAuthority,
  evaluateFastGate,
  validateRiskEnvelope,
} from '../../src/p300/index';
import { deriveMarketConstraints, calculateReducibility } from '../../src/p300/market-constraints';
import { evaluateEconomics } from '../../src/p300/economics';
import { evaluateOrderBookEconomics } from '../../src/p300/order-book-economics';
import { evaluateAttentionGate } from '../../src/p300/preflight';
import { calculateProfitReserve, evaluateSweep } from '../../src/p300/profit-reserve';

test('capital authority rejects NaN, Infinity and invalid observed state', () => {
  const state = { observedBalance: 300, authorizedCapital: 25, hardCeiling: 300 };
  assert.throws(() => authorizeCapital(state, Number.NaN, true));
  assert.throws(() => authorizeCapital(state, Number.POSITIVE_INFINITY, true));
  assert.throws(() => authorizeCapital({ ...state, observedBalance: Number.NaN }, 25, false));
});

test('risk envelope rejects non-finite values instead of letting NaN bypass comparisons', () => {
  const base = {
    authorizedCapital: 30,
    maxGrossExposure: 20,
    maxDailyLoss: 3,
    maxDrawdown: 10,
    maxConcurrentSlots: 2,
    maxRiskPerPosition: 1,
    maxPositionNotional: 10,
    minExitSlices: 1,
  };
  assert.equal(validateRiskEnvelope({ ...base, authorizedCapital: Number.NaN }).valid, false);
  assert.equal(validateRiskEnvelope({ ...base, maxDailyLoss: Number.POSITIVE_INFINITY }).valid, false);
  assert.equal(validateRiskEnvelope({ ...base, maxRiskPerPosition: Number.NaN }).valid, false);
});

test('automatic degradation rejects corrupted or expanding numeric authority', () => {
  const state = {
    observedBalance: 300,
    authorizedCapital: 50,
    hardCeiling: 300,
    tradingState: 'ACTIVE' as const,
    maxGrossExposure: 30,
    maxConcurrentSlots: 3,
  };
  assert.throws(() => degradeAuthority(state, {
    authorizedCapital: Number.NaN,
    maxGrossExposure: 20,
    maxConcurrentSlots: 2,
  }));
});

test('fast gate rejects negative/non-finite order and exposure inputs', () => {
  const profile = {
    strategyId: 's1', authorized: true, authorizedCapital: 25,
    maxGrossExposure: 15, maxConcurrentSlots: 3, tradingState: 'ACTIVE' as const,
  };
  const base = {
    strategyId: 's1', requestedNotional: 5, currentGrossExposure: 5,
    currentOpenSlots: 1, isOpeningExposure: true,
  };
  assert.equal(evaluateFastGate(profile, { ...base, requestedNotional: -5 }).allowed, false);
  assert.equal(evaluateFastGate(profile, { ...base, requestedNotional: Number.NaN }).allowed, false);
  assert.equal(evaluateFastGate(profile, { ...base, currentGrossExposure: Number.NaN }).allowed, false);
  assert.equal(evaluateFastGate(profile, { ...base, currentOpenSlots: -1 }).allowed, false);
});

test('market constraints and reducibility reject invalid numeric market data', () => {
  assert.throws(() => deriveMarketConstraints({
    venue: 'x', symbol: 'BTC/EUR', price: Number.POSITIVE_INFINITY, minQuoteNotional: 5,
  }));
  assert.throws(() => deriveMarketConstraints({
    venue: 'x', symbol: 'BTC/EUR', price: 50_000, stepSize: Number.NaN, minQuoteNotional: 5,
  }));
  assert.throws(() => deriveMarketConstraints({
    venue: 'x', symbol: 'BTC/EUR', price: 50_000, minQuoteNotional: -5,
  }));
  assert.throws(() => deriveMarketConstraints({
    venue: 'x', symbol: 'BTC/EUR', price: 50_000,
  }));
  assert.throws(() => calculateReducibility(Number.NaN, {
    venue: 'x', symbol: 'BTC/EUR', price: 50_000, minQuoteNotional: 5,
  }));
});

test('economics rejects impossible negative/non-finite cost inputs', () => {
  const base = {
    grossEdgeBps: 100,
    entryFeeBps: 10,
    exitFeeBps: 10,
    spreadBps: 2,
    slippageBps: 2,
    holdingPeriodMinutes: 30,
    expectedTradesPerDay: 1,
    benchmarkReturnBpsSameHorizon: 0,
  };
  assert.throws(() => evaluateEconomics({ ...base, entryFeeBps: -1 }));
  assert.throws(() => evaluateEconomics({ ...base, spreadBps: Number.NaN }));
  assert.throws(() => evaluateEconomics({ ...base, grossEdgeBps: Number.POSITIVE_INFINITY }));
});

test('supervisor and attention gates reject invalid numeric control state', () => {
  const state = createSupervisorState();
  assert.throws(() => canOpenNewExposure(state, {
    maxConsecutiveDecisionFailures: 3,
    recoverySuccessesRequired: 2,
    maxEntriesPerHour: Number.NaN,
  }));
  assert.throws(() => evaluateAttentionGate({
    maxHumanHours: 20,
    consumedHumanHours: Number.NaN,
    maxActiveDays: 21,
    activeDays: 1,
  }));
  assert.throws(() => evaluateAttentionGate({
    maxHumanHours: 20,
    consumedHumanHours: 1,
    maxActiveDays: 21,
    activeDays: Number.POSITIVE_INFINITY,
  }));
});

test('order-book and profit-reserve calculations reject non-finite economic inputs', () => {
  const book = {
    bids: [{ price: 100, baseQty: 1 }],
    asks: [{ price: 101, baseQty: 1 }],
  };
  assert.throws(() => evaluateOrderBookEconomics(book, Number.POSITIVE_INFINITY));
  assert.throws(() => calculateProfitReserve(Number.NaN, {
    protectedPrincipal: 300, minSweepAmount: 50, maxSweepCostPct: 1,
  }));
  assert.throws(() => evaluateSweep({ equity: 360, reserve: 60 }, {
    protectedPrincipal: 300, minSweepAmount: 50, maxSweepCostPct: 1,
  }, Number.NaN));
});
