import assert from 'node:assert/strict';
import test from 'node:test';
import { PhaseACollectorCore } from '../../src/p300/phase-a-collector-core';
import { PhaseAPublicMarketIngress } from '../../src/p300/phase-a-public-market-ingress';
import type { PhaseAReceiveStamp } from '../../src/p300/phase-a-public-feed-parsers';

function stamp(mono: number): PhaseAReceiveStamp {
  return { receivedMonoNs: String(mono), receivedAtMs: 1_789_000_000_000 + mono };
}

function collector(sessionId = 'public-ingress-test'): PhaseACollectorCore {
  return new PhaseACollectorCore({
    sessionId,
    maxHistoryPerStream: 100,
    maxReferenceAgeMs: 1_000,
    maxReferenceReceiveSkewMs: 1_000,
    maxReferenceDispersionBps: 100,
  });
}

function krakenRaw(bid = 99, ask = 101): string {
  return JSON.stringify({
    channel: 'ticker',
    type: 'update',
    data: [{
      symbol: 'BTC/USDC',
      bid,
      ask,
      timestamp: '2026-09-13T14:00:00.000000Z',
    }],
  });
}

function binanceRaw(bid = 99, ask = 101, updateId = 1): string {
  return JSON.stringify({ u: updateId, s: 'BTCUSDC', b: String(bid), a: String(ask) });
}

function bitvavoUpdateRaw(
  nonce: number,
  bids: string[][] = [],
  asks: string[][] = [],
): string {
  return JSON.stringify({
    event: 'book',
    market: 'BTC-USDC',
    nonce,
    bids,
    asks,
    timestamp: 1_752_139_200_000_000_000,
  });
}

function bitvavoSnapshotRaw(
  nonce: number,
  bids: string[][] = [['100', '2']],
  asks: string[][] = [['101', '1']],
): string {
  // Keep the nanosecond integer literal unquoted so the production parser is
  // forced to protect it before JSON.parse.
  return `{"action":"getBook","requestId":7,"response":{"market":"BTC-USDC","nonce":${nonce},"bids":${JSON.stringify(bids)},"asks":${JSON.stringify(asks)},"timestamp":1752139200000000000}}`;
}

function bitvavoTickerRaw(
  bid = 100,
  bidSize = 1.5,
  ask = 101,
  askSize = 0.5,
): string {
  return JSON.stringify({
    event: 'ticker',
    market: 'BTC-USDC',
    bestBid: String(bid),
    bestBidSize: String(bidSize),
    bestAsk: String(ask),
    bestAskSize: String(askSize),
    lastPrice: '100.5',
  });
}

test('public ingress composes buffered Bitvavo sync, ticker agreement and the single collector without backdating', () => {
  const core = collector();
  const ingress = new PhaseAPublicMarketIngress(core, { maxBufferedBitvavoUpdates: 10 });

  assert.equal(ingress.ingestKrakenRaw(krakenRaw(), stamp(100)).kind, 'reference');
  assert.equal(ingress.ingestBinanceRaw(binanceRaw(), stamp(101)).kind, 'reference');

  assert.deepEqual(ingress.ingestBitvavoBookRaw(bitvavoUpdateRaw(99), stamp(102)), {
    kind: 'bitvavo_book_buffered', bufferedUpdates: 1, needsSnapshot: true,
  });
  ingress.ingestBitvavoBookRaw(bitvavoUpdateRaw(101, [['100', '1.5']]), stamp(103));
  ingress.ingestBitvavoBookRaw(bitvavoUpdateRaw(102, [], [['101', '0.5']]), stamp(104));

  const ticker = ingress.ingestBitvavoTickerRaw(bitvavoTickerRaw(), stamp(105));
  assert.equal(ticker.kind, 'bitvavo_ticker');
  if (ticker.kind === 'bitvavo_ticker') assert.equal(ticker.target, undefined);

  const synced = ingress.ingestBitvavoBookRaw(bitvavoSnapshotRaw(100), stamp(106));
  assert.equal(synced.kind, 'bitvavo_book_ready');
  if (synced.kind !== 'bitvavo_book_ready') return;

  assert.equal(synced.bookNonce, 102);
  assert.ok(synced.target);
  assert.equal(synced.target.targetEvent.receivedMonoNs, '106');
  assert.equal(synced.target.actionable.bookReceivedMonoNs, '106');
  assert.equal(synced.target.actionable.tickerReceivedMonoNs, '105');
  assert.equal(synced.target.actionable.bookNonce, 102);
  assert.equal(synced.target.snapshot.ok, true);
  assert.equal(ingress.bitvavoBookSynchronized, true);
  assert.equal(ingress.bufferedBitvavoUpdateCount, 0);
});

