import assert from 'node:assert/strict';
import test from 'node:test';
import type { BitvavoLocalBookState } from '../../src/p300/bitvavo-book-sync';
import type { CausalMarketEventInput } from '../../src/p300/causal-market-buffer';
import { PhaseACollectorCore, type PhaseATargetSnapshotResult } from '../../src/p300/phase-a-collector-core';
import {
  PHASE_A_HORIZON_SECONDS,
  type PhaseADislocationObservation,
  type PhaseAEpisode,
} from '../../src/p300/phase-a-episode-detector';
import {
  PhaseAHorizonRecorder,
  type PhaseAHorizonAlignmentObservation,
} from '../../src/p300/phase-a-horizon-recorder';
import { parseBitvavoTickerRaw } from '../../src/p300/phase-a-bitvavo-ticker';
import { PhaseATargetCoordinator, type PhaseATargetAlignmentState } from '../../src/p300/phase-a-target-coordinator';
import type { PhaseAReceiveStamp } from '../../src/p300/phase-a-public-feed-parsers';

const SESSION = 'phase-a-horizon-session';
const START = 1_000_000_000n;
const MS = 1_000_000n;

function stamp(ns: bigint): PhaseAReceiveStamp {
  return { receivedMonoNs: ns.toString(), receivedAtMs: Number(ns / MS) };
}

function episode(start = START): PhaseAEpisode {
  const horizonDueMonoNs: Record<string, string> = {};
  for (const seconds of PHASE_A_HORIZON_SECONDS) {
    horizonDueMonoNs[`${seconds}s`] = (start + BigInt(seconds) * 1_000_000_000n).toString();
  }
  const startObservation: PhaseADislocationObservation = {
    sessionId: SESSION,
    targetIngestSeq: 3,
    receivedMonoNs: start.toString(),
    receivedAtMs: Number(start / MS),
    targetBid: 98,
    targetAsk: 99,
    targetMid: 98.5,
    referenceMid: 100,
    referenceDispersionBps: 5,
    referenceReceiveSkewNs: '10000000',
    deviationBps: -150,
    absoluteDeviationBps: 150,
    deviationBin: 'gte100',
    direction: 'underpriced',
    executableLongOnly: true,
  };
  return Object.freeze({
    episodeId: `${SESSION}:3:${start.toString()}`,
    sessionId: SESSION,
    startMonoNs: start.toString(),
    endMonoNs: (start + 60_000_000_000n).toString(),
    startObservation,
    horizonDueMonoNs: Object.freeze(horizonDueMonoNs),
  });
}

function reference(
  venue: 'kraken' | 'binance',
  ns: bigint,
  bid = 99.9,
  ask = 100.1,
): CausalMarketEventInput {
  return {
    venue,
    symbol: venue === 'kraken' ? 'BTC/USDC' : 'BTCUSDC',
    bid,
    ask,
    receivedMonoNs: ns.toString(),
    receivedAtMs: Number(ns / MS),
  };
}

function book(nonce: number, bid = 98, ask = 99): BitvavoLocalBookState {
  return {
    market: 'BTC-USDC',
    nonce,
    bids: { [String(bid)]: '1.5' },
    asks: { [String(ask)]: '2' },
    exchangeTimestampNs: '1752139200123456789',
  };
}

function actionableAt(ns: bigint, nonce = 10, bid = 98, ask = 99) {
  const coordinator = new PhaseATargetCoordinator();
  assert.equal(coordinator.updateBookState(book(nonce, bid, ask), stamp(ns)), null);
  const ticker = parseBitvavoTickerRaw(JSON.stringify({
    event: 'ticker',
    market: 'BTC-USDC',
    bestBid: String(bid),
    bestBidSize: '1.5',
    bestAsk: String(ask),
    bestAskSize: '2',
    lastPrice: String((bid + ask) / 2),
  }), stamp(ns));
  assert.ok(ticker);
  const actionable = coordinator.updateTicker(ticker);
  assert.ok(actionable);
  return actionable;
}

function successfulResult(ns: bigint): PhaseATargetSnapshotResult {
  const collector = new PhaseACollectorCore({
    sessionId: SESSION,
    maxHistoryPerStream: 10,
    maxReferenceAgeMs: 1_000,
    maxReferenceReceiveSkewMs: 500,
    maxReferenceDispersionBps: 100,
  });
  collector.ingestReference(reference('kraken', ns - 20n * MS));
  collector.ingestReference(reference('binance', ns - 10n * MS, 99.95, 100.15));
  return collector.ingestActionableTarget(actionableAt(ns));
}

