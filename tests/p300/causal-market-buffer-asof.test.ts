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
    sessionId: 'phase-a-session-asof',
    target: TARGET,
    references: [KRAKEN, BINANCE],
    maxHistoryPerStream: 20,
    maxReferenceAgeMs: 1_000,
    maxReferenceReceiveSkewMs: 500,
    maxReferenceDispersionBps: 1_000,
    ...overrides,
  };
}

function event(
  stream: { venue: string; symbol: string },
  receivedMonoNs: bigint,
  bid: number,
  ask: number,
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

test('as-of horizon uses reference updates known after the last target but before the cutoff', () => {
  const buffer = new CausalMarketBuffer(config());
  buffer.ingest(event(KRAKEN, 100n, 99, 101));
  buffer.ingest(event(BINANCE, 100n, 99, 101));
  const target = buffer.ingest(event(TARGET, 110n, 98, 100));

  const start = buffer.snapshotForTarget(target);
  assert.equal(start.ok, true);
  if (!start.ok) return;
  assert.equal(start.referenceMid, 100);

  buffer.ingest(event(KRAKEN, 120n, 101, 103));
  buffer.ingest(event(BINANCE, 125n, 103, 105));

  const horizon = buffer.snapshotAsOf('130');
  assert.equal(horizon.cutoffMonoNs, '130');
  assert.equal(horizon.snapshot.ok, true);
  if (!horizon.snapshot.ok) return;
  assert.equal(horizon.snapshot.target.ingestSeq, target.ingestSeq);
  assert.deepEqual(horizon.snapshot.references.map((reference) => reference.receivedMonoNs), ['120', '125']);
  assert.equal(horizon.snapshot.referenceMid, 103);
});

test('as-of horizon excludes events received after the cutoff even when queried later', () => {
  const buffer = new CausalMarketBuffer(config());
  buffer.ingest(event(KRAKEN, 100n, 99, 101));
  buffer.ingest(event(BINANCE, 100n, 99, 101));
  buffer.ingest(event(TARGET, 110n, 98, 100));
  buffer.ingest(event(KRAKEN, 150n, 119, 121));
  buffer.ingest(event(BINANCE, 150n, 119, 121));
  buffer.ingest(event(TARGET, 150n, 119, 121));

  const horizon = buffer.snapshotAsOf('120');
  assert.equal(horizon.snapshot.ok, true);
  if (!horizon.snapshot.ok) return;
  assert.equal(horizon.snapshot.target.receivedMonoNs, '110');
  assert.deepEqual(horizon.snapshot.references.map((reference) => reference.receivedMonoNs), ['100', '100']);
  assert.equal(horizon.snapshot.referenceMid, 100);
});

test('a sealed as-of result cannot be backfilled by a later equal-clock arrival', () => {
  const buffer = new CausalMarketBuffer(config());
  buffer.ingest(event(KRAKEN, 100n, 99, 101));
  buffer.ingest(event(BINANCE, 100n, 99, 101));
  buffer.ingest(event(TARGET, 110n, 98, 100));

  const sealed = buffer.snapshotAsOf('120');
  assert.equal(sealed.snapshot.ok, true);
  if (!sealed.snapshot.ok) return;
  const sealedReferenceSeqs = sealed.snapshot.references.map((reference) => reference.ingestSeq);
  const sealedBoundary = sealed.cutoffIngestSeq;

  buffer.ingest(event(KRAKEN, 120n, 109, 111));
  const later = buffer.snapshotAsOf('120');
  assert.equal(later.snapshot.ok, true);
  if (!later.snapshot.ok) return;

  assert.deepEqual(sealed.snapshot.references.map((reference) => reference.ingestSeq), sealedReferenceSeqs);
  assert.equal(sealed.cutoffIngestSeq, sealedBoundary);
  assert.ok(later.cutoffIngestSeq > sealedBoundary);
  assert.notDeepEqual(later.snapshot.references.map((reference) => reference.ingestSeq), sealedReferenceSeqs);
});

test('as-of horizon fails closed when no target exists by the cutoff', () => {
  const buffer = new CausalMarketBuffer(config());
  buffer.ingest(event(KRAKEN, 100n, 99, 101));
  buffer.ingest(event(BINANCE, 100n, 99, 101));
  assert.throws(() => buffer.snapshotAsOf('100'), /no target state exists/);
});

test('reference freshness is evaluated at the horizon cutoff, not the older target time', () => {
  const buffer = new CausalMarketBuffer(config({ maxReferenceAgeMs: 0 }));
  buffer.ingest(event(KRAKEN, 100n, 99, 101));
  buffer.ingest(event(BINANCE, 100n, 99, 101));
  const target = buffer.ingest(event(TARGET, 100n, 98, 100));
  assert.equal(buffer.snapshotForTarget(target).ok, true);

  const horizon = buffer.snapshotAsOf('101');
  assert.equal(horizon.snapshot.ok, false);
  if (horizon.snapshot.ok) return;
  assert.equal(horizon.snapshot.failures.filter((failure) => failure.code === 'STALE_REFERENCE').length, 2);
});

test('wall and exchange timestamps remain provenance-only in as-of selection', () => {
  const buffer = new CausalMarketBuffer(config());
  buffer.ingest(event(KRAKEN, 100n, 99, 101, { receivedAtMs: 9e12, sourceObservedAtMs: 9e15 }));
  buffer.ingest(event(BINANCE, 100n, 99, 101, { receivedAtMs: -9e12, sourceObservedAtMs: -9e15 }));
  buffer.ingest(event(TARGET, 110n, 98, 100, { receivedAtMs: 1, sourceObservedAtMs: 1 }));

  const horizon = buffer.snapshotAsOf('110');
  assert.equal(horizon.snapshot.ok, true);
});
