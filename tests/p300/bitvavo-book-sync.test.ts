import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyBitvavoBookUpdate,
  bitvavoStateToOrderBook,
  bitvavoTimestampNsToMs,
  createBitvavoLocalBook,
  synchronizeBitvavoBook,
} from '../../src/p300/bitvavo-book-sync';

const SNAPSHOT = {
  market: 'BTC-USDC',
  nonce: 100,
  bids: [['100', '2'], ['99', '3']],
  asks: [['101', '1'], ['102', '4']],
  timestamp: '1752139200000000000',
};

test('Bitvavo local book applies exactly contiguous add/update/remove events', () => {
  const initial = createBitvavoLocalBook(SNAPSHOT);
  const next = applyBitvavoBookUpdate(initial, {
    event: 'book',
    market: 'BTC-USDC',
    nonce: 101,
    bids: [['100', '0'], ['99', '2.5'], ['98', '1']],
    asks: [['101', '0.5'], ['103', '2']],
    timestamp: '1752139200001000000',
  });

  assert.equal(next.nonce, 101);
  assert.equal(next.bids['100'], undefined);
  assert.equal(next.bids['99'], '2.5');
  assert.equal(next.bids['98'], '1');
  assert.equal(next.asks['101'], '0.5');
  assert.equal(next.asks['103'], '2');

  const book = bitvavoStateToOrderBook(next);
  assert.equal(book.bids[0].price, 99);
  assert.equal(book.asks[0].price, 101);
});

test('Bitvavo local book fails closed on gaps, duplicates and market mismatch', () => {
  const initial = createBitvavoLocalBook(SNAPSHOT);

  assert.throws(() => applyBitvavoBookUpdate(initial, {
    event: 'book', market: 'BTC-USDC', nonce: 102, bids: [], asks: [],
  }), /sequence gap/);

  assert.throws(() => applyBitvavoBookUpdate(initial, {
    event: 'book', market: 'BTC-USDC', nonce: 100, bids: [], asks: [],
  }), /sequence gap/);

  assert.throws(() => applyBitvavoBookUpdate(initial, {
    event: 'book', market: 'ETH-USDC', nonce: 101, bids: [], asks: [],
  }), /market does not match/);
});

test('Bitvavo synchronization requires snapshot to overtake initial buffered update, discards old events and applies contiguous remainder', () => {
  const state = synchronizeBitvavoBook(SNAPSHOT, [
    { event: 'book', market: 'BTC-USDC', nonce: 99, bids: [['97', '1']], asks: [] },
    { event: 'book', market: 'BTC-USDC', nonce: 100, bids: [['98', '9']], asks: [] },
    { event: 'book', market: 'BTC-USDC', nonce: 102, bids: [['99', '1']], asks: [] },
    { event: 'book', market: 'BTC-USDC', nonce: 101, bids: [['100', '1.5']], asks: [] },
  ]);

  assert.equal(state.nonce, 102);
  assert.equal(state.bids['100'], '1.5');
  assert.equal(state.bids['99'], '1');
  assert.equal(state.bids['97'], undefined);

  assert.throws(() => synchronizeBitvavoBook(SNAPSHOT, [
    { event: 'book', market: 'BTC-USDC', nonce: 101, bids: [], asks: [] },
  ]), /has not overtaken/);

  assert.throws(() => synchronizeBitvavoBook(SNAPSHOT, [
    { event: 'book', market: 'BTC-USDC', nonce: 99, bids: [], asks: [] },
    { event: 'book', market: 'BTC-USDC', nonce: 102, bids: [], asks: [] },
  ]), /sequence gap/);
});

test('Bitvavo snapshot rejects malformed, zero-size or crossed books', () => {
  assert.throws(() => createBitvavoLocalBook({ ...SNAPSHOT, bids: [['100', '0']] }), /zero quantity|invalid/);
  assert.throws(() => createBitvavoLocalBook({ ...SNAPSHOT, asks: [['99', '1']] }), /crossed/);
  assert.throws(() => createBitvavoLocalBook({ ...SNAPSHOT, nonce: Number.NaN }), /nonce/);
});

test('nanosecond timestamps must retain integer precision before parsing', () => {
  const ns = '1752139200000000000';
  assert.equal(bitvavoTimestampNsToMs(ns), 1_752_139_200_000);
  assert.equal(createBitvavoLocalBook(SNAPSHOT).exchangeTimestampNs, ns);

  // A JS number at nanosecond epoch scale is already beyond safe integer precision.
  assert.throws(() => createBitvavoLocalBook({ ...SNAPSHOT, timestamp: 1_752_139_200_000_000_000 }), /timestamp/);
  assert.throws(() => bitvavoTimestampNsToMs('1.7521392e18'), /timestamp/);
});
