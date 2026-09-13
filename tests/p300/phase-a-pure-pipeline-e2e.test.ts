import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CausalMarketBuffer,
  type CausalMarketEvent,
  type CausalSnapshot,
} from '../../src/p300/causal-market-buffer';
import {
  classifyPhaseADeviationBin,
  PhaseAEpisodeDetector,
  type PhaseADislocationObservation,
  type PhaseAEpisode,
} from '../../src/p300/phase-a-episode-detector';
import { PhaseAHorizonOutcomeRecorder } from '../../src/p300/phase-a-horizon-recorder-v2';
import { createPhaseARawEventRecord, hashPhaseAConfig } from '../../src/p300/phase-a-evidence-integrity';
import { PhaseARawArtifactBuilder, verifyPhaseARawArtifact } from '../../src/p300/phase-a-raw-artifact';
import {
  finalizePhaseAEpisodeEvidenceEnvelope,
  verifyPhaseAEpisodeEvidenceEnvelope,
  type PhaseAQualityCheck,
} from '../../src/p300/phase-a-episode-evidence';

const SESSION = 'phase-a-e2e-fixture';
const START = 10_000_000_000n;
const TARGET = { venue: 'bitvavo', symbol: 'BTC-USDC' };
const KRAKEN = { venue: 'kraken', symbol: 'BTC/USDC' };
const BINANCE = { venue: 'binance', symbol: 'BTCUSDC' };

function observation(target: CausalMarketEvent, snapshot: CausalSnapshot): PhaseADislocationObservation {
  if (!snapshot.ok) throw new Error('fixture snapshot unexpectedly rejected');
  const deviationBps = ((target.mid - snapshot.referenceMid) / snapshot.referenceMid) * 10_000;
  const absoluteDeviationBps = Math.abs(deviationBps);
  return Object.freeze({
    sessionId: target.sessionId,
    targetIngestSeq: target.ingestSeq,
    receivedMonoNs: target.receivedMonoNs,
    receivedAtMs: target.receivedAtMs,
    targetBid: target.bid,
    targetAsk: target.ask,
    targetMid: target.mid,
    referenceMid: snapshot.referenceMid,
    referenceDispersionBps: snapshot.referenceDispersionBps,
    referenceReceiveSkewNs: snapshot.referenceReceiveSkewNs,
    deviationBps,
    absoluteDeviationBps,
    deviationBin: classifyPhaseADeviationBin(absoluteDeviationBps),
    direction: absoluteDeviationBps <= 1e-9 ? 'flat' : deviationBps < 0 ? 'underpriced' : 'overpriced',
    executableLongOnly: deviationBps < -1e-9,
  });
}

function qualityPasses(): PhaseAQualityCheck[] {
  return [
    'targetBookContinuity', 'targetTickerBookAgreement', 'marketStatus', 'monotonicClockDomain',
    'sourceFreshness', 'referenceDispersion', 'crossFeedReceiveSkew', 'rawPayloadParse',
    'forwardHorizonCompleteness',
  ].map((name) => ({ name: name as PhaseAQualityCheck['name'], status: 'pass' as const }));
}

