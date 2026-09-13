import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhaseADislocationObservation } from '../../src/p300/phase-a-episode-detector';
import {
  PHASE_A_MAX_EPISODE_NS,
  PhaseAEpisodeDetector,
  classifyPhaseADeviationBin,
} from '../../src/p300/phase-a-episode-detector';

function observation(ns: bigint, deviationBps: number, ingestSeq = Number(ns)): PhaseADislocationObservation {
  const direction = Math.abs(deviationBps) <= 1e-9 ? 'flat' : deviationBps < 0 ? 'underpriced' : 'overpriced';
  return {
    sessionId: 'session-a',
    targetIngestSeq: ingestSeq,
    receivedMonoNs: ns.toString(),
    receivedAtMs: Number(ns / 1_000_000n),
    targetBid: 99,
    targetAsk: 101,
    targetMid: 100,
    referenceMid: 100,
    referenceDispersionBps: 1,
    referenceReceiveSkewNs: '0',
    deviationBps,
    absoluteDeviationBps: Math.abs(deviationBps),
    deviationBin: classifyPhaseADeviationBin(Math.abs(deviationBps)),
    direction,
    executableLongOnly: direction === 'underpriced',
  };
}

test('deviation bins are frozen around the fee-floor-relevant screening levels', () => {
  assert.equal(classifyPhaseADeviationBin(0), 'below_10');
  assert.equal(classifyPhaseADeviationBin(9.999), 'below_10');
  assert.equal(classifyPhaseADeviationBin(10), '10_to_lt20');
  assert.equal(classifyPhaseADeviationBin(20), '20_to_lt30');
  assert.equal(classifyPhaseADeviationBin(30), '30_to_lt50');
  assert.equal(classifyPhaseADeviationBin(50), '50_to_lt100');
  assert.equal(classifyPhaseADeviationBin(100), 'gte100');
});

test('detector cannot count a startup dislocation without first seeing a below-trigger baseline', () => {
  const detector = new PhaseAEpisodeDetector('session-a');
  assert.deepEqual(detector.observe(observation(1n, -25, 1)), []);
  assert.equal(detector.status, 'awaiting_rearm');
  assert.deepEqual(detector.observe(observation(2n, -5, 2)), [{ type: 'armed', atMonoNs: '2' }]);
  const started = detector.observe(observation(3n, -25, 3));
  assert.equal(started.length, 1);
  assert.equal(started[0].type, 'started');
  assert.equal(detector.status, 'open');
});

test('one long dislocation cannot be fragmented into repeated independent episodes', () => {
  const detector = new PhaseAEpisodeDetector('session-a');
  detector.observe(observation(1n, 0, 1));
  const started = detector.observe(observation(10n, -20, 2));
  assert.equal(started[0]?.type, 'started');
  const episode = detector.openEpisode;
  assert.ok(episode);

  const atEnd = 10n + PHASE_A_MAX_EPISODE_NS;
  const closed = detector.advanceClock(atEnd);
  assert.equal(closed[0]?.type, 'closed');
  assert.equal(detector.status, 'awaiting_rearm');

  // Still dislocated: no second episode, even far beyond the first 60s window.
  assert.deepEqual(detector.observe(observation(atEnd + 1n, -40, 3)), []);
  assert.deepEqual(detector.observe(observation(atEnd + PHASE_A_MAX_EPISODE_NS, -30, 4)), []);
  assert.equal(detector.status, 'awaiting_rearm');

  detector.observe(observation(atEnd + PHASE_A_MAX_EPISODE_NS + 1n, -2, 5));
  assert.equal(detector.status, 'armed');
  const second = detector.observe(observation(atEnd + PHASE_A_MAX_EPISODE_NS + 2n, -15, 6));
  assert.equal(second[0]?.type, 'started');
  assert.notEqual(detector.openEpisode?.episodeId, episode.episodeId);
});

test('episode has fixed preregistered horizon deadlines from the causal start instant', () => {
  const detector = new PhaseAEpisodeDetector('session-a');
  detector.observe(observation(100n, 0, 1));
  detector.observe(observation(200n, 15, 2));
  const episode = detector.openEpisode;
  assert.ok(episode);
  assert.equal(episode.horizonDueMonoNs['1s'], (200n + 1_000_000_000n).toString());
  assert.equal(episode.horizonDueMonoNs['2s'], (200n + 2_000_000_000n).toString());
  assert.equal(episode.horizonDueMonoNs['5s'], (200n + 5_000_000_000n).toString());
  assert.equal(episode.horizonDueMonoNs['15s'], (200n + 15_000_000_000n).toString());
  assert.equal(episode.horizonDueMonoNs['30s'], (200n + 30_000_000_000n).toString());
  assert.equal(episode.horizonDueMonoNs['60s'], (200n + 60_000_000_000n).toString());
  assert.equal(episode.endMonoNs, episode.horizonDueMonoNs['60s']);
});

test('data-integrity invalidation ends the open episode and forces a new rearm', () => {
  const detector = new PhaseAEpisodeDetector('session-a');
  detector.observe(observation(1n, 0, 1));
  detector.observe(observation(2n, -20, 2));
  const invalidated = detector.invalidate(3n, 'reference feed stale');
  assert.equal(invalidated[0]?.type, 'invalidated');
  assert.equal(detector.status, 'awaiting_rearm');
  assert.deepEqual(detector.observe(observation(4n, -30, 3)), []);
  detector.observe(observation(5n, 1, 4));
  assert.equal(detector.status, 'armed');
});

test('if an observation arrives after the 60s boundary it closes the old episode but cannot start another on the same observation', () => {
  const detector = new PhaseAEpisodeDetector('session-a');
  detector.observe(observation(1n, 0, 1));
  detector.observe(observation(2n, -20, 2));
  const after = 2n + PHASE_A_MAX_EPISODE_NS + 1n;
  const events = detector.observe(observation(after, 0, 3));
  assert.deepEqual(events.map((event) => event.type), ['closed', 'armed']);
  assert.equal(detector.status, 'armed');
});

test('session reset discards armed/open state and requires baseline rearm in the new clock domain', () => {
  const detector = new PhaseAEpisodeDetector('session-a');
  detector.observe(observation(100n, 0, 1));
  detector.observe(observation(200n, -20, 2));
  detector.resetSession('session-b');
  assert.equal(detector.status, 'awaiting_rearm');
  assert.equal(detector.openEpisode, undefined);
  assert.throws(() => detector.observe(observation(201n, 0, 3)), /different clock session/);

  const fresh = { ...observation(1n, -20, 1), sessionId: 'session-b' };
  assert.deepEqual(detector.observe(fresh), []);
  assert.equal(detector.status, 'awaiting_rearm');
});

test('detector rejects causal clock regression', () => {
  const detector = new PhaseAEpisodeDetector('session-a');
  detector.observe(observation(10n, 0, 1));
  assert.throws(() => detector.observe(observation(9n, 0, 2)), /clock regressed/);
});
