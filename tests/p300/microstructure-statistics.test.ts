import assert from 'node:assert/strict';
import test from 'node:test';
import type { OrderBookEconomics } from '../../src/p300/order-book-economics';
import { summarizeMicrostructure } from '../../src/p300/microstructure-statistics';

function economics(overrides: Partial<OrderBookEconomics> = {}): OrderBookEconomics {
  return {
    bestBid: 100,
    bestAsk: 100.1,
    mid: 100.05,
    spreadBps: 10,
    buyVwap: 100.1,
    sellVwap: 100,
    buySlippageBps: 0,
    sellSlippageBps: 0,
    buyFilledQuote: 10,
    sellFilledQuote: 10,
    buyFullyFillable: true,
    sellFullyFillable: true,
    ...overrides,
  };
}

test('microstructure summary reports p50/p90/p99 and depth failure rates', () => {
  const summary = summarizeMicrostructure([
    { observedAtMs: 1000, economics: economics({ spreadBps: 1, buySlippageBps: 0, sellSlippageBps: 0 }) },
    { observedAtMs: 2000, economics: economics({ spreadBps: 2, buySlippageBps: 1, sellSlippageBps: 1 }) },
    { observedAtMs: 3000, economics: economics({ spreadBps: 3, buySlippageBps: 2, sellSlippageBps: 2 }) },
    { observedAtMs: 4000, economics: economics({ spreadBps: 20, buySlippageBps: 10, sellSlippageBps: 8, buyFullyFillable: false }) },
  ]);

  assert.equal(summary.sampleCount, 4);
  assert.equal(summary.spreadBps.p50, 2.5);
  assert.ok(summary.spreadBps.p90 > 14 && summary.spreadBps.p90 < 15);
  assert.ok(summary.spreadBps.p99 > 19);
  assert.equal(summary.spreadBps.max, 20);
  assert.equal(summary.buyInsufficientDepthRate, 0.25);
  assert.equal(summary.sellInsufficientDepthRate, 0);
  assert.equal(summary.firstObservedAtMs, 1000);
  assert.equal(summary.lastObservedAtMs, 4000);
});

test('microstructure summary rejects empty or invalid samples', () => {
  assert.throws(() => summarizeMicrostructure([]));
  assert.throws(() => summarizeMicrostructure([
    { observedAtMs: 0, economics: economics() },
  ]));
  assert.throws(() => summarizeMicrostructure([
    { observedAtMs: 1000, economics: economics({ spreadBps: Number.POSITIVE_INFINITY }) },
  ]));
});
