import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CausalMarketBuffer,
  type CausalMarketBufferConfig,
  type CausalMarketEventInput,
} from '../../src/p300/causal-market-buffer';

const TARGET = { venue: 'bitvavo', symbol: 'BTC-USDC' };
const KRAKEN = { venue: 'kraken', symbol: 'BTC/USDC' };
const BINANCE = { venue: 'binance', symbol: 'BTCUSDC' };

function config(overrides: Partial<CausalMarketBufferConfig> = {}): CausalMarketBufferConfig {
  return {
    sessionId: 'phase-a-session-1',
    target: TARGET,
    references: [KRAKEN, BINANCE],
    maxHistoryPerStream: 3,
    maxReferenceAgeMs: 1_000,
    maxReferenceReceiveSkewMs: 500,
    maxReferenceDispersionBps: 100,
    ...overrides,
  };
}

function event(
  stream: { venue: string; symbol: string },
  receivedMonoNs: bigint,
  bid = 99,
  ask = 101,
  overrides: Partial<CausalMarketEventInput> = {},
): CausalMarketEventInput {
  return {
    ...stream,
    bid,
    ask,
    receivedMonoNs: receivedMonoNs.toString(),
    receivedAtMs: Number(receivedMonoNs / 1_000_000n),
    ...overrides,
  };
}

test('historical target only sees references already ingested at its causal cutoff', () => {
  const buffer = new CausalMarketBuffer(config());
  buffer.ingest(event(KRAKEN, 100n));
  buffer.ingest(event(BINANCE, 150n));
  const target = buffer.ingest(event(TARGET, 200n, 98, 100));

  const beforeLateArrival = buffer.snapshotForTarget(target);
  assert.equal(beforeLateArrival.ok, true);
  if (!beforeLateArrival.ok) return;
  assert.deepEqual(beforeLateArrival.references.map((ref) => ref.ingestSeq), [1, 2]);

  buffer.ingest(event(KRAKEN, 201n, 110, 112));
  const afterLateArrival = buffer.snapshotForTarget(target);
  assert.equal(afterLateArrival.ok, true);
  if (!afterLateArrival.ok) return;
  assert.deepEqual(afterLateArrival.references.map((ref) => ref.ingestSeq), [1, 2]);
  assert.equal(afterLateArrival.referenceMid, beforeLateArrival.referenceMid);
});

test('equal monotonic timestamps are ordered by ingest sequence and cannot backfill a target', () => {
  const buffer = new CausalMarketBuffer(config());
  buffer.ingest(event(KRAKEN, 100n));
  const target = buffer.ingest(event(TARGET, 200n, 98, 100));
  buffer.ingest(event(BINANCE, 200n));

  const snapshot = buffer.snapshotForTarget(target);
  assert.equal(snapshot.ok, false);
  if (snapshot.ok) return;
  assert.deepEqual(snapshot.failures.map((failure) => failure.code), ['MISSING_REFERENCE']);
  assert.deepEqual(snapshot.failures[0].stream, BINANCE);
});

test('wall-clock jumps and absurd source timestamps are provenance-only', () => {
  const buffer = new CausalMarketBuffer(config());
  buffer.ingest(event(KRAKEN, 100n, 99, 101, { receivedAtMs: 9_000_000, sourceObservedAtMs: 9e15 }));
  buffer.ingest(event(BINANCE, 150n, 99, 101, { receivedAtMs: -5_000, sourceObservedAtMs: -9e15 }));
  const target = buffer.ingest(event(TARGET, 200n, 98, 100, { receivedAtMs: 1 }));

  const snapshot = buffer.snapshotForTarget(target);
  assert.equal(snapshot.ok, true);
});

test('source timestamps may arrive out of order while monotonic receive order remains causal', () => {
  const buffer = new CausalMarketBuffer(config());
  buffer.ingest(event(KRAKEN, 100n, 99, 101, { sourceObservedAtMs: 5_000 }));
  buffer.ingest(event(BINANCE, 150n, 99, 101, { sourceObservedAtMs: 1_000 }));
  const target = buffer.ingest(event(TARGET, 200n, 98, 100, { sourceObservedAtMs: 500 }));
  assert.equal(buffer.snapshotForTarget(target).ok, true);
});

