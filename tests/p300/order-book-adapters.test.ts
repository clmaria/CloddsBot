import assert from 'node:assert/strict';
import test from 'node:test';
import {
  orderBookFromBitvavo,
  orderBookFromKraken,
  orderBookFromOkx,
} from '../../src/p300/order-book-adapters';

test('Bitvavo order-book adapter normalizes price and quantity strings', () => {
  const book = orderBookFromBitvavo({
    market: 'BTC-EUR',
    bids: [['55000.1', '0.10'], ['54999.9', '0.20']],
    asks: [['55000.2', '0.11'], ['55000.4', '0.21']],
  });
  assert.deepEqual(book.bids[0], { price: 55000.1, baseQty: 0.1 });
  assert.deepEqual(book.asks[0], { price: 55000.2, baseQty: 0.11 });
});

test('Kraken order-book adapter accepts timestamp-bearing levels and rejects API errors', () => {
  const book = orderBookFromKraken({
    error: [],
    result: {
      XXBTZEUR: {
        bids: [['55000.1', '0.10', 123456]],
        asks: [['55000.2', '0.11', 123457]],
      },
    },
  });
  assert.equal(book.bids[0].price, 55000.1);
  assert.throws(() => orderBookFromKraken({ error: ['EGeneral:Invalid arguments'], result: {} }));
});

test('OKX order-book adapter accepts four-field depth levels', () => {
  const book = orderBookFromOkx({
    code: '0',
    msg: '',
    data: [{
      bids: [['55000.1', '0.10', '0', '2']],
      asks: [['55000.2', '0.11', '0', '3']],
    }],
  });
  assert.deepEqual(book.bids[0], { price: 55000.1, baseQty: 0.1 });
  assert.deepEqual(book.asks[0], { price: 55000.2, baseQty: 0.11 });
});

test('order-book adapters fail closed on empty or malformed depth', () => {
  assert.throws(() => orderBookFromBitvavo({ bids: [], asks: [['1', '1']] }));
  assert.throws(() => orderBookFromKraken({ error: [], result: {} }));
  assert.throws(() => orderBookFromOkx({ code: '51000', msg: 'invalid instrument', data: [] }));
  assert.throws(() => orderBookFromOkx({ code: '0', data: [{ bids: [['bad', '1']], asks: [['2', '1']] }] }));
});
