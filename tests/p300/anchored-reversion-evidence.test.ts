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

function config(overrides: Partial<AnchoredReversionConfig> = {}): AnchoredReversionConfig {
  return {
    nowMs: NOW,
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
      conversionObservedAtMs: NOW - 100,
      receivedAtMs: NOW - 90,
    },
    {
      source: 'ref-b',
      sourcePrice: 99.5,
      sourceQuoteToTargetQuote: 1,
      priceObservedAtMs: NOW - 120,
      conversionObservedAtMs: NOW - 120,
      receivedAtMs: NOW - 80,
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
    exchangeObservedAtMs: NOW - 75,
    receivedAtMs: NOW - 70,
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

test('anchored reversion marks underpricing as long-only executable without inventing a threshold', () => {
  const observation = buildAnchoredReversionObservation(target(99), references(), config());

  assert.equal(observation.referencePrice, 100);
  assert.equal(observation.direction, 'underpriced');
  assert.equal(observation.executableLongOnly, true);
  assert.equal(observation.hypotheticalMakerEntryPrice, 98.9);
  assert.ok(observation.deviationBps < -90);
  assert.equal(observation.targetExchangeTimestampNs, '1752139200000000000');
  assert.ok(observation.economics.buyFullyFillable);
});

test('anchored reversion records overpricing but refuses to call it long-only executable', () => {
  const observation = buildAnchoredReversionObservation(target(101), references(), config());

  assert.equal(observation.direction, 'overpriced');
  assert.equal(observation.executableLongOnly, false);
  assert.equal(observation.hypotheticalMakerEntryPrice, 101.1);
  assert.ok(observation.deviationBps > 90);
});

test('reference normalization requires independent fresh sources and explicit quote conversion', () => {
  assert.throws(
    () => buildAnchoredReversionObservation(target(), references().slice(0, 1), config()),
    /insufficient independent reference sources/,
  );

  assert.throws(
    () => buildAnchoredReversionObservation(target(), references([{ sourceQuoteToTargetQuote: 0 }]), config()),
    /reference quote conversion/,
  );

  assert.throws(
    () => buildAnchoredReversionObservation(target(), references([{ receivedAtMs: NOW - 10_000 }]), config()),
    /stale/,
  );
});

test('reference disagreement and transport skew fail closed', () => {
  assert.throws(
    () => buildAnchoredReversionObservation(
      target(),
      references([{ sourcePrice: 120 }, { sourcePrice: 80 }]),
      config({ maxReferenceDispersionBps: 100 }),
    ),
    /reference sources disagree/,
  );

  assert.throws(
    () => buildAnchoredReversionObservation(
      { ...target(), receivedAtMs: NOW - 1_000 },
      references(),
      config({ maxCrossFeedReceiveSkewMs: 200 }),
    ),
    /cross-feed receive skew/,
  );
});

test('target synchronization metadata and nanosecond representation fail closed when malformed', () => {
  assert.throws(
    () => buildAnchoredReversionObservation({ ...target(), sequence: Number.NaN }, references(), config()),
    /target sequence/,
  );

  assert.throws(
    () => buildAnchoredReversionObservation({ ...target(), exchangeTimestampNs: '1.75e18' }, references(), config()),
    /integer string/,
  );
});

test('order-book imbalance uses quote depth and stays bounded', () => {
  const imbalance = calculateOrderBookImbalance({
    bids: [{ price: 100, baseQty: 2 }],
    asks: [{ price: 101, baseQty: 1 }],
  }, 1);

  assert.ok(imbalance > 0);
  assert.ok(imbalance <= 1);
});
