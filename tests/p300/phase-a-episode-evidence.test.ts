import assert from 'node:assert/strict';
import test from 'node:test';
import {
  finalizePhaseAEvidenceEnvelope,
  hashPhaseAConfig,
  verifyPhaseAEvidenceEnvelope,
} from '../../src/p300/phase-a-evidence-integrity';
import {
  PHASE_A_HORIZON_SECONDS,
  type PhaseADislocationObservation,
  type PhaseAEpisode,
} from '../../src/p300/phase-a-episode-detector';
import type { PhaseAHorizonOutcome } from '../../src/p300/phase-a-horizon-recorder-v2';
import {
  finalizePhaseAEpisodeEvidenceEnvelope,
  verifyPhaseAEpisodeEvidenceEnvelope,
  type PhaseAQualityCheck,
  type PhaseARawRangePointer,
} from '../../src/p300/phase-a-episode-evidence';

const START = 1_000_000_000n;
const SESSION = 'episode-evidence-session';

function episode(): PhaseAEpisode {
  const startObservation: PhaseADislocationObservation = {
    sessionId: SESSION,
    targetIngestSeq: 3,
    receivedMonoNs: START.toString(),
    receivedAtMs: 1_000,
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
  for (const seconds of PHASE_A_HORIZON_SECONDS) horizonDueMonoNs[`${seconds}s`] = (START + BigInt(seconds) * 1_000_000_000n).toString();
  return Object.freeze({
    episodeId: `${SESSION}:3:${START}`,
    sessionId: SESSION,
    startMonoNs: START.toString(),
    endMonoNs: (START + 60_000_000_000n).toString(),
    startObservation,
    horizonDueMonoNs: Object.freeze(horizonDueMonoNs),
  });
}

function horizons(ep = episode()): PhaseAHorizonOutcome[] {
  return PHASE_A_HORIZON_SECONDS.map((seconds, index) => ({
    episodeId: ep.episodeId,
    sessionId: ep.sessionId,
    horizonSeconds: seconds,
    dueMonoNs: ep.horizonDueMonoNs[`${seconds}s`],
    sealedAtMonoNs: ep.horizonDueMonoNs[`${seconds}s`],
    cutoffIngestSeq: 10 + index,
    status: 'observed' as const,
    targetReceivedMonoNs: ep.horizonDueMonoNs[`${seconds}s`],
    referenceReceivedMonoNs: Object.freeze([ep.horizonDueMonoNs[`${seconds}s`], ep.horizonDueMonoNs[`${seconds}s`]]),
    targetMid: 98 + index * 0.2,
    referenceMid: 100,
    deviationBps: -200 + index * 20,
    absoluteDeviationBps: 200 - index * 20,
    grossConvergenceBps: index * 20,
    targetReturnBps: index * 20,
    referenceReturnBps: 0,
    referenceDispersionBps: 0,
    referenceReceiveSkewNs: '0',
  }));
}

function rawRanges(): PhaseARawRangePointer[] {
  return [
    { source: 'bitvavo', sessionId: SESSION, artifactId: 'raw/bitvavo.ndjson', sha256: 'a'.repeat(64), firstOffset: 0, lastOffset: 20 },
    { source: 'kraken', sessionId: SESSION, artifactId: 'raw/kraken.ndjson', sha256: 'b'.repeat(64), firstOffset: 0, lastOffset: 20 },
    { source: 'binance', sessionId: SESSION, artifactId: 'raw/binance.ndjson', sha256: 'c'.repeat(64), firstOffset: 0, lastOffset: 20 },
  ];
}

function quality(status: 'pass' | 'fail' = 'pass'): PhaseAQualityCheck[] {
  const names: PhaseAQualityCheck['name'][] = [
    'targetBookContinuity', 'targetTickerBookAgreement', 'marketStatus', 'monotonicClockDomain',
    'sourceFreshness', 'referenceDispersion', 'crossFeedReceiveSkew', 'rawPayloadParse',
    'forwardHorizonCompleteness',
  ];
  return names.map((name) => status === 'pass'
    ? { name, status }
    : { name, status, reason: 'fixture failure' });
}

function finalize(overrides: Partial<Parameters<typeof finalizePhaseAEpisodeEvidenceEnvelope>[0]> = {}) {
  const ep = episode();
  return finalizePhaseAEpisodeEvidenceEnvelope({
    cohortId: 'bitvavo-btc-usdc-direct-usdc-v1',
    collectorCommitSha: '0'.repeat(40),
    configHash: hashPhaseAConfig({ triggerBps: 10, horizons: PHASE_A_HORIZON_SECONDS }),
    createdAtUtc: '2026-09-13T13:45:00.000Z',
    episode: ep,
    horizons: horizons(ep),
    rawRanges: rawRanges(),
    qualityChecks: quality(),
    ...overrides,
  });
}

test('complete causal episode evidence finalizes as sample-eligible and verifies semantically', () => {
  const envelope = finalize();
  assert.equal(envelope.kind, 'underpriced_episode');
  assert.equal(envelope.body.sampleEligible, true);
  assert.equal(envelope.body.fillEvidenceStatus, 'not_evaluated_clock_gate');
  assert.equal(envelope.body.horizons.length, 6);
  assert.equal(verifyPhaseAEvidenceEnvelope(envelope), true);
  assert.equal(verifyPhaseAEpisodeEvidenceEnvelope(envelope), true);
  assert.equal(Object.isFrozen(envelope.body), true);
});

test('missing or duplicate preregistered horizons fail closed', () => {
  const ep = episode();
  const missing = horizons(ep).slice(0, 5);
  assert.throws(() => finalize({ episode: ep, horizons: missing }), /exactly six/);

  const duplicate = horizons(ep);
  duplicate[5] = { ...duplicate[4] };
  assert.throws(() => finalize({ episode: ep, horizons: duplicate }), /duplicate horizon/);
});

test('raw evidence must bind all three primary venues to the same clock session', () => {
  assert.throws(() => finalize({ rawRanges: rawRanges().slice(0, 2) }), /exactly one raw range/);
  const mixed = rawRanges();
  mixed[1] = { ...mixed[1], sessionId: 'other-session' };
  assert.throws(() => finalize({ rawRanges: mixed }), /another clock session/);
});

test('quality-rejected horizon cannot be declared forward-complete', () => {
  const ep = episode();
  const outcomes = horizons(ep);
  outcomes[2] = {
    episodeId: ep.episodeId,
    sessionId: ep.sessionId,
    horizonSeconds: 5,
    dueMonoNs: ep.horizonDueMonoNs['5s'],
    sealedAtMonoNs: ep.horizonDueMonoNs['5s'],
    cutoffIngestSeq: 20,
    status: 'quality_rejected',
    targetReceivedMonoNs: ep.horizonDueMonoNs['5s'],
    targetMid: 99,
    failures: Object.freeze([{ code: 'STALE_REFERENCE' as const }]),
  };
  assert.throws(() => finalize({ episode: ep, horizons: outcomes }), /forwardHorizonCompleteness contradicts/);
});

test('a non-PASS quality check archives the episode but makes it ineligible for the valid sample', () => {
  const checks = quality();
  checks[2] = { name: 'marketStatus', status: 'fail', reason: 'market not continuously tradable' };
  const envelope = finalize({ qualityChecks: checks });
  assert.equal(envelope.body.sampleEligible, false);
  assert.equal(verifyPhaseAEpisodeEvidenceEnvelope(envelope), true);
});

test('generic cryptographic validity cannot forge semantic sample eligibility', () => {
  const valid = finalize();
  const forgedBody = { ...valid.body, sampleEligible: false };
  const forged = finalizePhaseAEvidenceEnvelope({
    cohortId: valid.cohortId,
    episodeId: valid.episodeId,
    kind: valid.kind,
    collectorCommitSha: valid.collectorCommitSha,
    configHash: valid.configHash,
    createdAtUtc: valid.createdAtUtc,
    body: forgedBody,
  });
  assert.equal(verifyPhaseAEvidenceEnvelope(forged), true);
  assert.equal(verifyPhaseAEpisodeEvidenceEnvelope(forged as typeof valid), false);
});