test('pure Phase A pipeline composes causal episode, horizons, raw artifacts and semantic envelope without look-ahead', () => {
  const buffer = new CausalMarketBuffer({
    sessionId: SESSION,
    target: TARGET,
    references: [KRAKEN, BINANCE],
    maxHistoryPerStream: 100,
    maxReferenceAgeMs: 1_000,
    maxReferenceReceiveSkewMs: 500,
    maxReferenceDispersionBps: 100,
  });
  const detector = new PhaseAEpisodeDetector(SESSION);
  const raw = {
    bitvavo: new PhaseARawArtifactBuilder('raw/bitvavo/e2e.ndjson', 'bitvavo', SESSION),
    kraken: new PhaseARawArtifactBuilder('raw/kraken/e2e.ndjson', 'kraken', SESSION),
    binance: new PhaseARawArtifactBuilder('raw/binance/e2e.ndjson', 'binance', SESSION),
  };

  function ingest(
    source: keyof typeof raw,
    stream: { venue: string; symbol: string },
    mono: bigint,
    bid: number,
    ask: number,
  ): CausalMarketEvent {
    const payload = JSON.stringify({ venue: stream.venue, symbol: stream.symbol, bid, ask });
    raw[source].append(createPhaseARawEventRecord({
      source,
      channel: 'bbo',
      sessionId: SESSION,
      receivedWallMs: Number(mono / 1_000_000n),
      receivedMonoNs: mono.toString(),
      rawPayload: payload,
      exchangeEventTimeSemantics: 'not_available',
    }));
    return buffer.ingest({
      ...stream,
      bid,
      ask,
      receivedMonoNs: mono.toString(),
      receivedAtMs: Number(mono / 1_000_000n),
    });
  }

  ingest('kraken', KRAKEN, START - 300n, 99, 101);
  ingest('binance', BINANCE, START - 200n, 99, 101);
  const rearmTarget = ingest('bitvavo', TARGET, START - 100n, 99, 101);
  const rearmSnapshot = buffer.snapshotForTarget(rearmTarget);
  const rearmEvents = detector.observe(observation(rearmTarget, rearmSnapshot));
  assert.deepEqual(rearmEvents.map((event) => event.type), ['armed']);

  ingest('kraken', KRAKEN, START - 20n, 99, 101);
  ingest('binance', BINANCE, START - 10n, 99, 101);
  const dislocatedTarget = ingest('bitvavo', TARGET, START, 97, 99);
  const startSnapshot = buffer.snapshotForTarget(dislocatedTarget);
  const started = detector.observe(observation(dislocatedTarget, startSnapshot));
  assert.deepEqual(started.map((event) => event.type), ['started']);
  const episode = (started[0] as { type: 'started'; episode: PhaseAEpisode }).episode;
  assert.equal(episode.startObservation.direction, 'underpriced');
  assert.ok(episode.startObservation.absoluteDeviationBps >= 10);

  for (const seconds of [1, 2, 5, 15, 30, 60] as const) {
    const due = START + BigInt(seconds) * 1_000_000_000n;
    const targetMid = 98 + (2 * seconds) / 60;
    ingest('kraken', KRAKEN, due - 3n, 99, 101);
    ingest('binance', BINANCE, due - 2n, 99, 101);
    ingest('bitvavo', TARGET, due - 1n, targetMid - 1, targetMid + 1);
  }

  const recorder = new PhaseAHorizonOutcomeRecorder(buffer, episode);
  const outcomes = recorder.recordDue((START + 60_000_000_000n).toString());
  assert.equal(outcomes.length, 6);
  assert.equal(recorder.complete, true);
  assert.ok(outcomes.every((outcome) => outcome.status === 'observed'));
  const observed = outcomes.filter((outcome) => outcome.status === 'observed');
  assert.ok(observed[0].absoluteDeviationBps > observed.at(-1)!.absoluteDeviationBps);
  assert.ok(observed.at(-1)!.grossConvergenceBps > 0);

  const artifacts = {
    bitvavo: raw.bitvavo.finalize(),
    kraken: raw.kraken.finalize(),
    binance: raw.binance.finalize(),
  };
  assert.ok(Object.values(artifacts).every(verifyPhaseARawArtifact));

  const rawRanges = (Object.entries(artifacts) as Array<[keyof typeof artifacts, (typeof artifacts)[keyof typeof artifacts]]>)
    .map(([source, artifact]) => ({
      source,
      sessionId: SESSION,
      artifactId: artifact.descriptor.artifactId,
      sha256: artifact.descriptor.sha256,
      firstOffset: artifact.descriptor.firstRecordOffset,
      lastOffset: artifact.descriptor.lastRecordOffset,
    }));

  const envelope = finalizePhaseAEpisodeEvidenceEnvelope({
    cohortId: 'bitvavo-btc-usdc-direct-usdc-v1',
    collectorCommitSha: '1'.repeat(40),
    configHash: hashPhaseAConfig({ triggerBps: 10, horizons: [1, 2, 5, 15, 30, 60] }),
    createdAtUtc: '2026-09-13T14:00:00.000Z',
    episode,
    horizons: outcomes,
    rawRanges,
    qualityChecks: qualityPasses(),
  });

  assert.equal(envelope.body.sampleEligible, true);
  assert.equal(envelope.body.fillEvidenceStatus, 'not_evaluated_clock_gate');
  assert.equal(verifyPhaseAEpisodeEvidenceEnvelope(envelope), true);

  const first = envelope.body.horizons[0];
  assert.equal(first.horizonSeconds, 1);
  assert.ok(BigInt(first.dueMonoNs) < BigInt(envelope.body.horizons.at(-1)!.dueMonoNs));
  if (first.status === 'observed') {
    assert.ok(BigInt(first.targetReceivedMonoNs) <= BigInt(first.dueMonoNs));
    assert.ok(first.referenceReceivedMonoNs.every((mono) => BigInt(mono) <= BigInt(first.dueMonoNs)));
  }
});
