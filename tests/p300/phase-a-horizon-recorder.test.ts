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
import { PhaseAHorizonRecorder } from '../../src/p300/phase-a-horizon-recorder';
import { parseBitvavoTickerRaw } from '../../src/p300/phase-a-bitvavo-ticker';
import { PhaseATargetCoordinator, type PhaseATargetAlignmentState } from '../../src/p300/phase-a-target-coordinator';
import type { PhaseAReceiveStamp } from '../../src/p300/phase-a-public-feed-parsers';

const SESSION = 'phase-a-horizon-session';
const START = 1_000_000_000n;
const MS = 1_000_000n;

function stamp(ns: bigint): PhaseAReceiveStamp {
  return { receivedMonoNs: ns.toString(), receivedAtMs: Number(ns / MS) };
}

function makeEpisode(start = START): PhaseAEpisode {
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
    episodeId: `${SESSION}:3:${start}`,
    sessionId: SESSION,
    startMonoNs: start.toString(),
    endMonoNs: (start + 60_000_000_000n).toString(),
    startObservation,
    horizonDueMonoNs: Object.freeze(horizonDueMonoNs),
  });
}

function reference(venue: 'kraken' | 'binance', ns: bigint, bid = 99.9, ask = 100.1): CausalMarketEventInput {
  return {
    venue,
    symbol: venue === 'kraken' ? 'BTC/USDC' : 'BTCUSDC',
    bid,
    ask,
    receivedMonoNs: ns.toString(),
    receivedAtMs: Number(ns / MS),
  };
}

function localBook(nonce = 10): BitvavoLocalBookState {
  return {
    market: 'BTC-USDC',
    nonce,
    bids: { '98': '1.5' },
    asks: { '99': '2' },
    exchangeTimestampNs: '1752139200123456789',
  };
}

function actionableAt(ns: bigint) {
  const coordinator = new PhaseATargetCoordinator();
  coordinator.updateBookState(localBook(), stamp(ns));
  const ticker = parseBitvavoTickerRaw(JSON.stringify({
    event: 'ticker',
    market: 'BTC-USDC',
    bestBid: '98',
    bestBidSize: '1.5',
    bestAsk: '99',
    bestAskSize: '2',
    lastPrice: '98.5',
  }), stamp(ns));
  assert.ok(ticker);
  const actionable = coordinator.updateTicker(ticker);
  assert.ok(actionable);
  return actionable;
}

function snapshotAt(ns: bigint, reject = false): PhaseATargetSnapshotResult {
  const collector = new PhaseACollectorCore({
    sessionId: SESSION,
    maxHistoryPerStream: 10,
    maxReferenceAgeMs: 1_000,
    maxReferenceReceiveSkewMs: 500,
    maxReferenceDispersionBps: 100,
  });
  collector.ingestReference(reference('kraken', ns - 20n * MS));
  if (!reject) collector.ingestReference(reference('binance', ns - 10n * MS, 99.95, 100.15));
  return collector.ingestActionableTarget(actionableAt(ns));
}

