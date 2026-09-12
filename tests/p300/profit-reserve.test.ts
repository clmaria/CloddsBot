import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateProfitReserve, evaluateSweep, hashAuthorizationProfile, verifyAuthorizationProfileHash } from '../../src/p300/index';

test('protected principal is not part of sweepable reserve', () => {
  const policy = { protectedPrincipal: 300, minSweepAmount: 50, maxSweepCostPct: 1 };
  const state = calculateProfitReserve(340, policy);
  assert.equal(state.reserve, 40);
  assert.equal(evaluateSweep(state, policy, 0.2).allowed, false);
});

test('sweep requires both amount and cost gates', () => {
  const policy = { protectedPrincipal: 300, minSweepAmount: 50, maxSweepCostPct: 1 };
  const state = calculateProfitReserve(360, policy);
  assert.equal(evaluateSweep(state, policy, 1).allowed, false);
  assert.equal(evaluateSweep(state, policy, 0.5).allowed, true);
});

test('authorization hash is stable across object key ordering', () => {
  const a = { strategyId: 's1', limits: { slots: 2, exposure: 15 } };
  const b = { limits: { exposure: 15, slots: 2 }, strategyId: 's1' };
  const hash = hashAuthorizationProfile(a);
  assert.equal(hashAuthorizationProfile(b), hash);
  assert.equal(verifyAuthorizationProfileHash(b, hash), true);
});
