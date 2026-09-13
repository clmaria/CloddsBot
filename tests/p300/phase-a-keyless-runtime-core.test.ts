import assert from 'node:assert/strict';
import test from 'node:test';
import { PhaseAKeylessRuntimeCore } from '../../src/p300/phase-a-keyless-runtime-core';
import type { PhaseAReceiveStamp } from '../../src/p300/phase-a-public-feed-parsers';

const MS = 1_000_000n;
let clock = 1_000_000_000n;

function stamp(stepMs = 1): PhaseAReceiveStamp {
  clock += BigInt(stepMs) * MS;
  return { receivedMonoNs: clock.toString(), receivedAtMs: Number(clock / MS) };
}

function runtime(maxBufferedBookUpdates = 10): PhaseAKeylessRuntimeCore {
  clock = 1_000_000_000n;
  return new PhaseAKeylessRuntimeCore({
    sessionId: 'runtime-session-1',
    maxBufferedBookUpdates,
    collector: {
      maxHistoryPerStream: 50,
      maxReferenceAgeMs: 1_000,
      maxReferenceReceiveSkewMs: 500,
      maxReferenceDispersionBps: 100,
    },
  });
}

function bitvavoUpdate(nonce: number, bid = '98', ask = '99'): string {
  return JSON.stringify({
    event: 'book',
    market: 'BTC-USDC',
    nonce,
    bids: [[bid, '1.5']],
    asks: [[ask, '2']],
    timestamp: '1752139200123456789',
  });
}

function bitvavoSnapshot(requestId: number, nonce: number, bid = '98', ask = '99'): string {
  return JSON.stringify({
    action: 'getBook',
    requestId,
    response: {
      market: 'BTC-USDC',
      nonce,
      bids: [[bid, '1.5']],
      asks: [[ask, '2']],
      timestamp: '1752139200123456790',
    },
  });
}

function bitvavoTicker(bid = '98', ask = '99'): string {
  return JSON.stringify({
    event: 'ticker',
    market: 'BTC-USDC',
    bestBid: bid,
    bestBidSize: '1.5',
    bestAsk: ask,
    bestAskSize: '2',
    lastPrice: '98.5',
  });
}

function krakenTicker(bid = 99.9, ask = 100.1): string {
  return JSON.stringify({
    channel: 'ticker',
    type: 'update',
    data: [{
      symbol: 'BTC/USDC',
      bid,
      bid_qty: 1,
      ask,
      ask_qty: 1,
      timestamp: '2026-09-13T10:00:00.123456Z',
    }],
  });
}

function binanceTicker(updateId = 1, bid = '99.95', ask = '100.15'): string {
  return JSON.stringify({
    u: updateId,
    s: 'BTCUSDC',
    b: bid,
    B: '1',
    a: ask,
    A: '1',
  });
}

test('snapshot request is idempotent while one is pending', () => {
  const core = runtime();
  assert.deepEqual(core.ensureBitvavoSnapshotRequest(), [
    { kind: 'bitvavo_snapshot_request', requestId: 1, market: 'BTC-USDC' },
  ]);
  assert.deepEqual(core.ensureBitvavoSnapshotRequest(), []);
});

test('buffers book updates before snapshot and synchronizes only with matching response id', () => {
  const core = runtime();
  const first = core.ingestBitvavoRaw(bitvavoUpdate(10), stamp());
  assert.deepEqual(first, [{ kind: 'bitvavo_snapshot_request', requestId: 1, market: 'BTC-USDC' }]);
  assert.equal(core.bufferedBitvavoUpdates, 1);

  assert.deepEqual(core.ingestBitvavoRaw(bitvavoSnapshot(999, 11), stamp()), []);
  assert.equal(core.bitvavoSynchronized, false);

  const synced = core.ingestBitvavoRaw(bitvavoSnapshot(1, 11), stamp());
  assert.equal(synced[0].kind, 'bitvavo_book_synchronized');
  assert.equal(core.bitvavoSynchronized, true);
  assert.equal(core.bufferedBitvavoUpdates, 0);
  assert.equal(core.currentTargetAlignment.status, 'missing');
});

test('references plus aligned ticker/book produce a causal target snapshot', () => {
  const core = runtime();
  core.ensureBitvavoSnapshotRequest();
  core.ingestBitvavoRaw(bitvavoSnapshot(1, 11), stamp());
  core.ingestKrakenRaw(krakenTicker(), stamp());
  core.ingestBinanceRaw(binanceTicker(), stamp());

  const events = core.ingestBitvavoRaw(bitvavoTicker(), stamp());
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.kind, 'target_state');
  if (event.kind !== 'target_state') return;
  assert.equal(event.alignment.status, 'aligned');
  assert.equal(event.signalCandidate, true);
  assert.ok(event.snapshotResult);
  assert.equal(event.snapshotResult?.snapshot.ok, true);
  assert.equal(event.snapshotResult?.targetEvent.sourceObservedAtMs, undefined);
});

