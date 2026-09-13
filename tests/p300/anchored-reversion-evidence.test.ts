import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAnchoredReversionObservation,
  calculateOrderBookImbalance,
  type AnchoredReversionConfig,
  type NormalizedReferenceInput,
  type SynchronizedTargetBook,
} from '../../src/p300/anchored-reversion-evidence';

const NOW = 2_000_000;
const NOW_MONO = 9_000_000_000_000n;
const CLOCK_DOMAIN = 'phase-a-process-1';

function monoAgoMs(ms: number): string {
  return (NOW_MONO - BigInt(ms) * 1_000_000n).toString();
}

function config(overrides: Partial<AnchoredReversionConfig> = {}): AnchoredReversionConfig {
  return {
    nowMs: NOW,
    nowMonoNs: NOW_MONO.toString(),
    quoteTicket: 10,
    minReferenceSources: 2,
    maxDataAgeMs: 5_000,
    maxFutureSkewMs: 500,
    maxCrossFeedReceiveSkewMs: 500,
    maxReferenceDispersionBps: 250,
    imbalanceLevels: 2,
    ...overrides,
  };
}

function references(overrides: Partial<NormalizedReferenceInput>[] = []): NormalizedReferenceInput[] {
  const base: NormalizedReferenceInput[] = [
    {
      source: 'ref-a',
      sourcePrice: 100.5,
      sourceQuoteToTargetQuote: 1,
      priceObservedAtMs: NOW - 100,
      receivedAtMs: NOW - 90,
      receivedMonoNs: monoAgoMs(90),
      clockDomain: CLOCK_DOMAIN,
    },
    {
      source: 'ref-b',
      sourcePrice: 99.5,
      sourceQuoteToTargetQuote: 1,
      priceObservedAtMs: NOW - 120,
      receivedAtMs: NOW - 80,
      receivedMonoNs: monoAgoMs(80),
      clockDomain: CLOCK_DOMAIN,
    },
  ];
  return base.map((item, index) => ({ ...item, ...(overrides[index] ?? {}) }));
}

function target(mid = 99): SynchronizedTargetBook {
  return {
    venue: 'bitvavo',
    symbol: 'BTC-USDC',
    sequence: 123,
    exchangeTimestampNs: '1752139200000000000',
    receivedAtMs: NOW - 70,
    receivedMonoNs: monoAgoMs(70),
    clockDomain: CLOCK_DOMAIN,
    book: {
      bids: [
        { price: mid - 0.1, baseQty: 1 },
        { price: mid - 0.2, baseQty: 2 },
      ],
      asks: [
        { price: mid + 0.1, baseQty: 0.5 },
        { price: mid + 0.2, baseQty: 1 },
      ],
    },
  };
}

test('anchored reversion marks underpricing as long-only executable without requiring exchange event time', () => {
  const observation = buildAnchoredReversionObservation(target(99), references(), config());
  assert.equal(observation.referencePrice, 100);
  assert.equal(observation.direction, 'underpriced');
  assert.equal(observation.executableLongOnly, true);
  assert.equal(observation.hypotheticalMakerEntryPrice, 98.9);
  assert.ok(observation.deviationBps < -90);
  assert.equal(observation.targetExchangeTimestampNs, '1752139200000000000');
  assert.equal(observation.targetExchangeObservedAtMs, undefined);
  assert.equal(observation.targetReceivedMonoNs, monoAgoMs(70));
  assert.equal(observation.clockDomain, CLOCK_DOMAIN);
  assert.ok(observation.economics.buyFullyFillable);
});

test('anchored reversion records overpricing but refuses to call it long-only executable', () => {
  const observation = buildAnchoredReversionObservation(target(101), references(), config());
  assert.equal(observation.direction, 'overpriced');
  assert.equal(observation.executableLongOnly, false);
  assert.equal(observation.hypotheticalMakerEntryPrice, 101.1);
  assert.ok(observation.deviationBps > 90);
});

test('reference normalization requires independent sources, explicit conversion and fresh monotonic receipt', () => {
  assert.throws(() => buildAnchoredReversionObservation(target(), references().slice(0, 1), config()), /insufficient independent reference sources/);
  assert.throws(() => buildAnchoredReversionObservation(target(), references([{ sourceQuoteToTargetQuote: 0 }]), config()), /reference quote conversion/);
  assert.throws(
    () => buildAnchoredReversionObservation(target(), references([{ receivedMonoNs: monoAgoMs(10_000) }]), config()),
    /monotonic receive timestamp is stale/,
  );
});

test('reference disagreement and monotonic transport skew fail closed', () => {
  assert.throws(
    () => buildAnchoredReversionObservation(target(), references([{ sourcePrice: 120 }, { sourcePrice: 80 }]), config({ maxReferenceDispersionBps: 100 })),
    /reference sources disagree/,
  );
  assert.throws(
    () => buildAnchoredReversionObservation({ ...target(), receivedMonoNs: monoAgoMs(1_000) }, references(), config({ maxCrossFeedReceiveSkewMs: 200 })),
    /cross-feed monotonic receive skew/,
  );
});

test('mixed monotonic clock domains and future monotonic timestamps fail closed', () => {
  assert.throws(
    () => buildAnchoredReversionObservation(target(), references([{ clockDomain: 'different-process' }]), config()),
    /mixed monotonic clock domains/,
  );
  assert.throws(
    () => buildAnchoredReversionObservation({ ...target(), receivedMonoNs: (NOW_MONO + 1n).toString() }, references(), config()),
    /future-dated/,
  );
});

test('target synchronization metadata and nanosecond representation fail closed when malformed', () => {
  assert.throws(() => buildAnchoredReversionObservation({ ...target(), sequence: Number.NaN }, references(), config()), /target sequence/);
  assert.throws(() => buildAnchoredReversionObservation({ ...target(), exchangeTimestampNs: '1.75e18' }, references(), config()), /integer string/);
  assert.throws(() => buildAnchoredReversionObservation({ ...target(), receivedMonoNs: '9e18' }, references(), config()), /precision-safe integer nanosecond string/);
});

test('optional exchange event time is retained as provenance but not used for freshness', () => {
  const observation = buildAnchoredReversionObservation({ ...target(), exchangeObservedAtMs: NOW - 100_000 }, references(), config());
  assert.equal(observation.targetExchangeObservedAtMs, NOW - 100_000);
});

test('order-book imbalance uses quote depth and stays bounded', () => {
  const imbalance = calculateOrderBookImbalance({ bids: [{ price: 100, baseQty: 2 }], asks: [{ price: 101, baseQty: 1 }] }, 1);
  assert.ok(imbalance > 0);
  assert.ok(imbalance <= 1);
});
