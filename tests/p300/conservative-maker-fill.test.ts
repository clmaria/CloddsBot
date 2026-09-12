import assert from 'node:assert/strict';
import test from 'node:test';
import {
  simulateConservativeMakerFill,
  type ConservativeMakerFillRequest,
  type ObservedPublicTrade,
} from '../../src/p300/conservative-maker-fill';

const MARKET = 'BTC-USDC';
const ACTIVATED_NS = '1752139200000000000';
const ACTIVE_UNTIL_NS = '1752139200000001000';

function request(overrides: Partial<ConservativeMakerFillRequest> = {}): ConservativeMakerFillRequest {
  return {
    market: MARKET,
    side: 'buy',
    limitPrice: 100,
    baseQty: 0.5,
    activatedAtNs: ACTIVATED_NS,
    activeUntilNs: ACTIVE_UNTIL_NS,
    activationBook: {
      bids: [{ price: 100, baseQty: 1 }, { price: 99, baseQty: 2 }],
      asks: [{ price: 101, baseQty: 1 }, { price: 102, baseQty: 2 }],
    },
    trades: [],
    tradeStreamIntegrityVerified: true,
    regularTradingVerified: true,
    ...overrides,
  };
}

function trade(
  id: string,
  takerSide: 'buy' | 'sell',
  price: number,
  baseQty: number,
  timestampNs: string,
): ObservedPublicTrade {
  return { id, market: MARKET, takerSide, price, baseQty, timestampNs };
}

test('maker buy stays behind initial same-price queue and fills only after taker sells consume it', () => {
  const result = simulateConservativeMakerFill(request({
    trades: [
      trade('t1', 'sell', 100, 0.8, '1752139200000000100'),
      trade('t2', 'sell', 100, 0.4, '1752139200000000200'),
      trade('t3', 'sell', 100, 0.3, '1752139200000000300'),
    ],
  }));

  assert.equal(result.queueAheadBaseInitial, 1);
  assert.equal(result.queueAheadBaseRemaining, 0);
  assert.equal(result.status, 'filled');
  assert.equal(result.evidence, 'trade-at-price');
  assert.ok(Math.abs(result.filledBase - 0.5) < 1e-12);
  assert.equal(result.firstFillTimestampNs, '1752139200000000200');
  assert.equal(result.fullFillTimestampNs, '1752139200000000300');
});

test('same-side taker trades and better-price activity do not grant a maker buy a fill', () => {
  const result = simulateConservativeMakerFill(request({
    trades: [
      trade('t1', 'buy', 100, 5, '1752139200000000100'),
      trade('t2', 'sell', 101, 5, '1752139200000000200'),
    ],
  }));

  assert.equal(result.status, 'unfilled');
  assert.equal(result.queueAheadBaseRemaining, 1);
  assert.equal(result.filledBase, 0);
});

test('opposite-side trade through the buy limit is strong full-fill evidence', () => {
  const result = simulateConservativeMakerFill(request({
    trades: [trade('through', 'sell', 99.5, 0.01, '1752139200000000100')],
  }));

  assert.equal(result.status, 'filled');
  assert.equal(result.evidence, 'trade-through');
  assert.equal(result.filledBase, 0.5);
  assert.equal(result.fullFillTimestampNs, '1752139200000000100');
});

test('maker sell model is symmetric and uses taker buys to consume ask queue', () => {
  const result = simulateConservativeMakerFill(request({
    side: 'sell',
    limitPrice: 101,
    baseQty: 0.4,
    trades: [
      trade('t1', 'buy', 101, 1.1, '1752139200000000100'),
      trade('t2', 'buy', 101, 0.3, '1752139200000000200'),
    ],
  }));

  assert.equal(result.status, 'filled');
  assert.equal(result.evidence, 'trade-at-price');
  assert.ok(Math.abs(result.filledBase - 0.4) < 1e-12);
});

test('post-only crossings are rejected rather than counted as maker fills', () => {
  const buy = simulateConservativeMakerFill(request({ limitPrice: 101 }));
  assert.equal(buy.status, 'rejected-post-only');
  assert.equal(buy.evidence, 'post-only-reject');

  const sell = simulateConservativeMakerFill(request({ side: 'sell', limitPrice: 100 }));
  assert.equal(sell.status, 'rejected-post-only');
});

test('trades before activation and after cancellation are ignored', () => {
  const result = simulateConservativeMakerFill(request({
    activeUntilNs: '1752139200000000250',
    activationBook: {
      bids: [{ price: 100, baseQty: 0.1 }],
      asks: [{ price: 101, baseQty: 1 }],
    },
    trades: [
      trade('too-late', 'sell', 99, 100, '1752139200000000300'),
      trade('inside-window', 'sell', 100, 0.5, '1752139200000000200'),
      trade('before', 'sell', 100, 100, '1752139199999999999'),
    ],
  }));

  assert.equal(result.status, 'partially-filled');
  assert.equal(result.evidence, 'trade-at-price');
  assert.ok(Math.abs(result.filledBase - 0.4) < 1e-12);
  assert.equal(result.firstFillTimestampNs, '1752139200000000200');
  assert.equal(result.fullFillTimestampNs, undefined);
});

test('active window must be precision-safe and strictly positive in duration', () => {
  assert.throws(
    () => simulateConservativeMakerFill(request({ activeUntilNs: ACTIVATED_NS })),
    /must be after/,
  );
  assert.throws(
    () => simulateConservativeMakerFill(request({ activeUntilNs: 1_752_139_200_000_001_000 as unknown as string })),
    /precision-safe/,
  );
});

test('fill inference fails closed without stream integrity or regular trading', () => {
  assert.throws(
    () => simulateConservativeMakerFill(request({ tradeStreamIntegrityVerified: false })),
    /integrity/,
  );
  assert.throws(
    () => simulateConservativeMakerFill(request({ regularTradingVerified: false })),
    /regular trading/,
  );
});

test('fill inference rejects duplicate ids, mixed markets and precision-lossy timestamps', () => {
  assert.throws(() => simulateConservativeMakerFill(request({
    trades: [
      trade('dup', 'sell', 100, 1, '1752139200000000100'),
      trade('dup', 'sell', 100, 1, '1752139200000000200'),
    ],
  })), /duplicate trade id/);

  assert.throws(() => simulateConservativeMakerFill(request({
    trades: [{ ...trade('other', 'sell', 100, 1, '1752139200000000100'), market: 'ETH-USDC' }],
  })), /market does not match/);

  assert.throws(() => simulateConservativeMakerFill(request({
    trades: [{ ...trade('bad-ts', 'sell', 100, 1, '1752139200000000100'), timestampNs: 1_752_139_200_000_000_000 as unknown as string }],
  })), /precision-safe/);
});
