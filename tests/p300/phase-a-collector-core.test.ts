import assert from 'node:assert/strict';
import test from 'node:test';
import type { BitvavoLocalBookState } from '../../src/p300/bitvavo-book-sync';
import type { CausalMarketEventInput } from '../../src/p300/causal-market-buffer';
import { PhaseACollectorCore, type PhaseACollectorCoreConfig } from '../../src/p300/phase-a-collector-core';
import { parseBitvavoTickerRaw } from '../../src/p300/phase-a-bitvavo-ticker';
import { PhaseATargetCoordinator, type PhaseAActionableTarget } from '../../src/p300/phase-a-target-coordinator';
import type { PhaseAReceiveStamp } from '../../src/p300/phase-a-public-feed-parsers';

function stamp(ns: bigint): PhaseAReceiveStamp {
  return { receivedMonoNs: ns.toString(), receivedAtMs: Number(ns / 1_000_000n) };
}

function config(overrides: Partial<PhaseACollectorCoreConfig> = {}): PhaseACollectorCoreConfig {
  return {
    sessionId: 'phase-a-collector-session-1',
    maxHistoryPerStream: 10,
    maxReferenceAgeMs: 1_000,
    maxReferenceReceiveSkewMs: 500,
    maxReferenceDispersionBps: 100,
    ...overrides,
  };
}

function reference(
  venue: 'kraken' | 'binance',
  ns: bigint,
  bid = 99,
  ask = 101,
): CausalMarketEventInput {
  return {
    venue,
    symbol: venue === 'kraken' ? 'BTC/USDC' : 'BTCUSDC',
    bid,
    ask,
    receivedMonoNs: ns.toString(),
    receivedAtMs: Number(ns / 1_000_000n),
  };
}

function localBook(nonce = 10): BitvavoLocalBookState {
  return {
    market: 'BTC-USDC',
    nonce,
    bids: { '98': '1.5', '97': '3' },
    asks: { '99': '2', '100': '4' },
    exchangeTimestampNs: '1752139200123456789',
  };
}

function actionableTarget(bookNs = 200n, tickerNs = 190n, nonce = 10): PhaseAActionableTarget {
  const coordinator = new PhaseATargetCoordinator();
  assert.equal(coordinator.updateBookState(localBook(nonce), stamp(bookNs)), null);
  const ticker = parseBitvavoTickerRaw(JSON.stringify({
    event: 'ticker',
    market: 'BTC-USDC',
    bestBid: '98',
    bestBidSize: '1.5',
    bestAsk: '99',
    bestAskSize: '2',
    lastPrice: '98.5',
  }), stamp(tickerNs));
  assert.ok(ticker);
  const actionable = coordinator.updateTicker(ticker);
  assert.ok(actionable);
  return actionable;
}

test('collector core composes two direct-USDC references with a validated target snapshot', () => {
  const collector = new PhaseACollectorCore(config());
  collector.ingestReference(reference('kraken', 100n, 99.4, 99.6));
  collector.ingestReference(reference('binance', 150n, 99.5, 99.7));

  const result = collector.ingestActionableTarget(actionableTarget(200n, 200n));
  assert.equal(result.snapshot.ok, true);
  if (!result.snapshot.ok) return;
  assert.equal(result.snapshot.target.venue, 'bitvavo');
  assert.deepEqual(result.snapshot.references.map((item) => item.venue), ['kraken', 'binance']);
  assert.ok(result.snapshot.referenceMid > 99.4 && result.snapshot.referenceMid < 99.7);
  assert.equal(result.targetEvent.receivedMonoNs, '200');
});

test('collector core fails closed when a required reference is missing', () => {
  const collector = new PhaseACollectorCore(config());
  collector.ingestReference(reference('kraken', 100n));
  const result = collector.ingestActionableTarget(actionableTarget(200n, 200n));
  assert.equal(result.snapshot.ok, false);
  if (result.snapshot.ok) return;
  assert.ok(result.snapshot.failures.some((failure) => failure.code === 'MISSING_REFERENCE'));
});