test('sequence gap invalidates the local target state and forces a fresh overtaking snapshot', () => {
  const ingress = new PhaseAPublicMarketIngress(collector(), { maxBufferedBitvavoUpdates: 10 });

  const initial = ingress.ingestBitvavoBookRaw(bitvavoSnapshotRaw(100), stamp(100));
  assert.equal(initial.kind, 'bitvavo_book_ready');
  assert.equal(ingress.bitvavoBookSynchronized, true);

  const gap = ingress.ingestBitvavoBookRaw(bitvavoUpdateRaw(102), stamp(101));
  assert.equal(gap.kind, 'bitvavo_book_resync_required');
  if (gap.kind === 'bitvavo_book_resync_required') {
    assert.match(gap.reason, /expected Bitvavo nonce 101, received 102/);
    assert.equal(gap.needsSnapshot, true);
  }
  assert.equal(ingress.bitvavoBookSynchronized, false);
  assert.equal(ingress.bufferedBitvavoUpdateCount, 1);

  const rejected = ingress.ingestBitvavoBookRaw(bitvavoSnapshotRaw(102), stamp(102));
  assert.equal(rejected.kind, 'bitvavo_snapshot_rejected');
  if (rejected.kind === 'bitvavo_snapshot_rejected') {
    assert.match(rejected.reason, /has not overtaken/);
    assert.equal(rejected.bufferedUpdates, 1);
  }

  const recovered = ingress.ingestBitvavoBookRaw(bitvavoSnapshotRaw(103), stamp(103));
  assert.equal(recovered.kind, 'bitvavo_book_ready');
  assert.equal(ingress.bitvavoBookSynchronized, true);
  assert.equal(ingress.bufferedBitvavoUpdateCount, 0);
});

test('non-sequence book corruption invalidates state and surfaces the error', () => {
  const ingress = new PhaseAPublicMarketIngress(collector(), { maxBufferedBitvavoUpdates: 10 });
  ingress.ingestBitvavoBookRaw(bitvavoSnapshotRaw(100), stamp(100));

  assert.throws(
    () => ingress.ingestBitvavoBookRaw(bitvavoUpdateRaw(101, [['102', '1']]), stamp(101)),
    /crossed/,
  );
  assert.equal(ingress.bitvavoBookSynchronized, false);
  assert.equal(ingress.bufferedBitvavoUpdateCount, 0);
});

test('pre-snapshot buffering is bounded and fails closed instead of growing without limit', () => {
  const ingress = new PhaseAPublicMarketIngress(collector(), { maxBufferedBitvavoUpdates: 1 });
  ingress.ingestBitvavoBookRaw(bitvavoUpdateRaw(1), stamp(100));

  assert.throws(
    () => ingress.ingestBitvavoBookRaw(bitvavoUpdateRaw(2), stamp(101)),
    /buffer exceeded configured bound/,
  );
  assert.equal(ingress.bitvavoBookSynchronized, false);
  assert.equal(ingress.bufferedBitvavoUpdateCount, 0);
});

test('all public feed callbacks share one non-regressing monotonic receive domain', () => {
  const ingress = new PhaseAPublicMarketIngress(collector(), { maxBufferedBitvavoUpdates: 10 });
  assert.equal(ingress.ingestBinanceRaw('{"result":null,"id":1}', stamp(100)).kind, 'ignored');

  assert.throws(
    () => ingress.ingestKrakenRaw(krakenRaw(), stamp(99)),
    /receive clock regressed/,
  );
});

test('new clock domain resets the collector, target alignment and local book together', () => {
  const core = collector('session-a');
  const ingress = new PhaseAPublicMarketIngress(core, { maxBufferedBitvavoUpdates: 10 });
  ingress.ingestBitvavoBookRaw(bitvavoSnapshotRaw(100), stamp(100));
  assert.equal(ingress.bitvavoBookSynchronized, true);

  ingress.resetForNewClockDomain('session-b');
  assert.equal(ingress.sessionId, 'session-b');
  assert.equal(core.sessionId, 'session-b');
  assert.equal(ingress.bitvavoBookSynchronized, false);
  assert.equal(ingress.bufferedBitvavoUpdateCount, 0);

  // A lower monotonic value is valid only after the explicit clock-domain reset.
  assert.equal(ingress.ingestBinanceRaw('{"result":null,"id":2}', stamp(1)).kind, 'ignored');
});
