import assert from 'node:assert/strict';
import test from 'node:test';
import * as publicFeedParsers from '../../src/p300/phase-a-public-feed-parsers';
import {
  parseBinanceBookTickerRaw,
  parseBitvavoBookRaw,
  parseKrakenTickerV2Raw,
  type PhaseAReceiveStamp,
} from '../../src/p300/phase-a-public-feed-parsers';

const STAMP: PhaseAReceiveStamp = {
  receivedMonoNs: '1234567890123456789',
  receivedAtMs: 1_789_000_000_000,
};

test('Binance bookTicker preserves int64 update id and uses local receive time for causality', () => {
  const parsed = parseBinanceBookTickerRaw(
    '{"u":9007199254740993123,"s":"BTCUSDC","b":"78200.10","B":"1.5","a":"78200.20","A":"2.0"}',
    STAMP,
  );
  assert.ok(parsed);
  assert.equal(parsed.venue, 'binance');
  assert.equal(parsed.symbol, 'BTCUSDC');
  assert.equal(parsed.bid, 78200.10);
  assert.equal(parsed.ask, 78200.20);
  assert.equal(parsed.sourceSequence, '9007199254740993123');
  assert.equal(parsed.receivedMonoNs, STAMP.receivedMonoNs);
  assert.equal(parsed.receivedAtMs, STAMP.receivedAtMs);
  assert.equal(parsed.sourceObservedAtMs, undefined);
});

test('Binance parser supports combined wrapper and ignores subscription acknowledgements', () => {
  const parsed = parseBinanceBookTickerRaw(
    '{"stream":"btcusdc@bookTicker","data":{"u":42,"s":"BTCUSDC","b":"100","B":"1","a":"101","A":"1"}}',
    STAMP,
  );
  assert.ok(parsed);
  assert.equal(parsed.sourceSequence, '42');
  assert.equal(parseBinanceBookTickerRaw('{"result":null,"id":1}', STAMP), null);
});

test('Binance parser fails closed on wrong symbol, crossed book and malformed JSON', () => {
  assert.throws(
    () => parseBinanceBookTickerRaw('{"u":1,"s":"ETHUSDC","b":"100","a":"101"}', STAMP),
    /unexpected Binance symbol/,
  );
  assert.throws(
    () => parseBinanceBookTickerRaw('{"u":1,"s":"BTCUSDC","b":"102","a":"101"}', STAMP),
    /crossed/,
  );
  assert.throws(() => parseBinanceBookTickerRaw('{bad', STAMP), /invalid JSON/);
});

test('Kraken v2 ticker bbo parser maps top of book and keeps exchange time provenance-only', () => {
  const parsed = parseKrakenTickerV2Raw(JSON.stringify({
    channel: 'ticker',
    type: 'update',
    data: [{
      symbol: 'BTC/USDC',
      bid: 78199.9,
      bid_qty: 1.2,
      ask: 78200.1,
      ask_qty: 0.8,
      timestamp: '2026-09-13T09:30:59.123456Z',
    }],
  }), STAMP);
  assert.ok(parsed);
  assert.equal(parsed.venue, 'kraken');
  assert.equal(parsed.bid, 78199.9);
  assert.equal(parsed.ask, 78200.1);
  assert.equal(parsed.receivedMonoNs, STAMP.receivedMonoNs);
  assert.equal(parsed.sourceObservedAtMs, Date.parse('2026-09-13T09:30:59.123456Z'));
});

test('Kraken parser ignores non-ticker messages and fails closed on invalid ticker payloads', () => {
  assert.equal(parseKrakenTickerV2Raw('{"channel":"heartbeat"}', STAMP), null);
  assert.equal(parseKrakenTickerV2Raw('{"method":"subscribe","success":true}', STAMP), null);
  assert.throws(() => parseKrakenTickerV2Raw(JSON.stringify({
    channel: 'ticker', type: 'update', data: [{ symbol: 'ETH/USDC', bid: 1, ask: 2, timestamp: '2026-09-13T09:30:59Z' }],
  }), STAMP), /unexpected Kraken symbol/);
  assert.throws(() => parseKrakenTickerV2Raw(JSON.stringify({
    channel: 'ticker', type: 'update', data: [{ symbol: 'BTC/USDC', bid: 3, ask: 2, timestamp: '2026-09-13T09:30:59Z' }],
  }), STAMP), /crossed/);
  assert.throws(() => parseKrakenTickerV2Raw(JSON.stringify({
    channel: 'ticker', type: 'update', data: [{ symbol: 'BTC/USDC', bid: 1, ask: 2, timestamp: 'not-a-time' }],
  }), STAMP), /timestamp is invalid/);
});

test('Bitvavo update parser preserves nanosecond timestamp exactly before JSON.parse', () => {
  const timestamp = '1752139200123456789';
  const parsed = parseBitvavoBookRaw(
    `{"event":"book","market":"BTC-USDC","nonce":438524,"bids":[["78200.1","0.1"]],"asks":[["78200.2","0.2"]],"timestamp":${timestamp}}`,
    STAMP,
  );
  assert.ok(parsed);
  assert.equal(parsed.kind, 'update');
  if (parsed.kind !== 'update') return;
  assert.equal(parsed.update.timestamp, timestamp);
  assert.equal(parsed.update.nonce, 438524);
  assert.equal(parsed.stamp, STAMP);
});

test('Bitvavo getBook parser preserves nested nanosecond timestamp and request identity', () => {
  const timestamp = '1752139200999999999';
  const parsed = parseBitvavoBookRaw(
    `{"action":"getBook","requestId":7,"response":{"market":"BTC-USDC","nonce":438525,"bids":[["78200","1"]],"asks":[["78201","2"]],"timestamp":${timestamp}}}`,
    STAMP,
  );
  assert.ok(parsed);
  assert.equal(parsed.kind, 'snapshot');
  if (parsed.kind !== 'snapshot') return;
  assert.equal(parsed.snapshot.timestamp, timestamp);
  assert.equal(parsed.requestId, 7);
});

test('Bitvavo parser ignores subscription confirmations and rejects other markets', () => {
  assert.equal(parseBitvavoBookRaw(
    '{"event":"book","subscriptions":{"book":["BTC-USDC"]}}',
    STAMP,
  ), null);
  assert.throws(() => parseBitvavoBookRaw(
    '{"event":"book","market":"ETH-USDC","nonce":1,"bids":[],"asks":[]}',
    STAMP,
  ), /unexpected Bitvavo market/);
});

test('public feed parser surface cannot bypass ticker/book target coordination', () => {
  assert.equal('bitvavoLocalBookToCausalInput' in publicFeedParsers, false);
});

test('receive stamp is validated independently from exchange timestamps', () => {
  assert.throws(() => parseBinanceBookTickerRaw(
    '{"u":1,"s":"BTCUSDC","b":"1","a":"2"}',
    { ...STAMP, receivedMonoNs: '1.5' },
  ), /receivedMonoNs/);
  assert.throws(() => parseKrakenTickerV2Raw(JSON.stringify({
    channel: 'ticker', type: 'snapshot', data: [{ symbol: 'BTC/USDC', bid: 1, ask: 2, timestamp: '2026-09-13T09:30:59Z' }],
  }), { ...STAMP, receivedAtMs: Number.NaN }), /receivedAtMs/);
});
