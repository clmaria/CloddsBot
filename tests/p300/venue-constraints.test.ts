import assert from 'node:assert/strict';
import test from 'node:test';
import {
  marketConstraintsFromBinance,
  marketConstraintsFromBitvavo,
  marketConstraintsFromKraken,
} from '../../src/p300/venue-constraints';

test('Binance parser maps LOT_SIZE and MIN_NOTIONAL into P300 constraints', () => {
  const result = marketConstraintsFromBinance({
    symbol: 'BTCEUR',
    filters: [
      { filterType: 'LOT_SIZE', minQty: '0.00000100', stepSize: '0.00000100' },
      { filterType: 'MIN_NOTIONAL', minNotional: '5.00000000' },
    ],
  }, 70_000);

  assert.equal(result.symbol, 'BTCEUR');
  assert.equal(result.minBaseQty, 0.000001);
  assert.equal(result.stepSize, 0.000001);
  assert.equal(result.minQuoteNotional, 5);
});

test('Binance parser supports NOTIONAL minNotional fallback', () => {
  const result = marketConstraintsFromBinance({
    symbol: 'ETHEUR',
    filters: [
      { filterType: 'LOT_SIZE', minQty: '0.00010000', stepSize: '0.00010000' },
      { filterType: 'NOTIONAL', minNotional: '6.00000000' },
    ],
  }, 3_000);

  assert.equal(result.minQuoteNotional, 6);
});

test('Kraken parser maps ordermin, costmin and lot precision', () => {
  const result = marketConstraintsFromKraken({
    wsname: 'XBT/EUR',
    ordermin: '0.0001',
    costmin: '0.45',
    lot_decimals: 8,
  }, 70_000);

  assert.equal(result.symbol, 'XBT/EUR');
  assert.equal(result.minBaseQty, 0.0001);
  assert.equal(result.minQuoteNotional, 0.45);
  assert.equal(result.stepSize, 1e-8);
});

test('Bitvavo parser maps market minima and quantity precision', () => {
  const result = marketConstraintsFromBitvavo({
    market: 'BTC-EUR',
    status: 'trading',
    base: 'BTC',
    quote: 'EUR',
    minOrderInBaseAsset: '0.0001',
    minOrderInQuoteAsset: '5',
    quantityDecimals: '4',
    tickSize: '0.01',
    orderTypes: ['market', 'limit'],
  }, 70_000);

  assert.equal(result.symbol, 'BTC-EUR');
  assert.equal(result.minBaseQty, 0.0001);
  assert.equal(result.minQuoteNotional, 5);
  assert.equal(result.stepSize, 0.0001);
});

test('Bitvavo parser rejects markets that are not in trading state', () => {
  assert.throws(() => marketConstraintsFromBitvavo({
    market: 'BTC-EUR',
    status: 'halted',
    minOrderInBaseAsset: '0.0001',
    minOrderInQuoteAsset: '5',
    quantityDecimals: '4',
  }, 70_000));
});

test('venue parsers fail closed on malformed numeric constraints', () => {
  assert.throws(() => marketConstraintsFromBinance({
    symbol: 'BTCEUR',
    filters: [{ filterType: 'LOT_SIZE', minQty: 'not-a-number', stepSize: '0.000001' }],
  }, 70_000));

  assert.throws(() => marketConstraintsFromKraken({
    wsname: 'XBT/EUR',
    ordermin: 'bad',
  }, 70_000));

  assert.throws(() => marketConstraintsFromBitvavo({
    market: 'BTC-EUR',
    status: 'trading',
    minOrderInBaseAsset: 'bad',
  }, 70_000));
});