test('aligned book-only refresh can feed horizon state without becoming a new signal candidate', () => {
  const core = runtime();
  core.ensureBitvavoSnapshotRequest();
  core.ingestBitvavoRaw(bitvavoSnapshot(1, 11), stamp());
  core.ingestKrakenRaw(krakenTicker(), stamp());
  core.ingestBinanceRaw(binanceTicker(), stamp());
  core.ingestBitvavoRaw(bitvavoTicker(), stamp());

  const events = core.ingestBitvavoRaw(bitvavoUpdate(12), stamp());
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.kind, 'target_state');
  if (event.kind !== 'target_state') return;
  assert.equal(event.alignment.status, 'aligned');
  assert.equal(event.signalCandidate, false);
  assert.ok(event.snapshotResult);
});

test('nonce gap invalidates target book and requests a fresh snapshot without forging a target state', () => {
  const core = runtime();
  core.ensureBitvavoSnapshotRequest();
  core.ingestBitvavoRaw(bitvavoSnapshot(1, 11), stamp());
  core.ingestBitvavoRaw(bitvavoTicker(), stamp());

  const events = core.ingestBitvavoRaw(bitvavoUpdate(13), stamp());
  assert.equal(events.length, 2);
  assert.equal(events[0].kind, 'bitvavo_book_invalidated');
  assert.equal(events[1].kind, 'bitvavo_snapshot_request');
  assert.equal(core.bitvavoSynchronized, false);
  assert.equal(core.bufferedBitvavoUpdates, 1);
  assert.equal(core.currentTargetAlignment.status, 'missing');

  const request = events[1];
  if (request.kind !== 'bitvavo_snapshot_request') return;
  const resynced = core.ingestBitvavoRaw(bitvavoSnapshot(request.requestId, 14), stamp());
  assert.equal(resynced[0].kind, 'bitvavo_book_synchronized');
  assert.equal(core.bitvavoSynchronized, true);
});

test('stale snapshot response cannot replace a newer pending synchronization attempt', () => {
  const core = runtime();
  const [initial] = core.ensureBitvavoSnapshotRequest();
  assert.equal(initial.kind, 'bitvavo_snapshot_request');
  const invalidated = core.invalidateBitvavo('test resync', stamp());
  assert.equal(invalidated[0].kind, 'bitvavo_book_invalidated');
  assert.equal(invalidated[1].kind, 'bitvavo_snapshot_request');
  const pending = core.ensureBitvavoSnapshotRequest();
  assert.deepEqual(pending, []);

  const ignored = core.ingestBitvavoRaw(bitvavoSnapshot(1, 10), stamp());
  assert.deepEqual(ignored, []);
  assert.equal(core.bitvavoSynchronized, false);
});

test('reference subscription acknowledgements and unrelated messages do not create market state', () => {
  const core = runtime();
  assert.deepEqual(core.ingestBinanceRaw('{"result":null,"id":1}', stamp()), []);
  assert.deepEqual(core.ingestKrakenRaw('{"method":"subscribe","success":true}', stamp()), []);
});

test('runtime monotonic clock regression fails closed across venues', () => {
  const core = runtime();
  const later = stamp(10);
  core.ingestBinanceRaw(binanceTicker(), later);
  const earlier: PhaseAReceiveStamp = {
    receivedMonoNs: (BigInt(later.receivedMonoNs) - 1n).toString(),
    receivedAtMs: later.receivedAtMs,
  };
  assert.throws(() => core.ingestKrakenRaw(krakenTicker(), earlier), /clock regressed/);
});

test('session reset clears target, references, sync and monotonic history', () => {
  const core = runtime();
  core.ensureBitvavoSnapshotRequest();
  core.ingestBitvavoRaw(bitvavoSnapshot(1, 11), stamp());
  core.ingestKrakenRaw(krakenTicker(), stamp());
  core.resetSession('runtime-session-2');

  assert.equal(core.sessionId, 'runtime-session-2');
  assert.equal(core.bitvavoSynchronized, false);
  assert.equal(core.currentTargetAlignment.status, 'missing');
  assert.deepEqual(core.ensureBitvavoSnapshotRequest(), [
    { kind: 'bitvavo_snapshot_request', requestId: 1, market: 'BTC-USDC' },
  ]);
});

test('pre-snapshot buffer bound fails closed instead of growing without limit', () => {
  const core = runtime(1);
  core.ingestBitvavoRaw(bitvavoUpdate(10), stamp());
  assert.throws(
    () => core.ingestBitvavoRaw(bitvavoUpdate(11), stamp()),
    /buffer limit exceeded/,
  );
  assert.equal(core.bitvavoSynchronized, false);
  assert.equal(core.currentTargetAlignment.status, 'missing');
});
