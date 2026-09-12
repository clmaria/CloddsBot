import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateOrderBookEconomics } from '../../src/p300/order-book-economics';

function assertClose(actual: number, expected: number, epsilon = 1e-10): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

test('order book economics computes spread and zero slippage inside top level', () => {
  const result = evaluateOrderBookEconomics({
    bids: [{ price: 99.9, baseQty: 10 }],
    asks: [{ price: 100.1, baseQty: 10 }],
  }, 25);

  assert.ok(result.spreadBps > 19 && result.spreadBps < 21);
  assertClose(result.buyVwap, 100.1);
  assertClose(result.sellVwap, 99.9);
  assertClose(result.buySlippageBps, 0);
  assertClose(result.sellSlippageBps, 0);
  assert.equal(result.buyFullyFillable, true);
  assert.equal(result.sellFullyFillable, true);
});

test('order book economics captures multi-level VWAP slippage', () => {
  const result = evaluateOrderBookEconomics({
    bids: [
      { price: 100, baseQty: 0.1 },
      { price: 99, baseQty: 1 },
    ],
    asks: [
      { price: 101, baseQty: 0.1 },
      { price: 102, baseQty: 1 },
    ],
  }, 20);

  assert.ok(result.buyVwap > 101);
  assert.ok(result.sellVwap < 100);
  assert.ok(result.buySlippageBps > 0);
  assert.ok(result.sellSlippageBps > 0);
  assert.equal(result.buyFullyFillable, true);
  assert.equal(result.sellFullyFillable, true);
});

test('order book economics flags insufficient depth instead of pretending full fill', () => {
  const result = evaluateOrderBookEconomics({
    bids: [{ price: 100, baseQty: 0.05 }],
    asks: [{ price: 101, baseQty: 0.05 }],
  }, 25);

  assert.equal(result.buyFullyFillable, false);
  assert.equal(result.sellFullyFillable, false);
  assert.ok(result.buyFilledQuote < 25);
  assert.ok(result.sellFilledQuote < 25);
});

test('order book economics rejects crossed or malformed books', () => {
  assert.throws(() => evaluateOrderBookEconomics({
    bids: [{ price: 101, baseQty: 1 }],
    asks: [{ price: 100, baseQty: 1 }],
  }, 10));

  assert.throws(() => evaluateOrderBookEconomics({
    bids: [{ price: 100, baseQty: 0 }],
    asks: [{ price: 101, baseQty: 1 }],
  }, 10));
});
