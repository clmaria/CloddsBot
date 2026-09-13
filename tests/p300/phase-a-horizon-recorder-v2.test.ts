import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CausalMarketBuffer,
  type CausalMarketBufferConfig,
  type CausalMarketEventInput,
} from '../../src/p300/causal-market-buffer';
import {
  PHASE_A_HORIZON_SECONDS,
  type PhaseADislocationObservation,
  type PhaseAEpisode,
} from '../../src/p300/phase-a-episode-detector';
import { PhaseAHorizonOutcomeRecorder } from '../../src/p300/phase-a-horizon-recorder-v2';

const TARGET = { venue: 'bitvavo', symbol: 'BTC-USDC' };
const KRAKEN = { venue: 'kraken', symbol: 'BTC/USDC' };
const BINANCE = { venue: 'binance', symbol: 'BTCUSDC' };
const START = 1_000_000_000n;

function config(overrides: Partial<CausalMarketBufferConfig> = {}): CausalMarketBufferConfig {
  return {
    sessionId: 'phase-a-horizon-v2',
    target: TARGET,
    references: [KRAKEN, BINANCE],
    maxHistoryPerStream: 50,
    maxReferenceAgeMs: 5_000,
    maxReferenceReceiveSkewMs: 1_000,
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

function episode(): PhaseAEpisode {
  const startObservation: PhaseADislocationObservation = {
    sessionId: 'phase-a-horizon-v2',
    targetIngestSeq: 3,
    receivedMonoNs: START.toString(),
    receivedAtMs: Number(START / 1_000_000n),
    targetBid: 97,
    targetAsk: 99,
    targetMid: 98,
    referenceMid: 100,
    referenceDispersionBps: 0,
    referenceReceiveSkewNs: '0',
    deviationBps: -200,
    absoluteDeviationBps: 200,
    deviationBin: 'gte100',
    direction: 'underpriced',
    executableLongOnly: true,
  };
  const horizonDueMonoNs: Record<string, string> = {};
  for (const seconds of PHASE_A_HORIZON_SECONDS) {
    horizonDueMonoNs[`${seconds}s`] = (START + BigInt(seconds) * 1_000_000_000n).toString();
  }
  return Object.freeze({
    episodeId: `phase-a-horizon-v2:3:${START.toString()}`,
    sessionId: 'phase-a-horizon-v2',
    startMonoNs: START.toString(),
    endMonoNs: (START + 60_000_000_000n).toString(),
    startObservation,
    horizonDueMonoNs: Object.freeze(horizonDueMonoNs),
  });
}

function seedStart(buffer: CausalMarketBuffer): void {
  buffer.ingest(event(KRAKEN, START - 10n, 99, 101));
  buffer.ingest(event(BINANCE, START - 5n, 99, 101));
  buffer.ingest(event(TARGET, START, 97, 99));
}

test('records only horizons whose monotonic deadlines have passed and computes measured outcomes', () => {
  const buffer = new CausalMarketBuffer(config());
  seedStart(buffer);
  buffer.ingest(event(KRAKEN, START + 900_000_000n, 99.5, 101.5));
  buffer.ingest(event(BINANCE, START + 950_000_000n, 99.5, 101.5));
  buffer.ingest(event(TARGET, START + 980_000_000n, 98, 100));

  const recorder = new PhaseAHorizonOutcomeRecorder(buffer, episode());
  assert.deepEqual(recorder.recordDue((START + 999_999_999n).toString()), []);

  const created = recorder.recordDue((START + 1_000_000_000n).toString());
  assert.equal(created.length, 1);
  const first = created[0];
  assert.equal(first.horizonSeconds, 1);
  assert.equal(first.status, 'observed');
  if (first.status !== 'observed') return;
  assert.equal(first.targetMid, 99);
  assert.equal(first.referenceMid, 100.5);
  assert.ok(first.absoluteDeviationBps < 200);
  assert.ok(first.grossConvergenceBps > 0);
  assert.ok(first.targetReturnBps > 0);
  assert.ok(first.referenceReturnBps > 0);
  assert.equal(Object.isFrozen(first), true);
});

test('later data cannot improve an already sealed horizon or leak across its cutoff', () => {
  const buffer = new CausalMarketBuffer(config());
  seedStart(buffer);
  buffer.ingest(event(KRAKEN, START + 900_000_000n, 99, 101));
  buffer.ingest(event(BINANCE, START + 900_000_000n, 99, 101));
  buffer.ingest(event(TARGET, START + 950_000_000n, 97, 99));

  const recorder = new PhaseAHorizonOutcomeRecorder(buffer, episode());
  const first = recorder.recordDue((START + 1_000_000_000n).toString())[0];
  assert.equal(first.status, 'observed');
  if (first.status !== 'observed') return;

  buffer.ingest(event(KRAKEN, START + 1_100_000_000n, 109, 111));
  buffer.ingest(event(BINANCE, START + 1_100_000_000n, 109, 111));
  buffer.ingest(event(TARGET, START + 1_100_000_000n, 109, 111));
  assert.deepEqual(recorder.recordDue((START + 1_500_000_000n).toString()), []);

  const sealed = recorder.outcomes[0];
  assert.equal(sealed.status, 'observed');
  if (sealed.status !== 'observed') return;
  assert.equal(sealed.targetMid, 98);
  assert.equal(sealed.referenceMid, 100);
  assert.deepEqual(sealed.referenceReceivedMonoNs, [
    (START + 900_000_000n).toString(),
    (START + 900_000_000n).toString(),
  ]);
});

test('quality failure at a horizon is preserved instead of forward-filled or repaired later', () => {
  const buffer = new CausalMarketBuffer(config({ maxReferenceAgeMs: 100 }));
  seedStart(buffer);
  const recorder = new PhaseAHorizonOutcomeRecorder(buffer, episode());

  const first = recorder.recordDue((START + 1_000_000_000n).toString())[0];
  assert.equal(first.status, 'quality_rejected');
  if (first.status !== 'quality_rejected') return;
  assert.equal(first.failures.filter((failure) => failure.code === 'STALE_REFERENCE').length, 2);

  buffer.ingest(event(KRAKEN, START + 1_100_000_000n, 99, 101));
  buffer.ingest(event(BINANCE, START + 1_100_000_000n, 99, 101));
  assert.equal(recorder.outcomes[0].status, 'quality_rejected');
});

test('evicted historical target state becomes explicit unavailable evidence', () => {
  const buffer = new CausalMarketBuffer(config({ maxHistoryPerStream: 1 }));
  seedStart(buffer);
  buffer.ingest(event(TARGET, START + 2_000_000_000n, 100, 102));

  const recorder = new PhaseAHorizonOutcomeRecorder(buffer, episode());
  const created = recorder.recordDue((START + 2_000_000_000n).toString());
  assert.equal(created.length, 2);
  assert.equal(created[0].status, 'unavailable');
  assert.equal(created[1].status, 'observed');
});

test('a large timer jump seals every due horizon independently from historical causal state', () => {
  const buffer = new CausalMarketBuffer(config({ maxHistoryPerStream: 100 }));
  seedStart(buffer);
  for (const seconds of [1, 2, 5] as const) {
    const at = START + BigInt(seconds) * 1_000_000_000n;
    buffer.ingest(event(KRAKEN, at - 3n, 99 + seconds, 101 + seconds));
    buffer.ingest(event(BINANCE, at - 2n, 99 + seconds, 101 + seconds));
    buffer.ingest(event(TARGET, at - 1n, 97 + seconds, 99 + seconds));
  }

  const recorder = new PhaseAHorizonOutcomeRecorder(buffer, episode());
  const created = recorder.recordDue((START + 5_000_000_000n).toString());
  assert.deepEqual(created.map((outcome) => outcome.horizonSeconds), [1, 2, 5]);
  assert.ok(created.every((outcome) => outcome.status === 'observed'));
  assert.equal(recorder.outcomes.length, 3);
});

test('clock regression and session reset fail closed', () => {
  const buffer = new CausalMarketBuffer(config());
  seedStart(buffer);
  const recorder = new PhaseAHorizonOutcomeRecorder(buffer, episode());
  recorder.recordDue((START + 1_000_000_000n).toString());
  assert.throws(
    () => recorder.recordDue((START + 999_999_999n).toString()),
    /monotonic clock regressed/,
  );

  buffer.resetSession('phase-a-horizon-v2-reset');
  assert.throws(
    () => recorder.recordDue((START + 2_000_000_000n).toString()),
    /clock session is no longer valid/,
  );
});
