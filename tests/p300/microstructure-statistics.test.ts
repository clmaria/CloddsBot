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

test('microstructure summary separates depth failures from fillable slippage distributions', () => {
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

  assert.equal(summary.buyFillableSampleCount, 3);
  assert.equal(summary.sellFillableSampleCount, 4);
  assert.equal(summary.buyInsufficientDepthRate, 0.25);
  assert.equal(summary.sellInsufficientDepthRate, 0);

  assert.notEqual(summary.buySlippageBps, null);
  assert.notEqual(summary.sellSlippageBps, null);
  assert.equal(summary.buySlippageBps?.max, 2);
  assert.equal(summary.sellSlippageBps?.max, 8);
  assert.equal(summary.firstObservedAtMs, 1000);
  assert.equal(summary.lastObservedAtMs, 4000);
});

test('slippage distribution is null when no snapshot can fully fill the ticket', () => {
  const summary = summarizeMicrostructure([
    { observedAtMs: 1000, economics: economics({ buyFullyFillable: false, buySlippageBps: 1 }) },
    { observedAtMs: 2000, economics: economics({ buyFullyFillable: false, buySlippageBps: 2 }) },
  ]);

  assert.equal(summary.buyFillableSampleCount, 0);
  assert.equal(summary.buyInsufficientDepthRate, 1);
  assert.equal(summary.buySlippageBps, null);
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