function rejectedResult(ns: bigint): PhaseATargetSnapshotResult {
  const collector = new PhaseACollectorCore({
    sessionId: SESSION,
    maxHistoryPerStream: 10,
    maxReferenceAgeMs: 1_000,
    maxReferenceReceiveSkewMs: 500,
    maxReferenceDispersionBps: 100,
  });
  collector.ingestReference(reference('kraken', ns - 10n * MS));
  return collector.ingestActionableTarget(actionableAt(ns));
}

function alignedInput(result: PhaseATargetSnapshotResult, observedMonoNs = result.targetEvent.receivedMonoNs): PhaseAHorizonAlignmentObservation {
  const alignment: PhaseATargetAlignmentState = {
    status: 'aligned',
    actionable: result.actionable,
    observedThroughMonoNs: result.actionable.actionableReceivedMonoNs,
  };
  return { observedMonoNs, alignment, snapshotResult: result };
}

function due(seconds: number): bigint {
  return START + BigInt(seconds) * 1_000_000_000n;
}

test('first post-deadline aligned observation resolves the horizon without backdating', () => {
  const recorder = new PhaseAHorizonRecorder(episode(), { maxHorizonLatenessMs: 100 });
  const at = due(1) + 50n * MS;
  const records = recorder.observe(alignedInput(successfulResult(at)));
  assert.equal(records.length, 1);
  const [record] = records;
  assert.equal(record.horizonSeconds, 1);
  assert.equal(record.status, 'observed');
  if (record.status !== 'observed') return;
  assert.equal(record.dueMonoNs, due(1).toString());
  assert.equal(record.stateObservedMonoNs, at.toString());
  assert.equal(record.lateByNs, (50n * MS).toString());
  assert.equal(record.observation.receivedMonoNs, at.toString());
  assert.equal(record.observation.direction, 'underpriced');
});

test('pre-deadline state is never carried forward into a horizon', () => {
  const recorder = new PhaseAHorizonRecorder(episode(), { maxHorizonLatenessMs: 100 });
  const before = due(1) - 1n * MS;
  assert.deepEqual(recorder.observe(alignedInput(successfulResult(before))), []);

  assert.deepEqual(recorder.advanceClock((due(1) + 100n * MS).toString()), []);
  const expired = recorder.advanceClock((due(1) + 100n * MS + 1n).toString());
  assert.equal(expired.length, 1);
  assert.equal(expired[0].status, 'no_timely_state');
});

test('an observation exactly at the lateness boundary remains eligible', () => {
  const recorder = new PhaseAHorizonRecorder(episode(), { maxHorizonLatenessMs: 100 });
  const at = due(1) + 100n * MS;
  const [record] = recorder.observe(alignedInput(successfulResult(at)));
  assert.equal(record.status, 'observed');
  if (record.status === 'observed') assert.equal(record.lateByNs, (100n * MS).toString());
});

test('first mismatched state after a deadline wins; later alignment cannot rewrite history', () => {
  const recorder = new PhaseAHorizonRecorder(episode(), { maxHorizonLatenessMs: 100 });
  const mismatchAt = due(1) + 10n * MS;
  const mismatch: PhaseATargetAlignmentState = {
    status: 'mismatched',
    bookReceivedMonoNs: (mismatchAt - 2n * MS).toString(),
    tickerReceivedMonoNs: (mismatchAt - 1n * MS).toString(),
    observedThroughMonoNs: (mismatchAt - 1n * MS).toString(),
  };
  const [first] = recorder.observe({ observedMonoNs: mismatchAt.toString(), alignment: mismatch });
  assert.equal(first.status, 'mismatched');

  const alignedAt = due(1) + 20n * MS;
  assert.deepEqual(recorder.observe(alignedInput(successfulResult(alignedAt))), []);
  assert.equal(recorder.records[0].status, 'mismatched');
});

test('missing target state is explicit evidence rather than an inferred price', () => {
  const recorder = new PhaseAHorizonRecorder(episode(), { maxHorizonLatenessMs: 100 });
  const at = due(1) + 5n * MS;
  const alignment: PhaseATargetAlignmentState = {
    status: 'missing',
    missing: ['book'],
    observedThroughMonoNs: at.toString(),
  };
  const [record] = recorder.observe({ observedMonoNs: at.toString(), alignment });
  assert.equal(record.status, 'missing');
  if (record.status === 'missing') assert.deepEqual(record.missing, ['book']);
});