test('missing and stale references fail closed', () => {
  const missing = new CausalMarketBuffer(config());
  missing.ingest(event(KRAKEN, 100n));
  const missingTarget = missing.ingest(event(TARGET, 200n));
  const missingSnapshot = missing.snapshotForTarget(missingTarget);
  assert.equal(missingSnapshot.ok, false);
  if (!missingSnapshot.ok) assert.ok(missingSnapshot.failures.some((failure) => failure.code === 'MISSING_REFERENCE'));

  const stale = new CausalMarketBuffer(config({ maxReferenceAgeMs: 0 }));
  stale.ingest(event(KRAKEN, 100n));
  stale.ingest(event(BINANCE, 100n));
  const staleTarget = stale.ingest(event(TARGET, 101n));
  const staleSnapshot = stale.snapshotForTarget(staleTarget);
  assert.equal(staleSnapshot.ok, false);
  if (!staleSnapshot.ok) assert.equal(staleSnapshot.failures.filter((failure) => failure.code === 'STALE_REFERENCE').length, 2);
});

test('invalid or crossed market tops and monotonic regression are rejected', () => {
  const buffer = new CausalMarketBuffer(config());
  assert.throws(() => buffer.ingest(event(KRAKEN, 100n, 102, 101)), /crossed/);
  assert.throws(() => buffer.ingest(event(KRAKEN, 100n, 0, 101)), /bid/);
  buffer.ingest(event(KRAKEN, 200n));
  assert.throws(() => buffer.ingest(event(BINANCE, 199n)), /regressed/);
});

test('reference receive skew and price dispersion fail closed independently', () => {
  const skewed = new CausalMarketBuffer(config({ maxReferenceReceiveSkewMs: 0 }));
  skewed.ingest(event(KRAKEN, 100n, 99, 101));
  skewed.ingest(event(BINANCE, 101n, 99, 101));
  const skewTarget = skewed.ingest(event(TARGET, 102n));
  const skewSnapshot = skewed.snapshotForTarget(skewTarget);
  assert.equal(skewSnapshot.ok, false);
  if (!skewSnapshot.ok) assert.ok(skewSnapshot.failures.some((failure) => failure.code === 'REFERENCE_RECEIVE_SKEW_EXCEEDED'));

  const dispersed = new CausalMarketBuffer(config({ maxReferenceDispersionBps: 10 }));
  dispersed.ingest(event(KRAKEN, 100n, 99, 101));
  dispersed.ingest(event(BINANCE, 100n, 109, 111));
  const dispersedTarget = dispersed.ingest(event(TARGET, 101n));
  const dispersedSnapshot = dispersed.snapshotForTarget(dispersedTarget);
  assert.equal(dispersedSnapshot.ok, false);
  if (!dispersedSnapshot.ok) assert.ok(dispersedSnapshot.failures.some((failure) => failure.code === 'REFERENCE_DISPERSION_EXCEEDED'));
});

test('session reset isolates clock domains and clears old observations', () => {
  const buffer = new CausalMarketBuffer(config());
  buffer.ingest(event(KRAKEN, 1_000n));
  buffer.ingest(event(BINANCE, 1_000n));
  const oldTarget = buffer.ingest(event(TARGET, 1_001n));

  buffer.resetSession('phase-a-session-2');
  assert.equal(buffer.ingestSeq, 0);
  assert.equal(buffer.historySize(KRAKEN), 0);
  assert.throws(() => buffer.snapshotForTarget(oldTarget), /different clock session/);

  buffer.ingest(event(KRAKEN, 10n));
  buffer.ingest(event(BINANCE, 10n));
  const newTarget = buffer.ingest(event(TARGET, 11n));
  assert.equal(buffer.snapshotForTarget(newTarget).ok, true);
});

test('per-stream history is bounded without changing causal ordering semantics', () => {
  const buffer = new CausalMarketBuffer(config({ maxHistoryPerStream: 2 }));
  buffer.ingest(event(KRAKEN, 100n));
  buffer.ingest(event(KRAKEN, 101n));
  buffer.ingest(event(KRAKEN, 102n));
  assert.equal(buffer.historySize(KRAKEN), 2);

  buffer.ingest(event(BINANCE, 102n));
  const target = buffer.ingest(event(TARGET, 103n));
  const snapshot = buffer.snapshotForTarget(target);
  assert.equal(snapshot.ok, true);
  if (snapshot.ok) assert.equal(snapshot.references[0].receivedMonoNs, '102');
});