function alignedInput(result: PhaseATargetSnapshotResult, observedMonoNs = result.targetEvent.receivedMonoNs) {
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

test('first post-deadline aligned observation resolves exactly once', () => {
  const recorder = new PhaseAHorizonRecorder(makeEpisode(), { maxHorizonLatenessMs: 100 });
  const at = due(1) + 50n * MS;
  const [record] = recorder.observe(alignedInput(snapshotAt(at)));
  assert.equal(record.status, 'observed');
  assert.equal(record.horizonSeconds, 1);
  if (record.status === 'observed') {
    assert.equal(record.lateByNs, (50n * MS).toString());
    assert.equal(record.observation.receivedMonoNs, at.toString());
  }
  assert.deepEqual(recorder.observe(alignedInput(snapshotAt(due(1) + 70n * MS))), []);
});

test('pre-deadline state is never carried forward and exact lateness boundary is eligible', () => {
  const stale = new PhaseAHorizonRecorder(makeEpisode(), { maxHorizonLatenessMs: 100 });
  assert.deepEqual(stale.observe(alignedInput(snapshotAt(due(1) - 1n * MS))), []);
  assert.deepEqual(stale.advanceClock((due(1) + 100n * MS).toString()), []);
  const [missing] = stale.advanceClock((due(1) + 100n * MS + 1n).toString());
  assert.equal(missing.status, 'no_timely_state');

  const boundary = new PhaseAHorizonRecorder(makeEpisode(), { maxHorizonLatenessMs: 100 });
  const [observed] = boundary.observe(alignedInput(snapshotAt(due(1) + 100n * MS)));
  assert.equal(observed.status, 'observed');
});

test('mismatched, missing and rejected-quality states remain explicit outcomes', () => {
  const mismatchRecorder = new PhaseAHorizonRecorder(makeEpisode(), { maxHorizonLatenessMs: 100 });
  const mismatchAt = due(1) + 10n * MS;
  const mismatch: PhaseATargetAlignmentState = {
    status: 'mismatched',
    bookReceivedMonoNs: (mismatchAt - 2n * MS).toString(),
    tickerReceivedMonoNs: mismatchAt.toString(),
    observedThroughMonoNs: mismatchAt.toString(),
  };
  assert.equal(mismatchRecorder.observe({ observedMonoNs: mismatchAt.toString(), alignment: mismatch })[0].status, 'mismatched');

  const missingRecorder = new PhaseAHorizonRecorder(makeEpisode(), { maxHorizonLatenessMs: 100 });
  const missingAt = due(1) + 5n * MS;
  const missingState: PhaseATargetAlignmentState = {
    status: 'missing',
    missing: ['book'],
    observedThroughMonoNs: missingAt.toString(),
  };
  assert.equal(missingRecorder.observe({ observedMonoNs: missingAt.toString(), alignment: missingState })[0].status, 'missing');

  const rejectedRecorder = new PhaseAHorizonRecorder(makeEpisode(), { maxHorizonLatenessMs: 100 });
  const rejected = snapshotAt(due(1) + 5n * MS, true);
  const [quality] = rejectedRecorder.observe(alignedInput(rejected));
  assert.equal(quality.status, 'quality_rejected');
});

test('state arriving outside the configured window cannot repair that horizon', () => {
  const recorder = new PhaseAHorizonRecorder(makeEpisode(), { maxHorizonLatenessMs: 100 });
  const [record] = recorder.observe(alignedInput(snapshotAt(due(1) + 101n * MS)));
  assert.equal(record.status, 'no_timely_state');
  assert.deepEqual(recorder.observe(alignedInput(snapshotAt(due(1) + 120n * MS))), []);
});

test('late timer may close multiple expired horizons without inventing observations', () => {
  const recorder = new PhaseAHorizonRecorder(makeEpisode(), { maxHorizonLatenessMs: 100 });
  const records = recorder.advanceClock((due(2) + 100n * MS + 1n).toString());
  assert.deepEqual(records.map((record) => [record.horizonSeconds, record.status]), [
    [1, 'no_timely_state'],
    [2, 'no_timely_state'],
  ]);
});

test('invalidation seals all unresolved horizons permanently', () => {
  const recorder = new PhaseAHorizonRecorder(makeEpisode(), { maxHorizonLatenessMs: 100 });
  const records = recorder.invalidate((START + 500n * MS).toString(), 'book sequence gap');
  assert.equal(records.length, PHASE_A_HORIZON_SECONDS.length);
  assert.ok(records.every((record) => record.status === 'invalidated'));
  assert.equal(recorder.complete, true);
  assert.throws(() => recorder.observe(alignedInput(snapshotAt(due(1)))), /after invalidation/);
});

test('old aligned state cannot be re-stamped after a horizon', () => {
  const recorder = new PhaseAHorizonRecorder(makeEpisode(), { maxHorizonLatenessMs: 100 });
  const old = snapshotAt(due(1) - 1n * MS);
  assert.throws(
    () => recorder.observe(alignedInput(old, (due(1) + 1n * MS).toString())),
    /cannot be re-stamped/,
  );
});

test('rejected temporal forgery does not advance internal clock', () => {
  const recorder = new PhaseAHorizonRecorder(makeEpisode(), { maxHorizonLatenessMs: 100 });
  const badAt = START + 100n * MS;
  const forged: PhaseATargetAlignmentState = {
    status: 'missing',
    missing: ['ticker'],
    observedThroughMonoNs: (badAt - 1n).toString(),
  };
  assert.throws(() => recorder.observe({ observedMonoNs: badAt.toString(), alignment: forged }), /re-stamped/);

  const earlier = START + 50n * MS;
  const valid: PhaseATargetAlignmentState = {
    status: 'missing',
    missing: ['ticker'],
    observedThroughMonoNs: earlier.toString(),
  };
  assert.doesNotThrow(() => recorder.observe({ observedMonoNs: earlier.toString(), alignment: valid }));
});

test('mismatched alignment must bind observedThrough to the freshest component', () => {
  const recorder = new PhaseAHorizonRecorder(makeEpisode(), { maxHorizonLatenessMs: 100 });
  const at = START + 100n * MS;
  const forged: PhaseATargetAlignmentState = {
    status: 'mismatched',
    bookReceivedMonoNs: (at - 2n).toString(),
    tickerReceivedMonoNs: (at - 1n).toString(),
    observedThroughMonoNs: at.toString(),
  };
  assert.throws(
    () => recorder.observe({ observedMonoNs: at.toString(), alignment: forged }),
    /inconsistent with its components/,
  );
});

test('recorder rejects clock regression and forged snapshot coupling', () => {
  const recorder = new PhaseAHorizonRecorder(makeEpisode(), { maxHorizonLatenessMs: 100 });
  const missing: PhaseATargetAlignmentState = { status: 'missing', missing: ['ticker'] };
  recorder.observe({ observedMonoNs: (START + 100n * MS).toString(), alignment: missing });
  assert.throws(
    () => recorder.observe({ observedMonoNs: (START + 90n * MS).toString(), alignment: missing }),
    /clock regressed/,
  );

  const result = snapshotAt(due(1));
  const aligned = alignedInput(result);
  assert.throws(
    () => new PhaseAHorizonRecorder(makeEpisode(), { maxHorizonLatenessMs: 100 }).observe({
      observedMonoNs: aligned.observedMonoNs,
      alignment: aligned.alignment,
    }),
    /requires its causal snapshot result/,
  );
  assert.throws(
    () => new PhaseAHorizonRecorder(makeEpisode(), { maxHorizonLatenessMs: 100 }).observe({
      observedMonoNs: due(1).toString(),
      alignment: missing,
      snapshotResult: result,
    }),
    /non-aligned horizon state/,
  );
});

test('recorder validates frozen deadlines and mandatory lateness config', () => {
  const malformed = {
    ...makeEpisode(),
    horizonDueMonoNs: { ...makeEpisode().horizonDueMonoNs, '5s': '123' },
  };
  assert.throws(() => new PhaseAHorizonRecorder(malformed, { maxHorizonLatenessMs: 100 }), /preregistered deadline/);
  assert.throws(() => new PhaseAHorizonRecorder(makeEpisode(), { maxHorizonLatenessMs: Number.NaN }), /non-negative and finite/);
});