test('late reference arrival cannot backfill a historical target', () => {
  const collector = new PhaseACollectorCore(config());
  collector.ingestReference(reference('kraken', 100n));
  const first = collector.ingestActionableTarget(actionableTarget(200n, 200n));
  assert.equal(first.snapshot.ok, false);

  collector.ingestReference(reference('binance', 250n));
  const rebuilt = collector.snapshotForTarget(first.targetEvent);
  assert.equal(rebuilt.ok, false);
  if (rebuilt.ok) return;
  assert.ok(rebuilt.failures.some((failure) => failure.code === 'MISSING_REFERENCE'));
});

test('collector core rejects references outside the frozen primary cohort', () => {
  const collector = new PhaseACollectorCore(config());
  assert.throws(() => collector.ingestReference({
    venue: 'coinbase', symbol: 'BTC-USDC', bid: 99, ask: 101,
    receivedMonoNs: '100', receivedAtMs: 0,
  }), /outside the frozen/);
  assert.throws(() => collector.ingestReference({
    venue: 'kraken', symbol: 'ETH/USDC', bid: 99, ask: 101,
    receivedMonoNs: '100', receivedAtMs: 0,
  }), /outside the frozen/);
});

test('collector core revalidates the coordinator contract instead of trusting a structurally forged target', () => {
  const collector = new PhaseACollectorCore(config());
  collector.ingestReference(reference('kraken', 100n));
  collector.ingestReference(reference('binance', 150n));
  const valid = actionableTarget(200n, 200n);

  assert.throws(
    () => collector.ingestActionableTarget({
      ...valid,
      target: { ...valid.target, receivedMonoNs: '199' },
    }),
    /causal timestamp/,
  );

  assert.throws(
    () => collector.ingestActionableTarget({
      ...valid,
      target: { ...valid.target, sourceObservedAtMs: 1_752_139_200_123 },
    }),
    /sourceObservedAtMs must remain unset/,
  );

  assert.throws(
    () => collector.ingestActionableTarget({
      ...valid,
      ticker: { ...valid.ticker, bidSize: valid.ticker.bidSize + 1 },
    }),
    /BBO agreement/,
  );
});

test('collector core preserves stale/skew/dispersion fail-closed behavior from the causal buffer', () => {
  const stale = new PhaseACollectorCore(config({ maxReferenceAgeMs: 0 }));
  stale.ingestReference(reference('kraken', 100n));
  stale.ingestReference(reference('binance', 100n));
  const staleResult = stale.ingestActionableTarget(actionableTarget(101n, 101n));
  assert.equal(staleResult.snapshot.ok, false);
  if (!staleResult.snapshot.ok) {
    assert.equal(staleResult.snapshot.failures.filter((failure) => failure.code === 'STALE_REFERENCE').length, 2);
  }

  const dispersed = new PhaseACollectorCore(config({ maxReferenceDispersionBps: 10 }));
  dispersed.ingestReference(reference('kraken', 100n, 99, 101));
  dispersed.ingestReference(reference('binance', 100n, 109, 111));
  const dispersedResult = dispersed.ingestActionableTarget(actionableTarget(101n, 101n));
  assert.equal(dispersedResult.snapshot.ok, false);
  if (!dispersedResult.snapshot.ok) {
    assert.ok(dispersedResult.snapshot.failures.some((failure) => failure.code === 'REFERENCE_DISPERSION_EXCEEDED'));
  }
});

test('new collector session clears history, invalidates old targets and permits a new monotonic clock domain', () => {
  const collector = new PhaseACollectorCore(config());
  collector.ingestReference(reference('kraken', 1_000n));
  collector.ingestReference(reference('binance', 1_000n));
  const old = collector.ingestActionableTarget(actionableTarget(1_001n, 1_001n));
  assert.equal(old.snapshot.ok, true);

  collector.resetSession('phase-a-collector-session-2');
  assert.equal(collector.sessionId, 'phase-a-collector-session-2');
  assert.throws(() => collector.snapshotForTarget(old.targetEvent), /different clock session/);

  collector.ingestReference(reference('kraken', 10n));
  collector.ingestReference(reference('binance', 10n));
  const fresh = collector.ingestActionableTarget(actionableTarget(11n, 11n, 1));
  assert.equal(fresh.snapshot.ok, true);
});