test('aligned state with rejected references records quality rejection, not a deviation', () => {
  const recorder = new PhaseAHorizonRecorder(episode(), { maxHorizonLatenessMs: 100 });
  const at = due(1) + 5n * MS;
  const result = rejectedResult(at);
  assert.equal(result.snapshot.ok, false);
  const [record] = recorder.observe(alignedInput(result));
  assert.equal(record.status, 'quality_rejected');
  if (record.status === 'quality_rejected') {
    assert.ok(record.failures.some((failure) => failure.code === 'MISSING_REFERENCE'));
  }
});

test('first state arriving after the configured window produces no_timely_state', () => {
  const recorder = new PhaseAHorizonRecorder(episode(), { maxHorizonLatenessMs: 100 });
  const at = due(1) + 101n * MS;
  const [record] = recorder.observe(alignedInput(successfulResult(at)));
  assert.equal(record.status, 'no_timely_state');

  const later = due(1) + 120n * MS;
  assert.deepEqual(recorder.observe(alignedInput(successfulResult(later))), []);
  assert.equal(recorder.records[0].status, 'no_timely_state');
});

test('late timer can close several expired horizons without forward-filling them', () => {
  const recorder = new PhaseAHorizonRecorder(episode(), { maxHorizonLatenessMs: 100 });
  const now = due(2) + 100n * MS + 1n;
  const records = recorder.advanceClock(now.toString());
  assert.deepEqual(records.map((record) => [record.horizonSeconds, record.status]), [
    [1, 'no_timely_state'],
    [2, 'no_timely_state'],
  ]);
  assert.equal(recorder.complete, false);
});

test('invalidation seals every unresolved horizon and cannot be repaired later', () => {
  const recorder = new PhaseAHorizonRecorder(episode(), { maxHorizonLatenessMs: 100 });
  const invalidatedAt = START + 500n * MS;
  const records = recorder.invalidate(invalidatedAt.toString(), 'book sequence gap');
  assert.equal(records.length, PHASE_A_HORIZON_SECONDS.length);
  assert.ok(records.every((record) => record.status === 'invalidated'));
  assert.equal(recorder.complete, true);
  assert.throws(
    () => recorder.observe(alignedInput(successfulResult(due(1)))),
    /after invalidation/,
  );
});

test('recorder rejects future evidence, clock regression and forged snapshot coupling', () => {
  const recorder = new PhaseAHorizonRecorder(episode(), { maxHorizonLatenessMs: 100 });
  const at = START + 100n * MS;
  const futureMissing: PhaseATargetAlignmentState = {
    status: 'missing',
    missing: ['ticker'],
    observedThroughMonoNs: (at + 1n).toString(),
  };
  assert.throws(
    () => recorder.observe({ observedMonoNs: at.toString(), alignment: futureMissing }),
    /future evidence/,
  );

  const missing: PhaseATargetAlignmentState = { status: 'missing', missing: ['ticker'] };
  recorder.observe({ observedMonoNs: (at + 10n).toString(), alignment: missing });
  assert.throws(
    () => recorder.observe({ observedMonoNs: at.toString(), alignment: missing }),
    /clock regressed/,
  );

  const alignedAt = due(1);
  const result = successfulResult(alignedAt);
  const aligned = alignedInput(result);
  assert.throws(
    () => new PhaseAHorizonRecorder(episode(), { maxHorizonLatenessMs: 100 }).observe({
      observedMonoNs: aligned.observedMonoNs,
      alignment: aligned.alignment,
    }),
    /requires its causal snapshot result/,
  );
  assert.throws(
    () => new PhaseAHorizonRecorder(episode(), { maxHorizonLatenessMs: 100 }).observe({
      observedMonoNs: aligned.observedMonoNs,
      alignment: missing,
      snapshotResult: result,
    }),
    /non-aligned horizon state/,
  );
});

test('recorder validates frozen episode deadlines and mandatory lateness config', () => {
  const malformed = {
    ...episode(),
    horizonDueMonoNs: { ...episode().horizonDueMonoNs, '5s': '123' },
  };
  assert.throws(
    () => new PhaseAHorizonRecorder(malformed, { maxHorizonLatenessMs: 100 }),
    /preregistered deadline/,
  );
  assert.throws(
    () => new PhaseAHorizonRecorder(episode(), { maxHorizonLatenessMs: Number.NaN }),
    /non-negative and finite/,
  );
});
