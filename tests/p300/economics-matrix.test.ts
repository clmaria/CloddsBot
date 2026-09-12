import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateEconomicsMatrixCandidate,
  rankEconomicsMatrix,
} from '../../src/p300/economics-matrix';

test('economics matrix rejects candidate that cannot reduce under stress', () => {
  const row = evaluateEconomicsMatrixCandidate({
    venue: 'example',
    symbol: 'BTC/EUR',
    market: {
      venue: 'example',
      symbol: 'BTC/EUR',
      price: 70_000,
      minQuoteNotional: 5,
      stepSize: 0.000001,
    },
    positionBaseQty: 0.00015,
    adverseExitPrice: 35_000,
    requiredExitSlices: 2,
    economics: {
      grossEdgeBps: 120,
      entryFeeBps: 10,
      exitFeeBps: 10,
      spreadBps: 5,
      slippageBps: 5,
      safetyMarginBps: 10,
      holdingPeriodMinutes: 60,
      expectedTradesPerDay: 1,
      benchmarkReturnBpsSameHorizon: 10,
    },
  });

  assert.equal(row.tradable, false);
  assert.ok(row.reasons.includes('insufficient stressed exit granularity'));
});

test('economics matrix rejects beta disguised as alpha', () => {
  const row = evaluateEconomicsMatrixCandidate({
    venue: 'example',
    symbol: 'BTC/EUR',
    market: {
      venue: 'example',
      symbol: 'BTC/EUR',
      price: 50_000,
      minBaseQty: 0.0001,
      minQuoteNotional: 0.45,
      stepSize: 0.00000001,
    },
    positionBaseQty: 0.0002,
    adverseExitPrice: 45_000,
    requiredExitSlices: 1,
    economics: {
      grossEdgeBps: 95,
      entryFeeBps: 10,
      exitFeeBps: 10,
      spreadBps: 5,
      slippageBps: 5,
      holdingPeriodMinutes: 60,
      expectedTradesPerDay: 1,
      benchmarkReturnBpsSameHorizon: 80,
    },
  });

  assert.equal(row.economicallyViable, false);
  assert.ok(row.strategyAlphaBps < 0);
  assert.equal(row.tradable, false);
});

test('ranking prefers viable higher-alpha candidate', () => {
  const a = evaluateEconomicsMatrixCandidate({
    venue: 'a',
    symbol: 'BTC/EUR',
    market: {
      venue: 'a', symbol: 'BTC/EUR', price: 50_000,
      minBaseQty: 0.0001, minQuoteNotional: 0.45, stepSize: 0.00000001,
    },
    positionBaseQty: 0.0002,
    adverseExitPrice: 45_000,
    economics: {
      grossEdgeBps: 120,
      entryFeeBps: 10,
      exitFeeBps: 10,
      spreadBps: 5,
      slippageBps: 5,
      safetyMarginBps: 10,
      holdingPeriodMinutes: 30,
      expectedTradesPerDay: 1,
      benchmarkReturnBpsSameHorizon: 10,
    },
  });

  const b = evaluateEconomicsMatrixCandidate({
    venue: 'b',
    symbol: 'BTC/EUR',
    market: {
      venue: 'b', symbol: 'BTC/EUR', price: 50_000,
      minBaseQty: 0.0001, minQuoteNotional: 0.45, stepSize: 0.00000001,
    },
    positionBaseQty: 0.0002,
    adverseExitPrice: 45_000,
    economics: {
      grossEdgeBps: 90,
      entryFeeBps: 10,
      exitFeeBps: 10,
      spreadBps: 5,
      slippageBps: 5,
      safetyMarginBps: 10,
      holdingPeriodMinutes: 30,
      expectedTradesPerDay: 1,
      benchmarkReturnBpsSameHorizon: 10,
    },
  });

  const ranked = rankEconomicsMatrix([b, a]);
  assert.equal(ranked[0].venue, 'a');
});
