import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  canonicalPhaseAJson,
  createPhaseARawEventRecord,
  encodePhaseARawEventNdjson,
  finalizePhaseAEvidenceEnvelope,
  hashPhaseAConfig,
  verifyPhaseAEvidenceEnvelope,
  verifyPhaseARawEventRecord,
  type PhaseAEvidenceEnvelope,
} from '../../src/p300/phase-a-evidence-integrity';

test('canonical Phase-A JSON is key-order stable and rejects unsafe numeric representations', () => {
  assert.equal(canonicalPhaseAJson({ b: 2, a: 1 }), canonicalPhaseAJson({ a: 1, b: 2 }));
  assert.throws(() => canonicalPhaseAJson({ bad: Number.NaN }), /non-finite/);
  assert.throws(() => canonicalPhaseAJson({ bad: undefined }), /undefined/);
  assert.throws(() => canonicalPhaseAJson({ bad: 1n }), /decimal strings/);
  assert.throws(() => canonicalPhaseAJson(new Array(1)), /sparse array hole/);
});

test('raw event records preserve exact payload and bind it to a SHA-256 digest', () => {
  const rawPayload = '{"event":"ticker","market":"BTC-USDC","bestBid":"100"}';
  const record = createPhaseARawEventRecord({
    source: 'bitvavo',
    channel: 'ticker',
    sessionId: 'collector-1',
    receivedWallMs: 1_757_757_600_000,
    receivedMonoNs: '1234567890123456789',
    rawPayload,
    exchangeEventTimeSemantics: 'not_available',
  });
  assert.equal(record.rawPayload, rawPayload);
  assert.match(record.rawPayloadSha256, /^[0-9a-f]{64}$/);
  assert.equal(verifyPhaseARawEventRecord(record), true);
  const line = encodePhaseARawEventNdjson(record);
  assert.ok(line.endsWith('\n'));
  assert.deepEqual(JSON.parse(line), record);
  assert.equal(Object.isFrozen(record), true);
});

test('raw event clock semantics cannot claim unavailable exchange time, omit a declared one or invent a semantic type', () => {
  const base = {
    source: 'bitvavo', channel: 'book', sessionId: 'collector-1',
    receivedWallMs: 1, receivedMonoNs: '1', rawPayload: '{}',
  } as const;
  assert.throws(() => createPhaseARawEventRecord({
    ...base, exchangeEventTime: '123', exchangeEventTimeSemantics: 'not_available',
  }), /must be absent/);
  assert.throws(() => createPhaseARawEventRecord({
    ...base, exchangeEventTimeSemantics: 'last_transaction',
  }), /is required/);
  assert.throws(() => createPhaseARawEventRecord({
    ...base, exchangeEventTimeSemantics: 'invented_semantics' as never,
  }), /not supported/);
});

test('forged raw payload digests cannot be emitted as valid NDJSON evidence', () => {
  const record = createPhaseARawEventRecord({
    source: 'bitvavo', channel: 'ticker', sessionId: 'collector-1',
    receivedWallMs: 1, receivedMonoNs: '1', rawPayload: '{"x":1}',
    exchangeEventTimeSemantics: 'not_available',
  });
  const forged = { ...record, rawPayloadSha256: '0'.repeat(64) };
  assert.equal(verifyPhaseARawEventRecord(forged), false);
  assert.throws(() => encodePhaseARawEventNdjson(forged), /integrity validation/);
});

test('config hash is deterministic for semantically identical object key order', () => {
  const left = hashPhaseAConfig({ triggerBps: 10, cohort: { b: 2, a: 1 } });
  const right = hashPhaseAConfig({ cohort: { a: 1, b: 2 }, triggerBps: 10 });
  assert.equal(left, right);
  assert.match(left, /^[0-9a-f]{64}$/);
});

test('finalized evidence is immutable, stable and detects post-finalization tampering', () => {
  const configHash = hashPhaseAConfig({ triggerBps: 10, horizons: [1, 2, 5, 15, 30, 60] });
  const envelope = finalizePhaseAEvidenceEnvelope({
    cohortId: 'bitvavo-btc-usdc-direct-usdc-v1',
    episodeId: 'session-a:3:123',
    kind: 'underpriced_episode',
    collectorCommitSha: '068109fc7ec0e75719445c359ba94f47f0af3b8e',
    configHash,
    createdAtUtc: '2026-09-13T10:00:00.000Z',
    body: {
      direction: 'underpriced',
      deviationBps: -25,
      timing: { receivedMonoNs: '123' },
      horizons: ['1s', '2s', '5s', '15s', '30s', '60s'],
    },
  });
  assert.equal(verifyPhaseAEvidenceEnvelope(envelope), true);
  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.body), true);

  const tampered = JSON.parse(JSON.stringify(envelope)) as PhaseAEvidenceEnvelope;
  (tampered.body as Record<string, unknown>).deviationBps = -5;
  assert.equal(verifyPhaseAEvidenceEnvelope(tampered), false);
});

test('runtime semantic validation rejects an unsupported evidence kind even with a recomputed matching hash', () => {
  const configHash = hashPhaseAConfig({ triggerBps: 10 });
  assert.throws(() => finalizePhaseAEvidenceEnvelope({
    cohortId: 'cohort',
    episodeId: 'episode',
    kind: 'invented_kind' as never,
    collectorCommitSha: '068109fc7ec0e75719445c359ba94f47f0af3b8e',
    configHash,
    createdAtUtc: '2026-09-13T10:00:00.000Z',
    body: { direction: 'control' },
  }), /supported Phase-A evidence kind/);

  const valid = finalizePhaseAEvidenceEnvelope({
    cohortId: 'cohort',
    episodeId: 'episode',
    kind: 'background_control',
    collectorCommitSha: '068109fc7ec0e75719445c359ba94f47f0af3b8e',
    configHash,
    createdAtUtc: '2026-09-13T10:00:00.000Z',
    body: { direction: 'control' },
  });
  const { contentHash: _oldHash, ...withoutHash } = JSON.parse(JSON.stringify(valid)) as PhaseAEvidenceEnvelope;
  const invalidWithoutHash = { ...withoutHash, kind: 'invented_kind' };
  const contentHash = createHash('sha256').update(canonicalPhaseAJson(invalidWithoutHash), 'utf8').digest('hex');
  const forged = { ...invalidWithoutHash, contentHash } as unknown as PhaseAEvidenceEnvelope;
  assert.equal(verifyPhaseAEvidenceEnvelope(forged), false);
});

test('forbidden predictedEdge cannot enter the Phase-A envelope at any nesting depth', () => {
  const configHash = hashPhaseAConfig({ triggerBps: 10 });
  assert.throws(() => finalizePhaseAEvidenceEnvelope({
    cohortId: 'cohort',
    episodeId: 'episode',
    kind: 'underpriced_episode',
    collectorCommitSha: '068109fc7ec0e75719445c359ba94f47f0af3b8e',
    configHash,
    createdAtUtc: '2026-09-13T10:00:00.000Z',
    body: { nested: { predictedEdge: 42 } },
  }), /predictedEdge/);
});

test('supersession requires both the superseded identity and an explicit reason', () => {
  const configHash = hashPhaseAConfig({ triggerBps: 10 });
  const base = {
    cohortId: 'cohort', episodeId: 'episode-2', kind: 'invalid_episode' as const,
    collectorCommitSha: '068109fc7ec0e75719445c359ba94f47f0af3b8e',
    configHash, createdAtUtc: '2026-09-13T10:00:00.000Z', body: { reason: 'raw evidence correction' },
  };
  assert.throws(() => finalizePhaseAEvidenceEnvelope({ ...base, supersedesEpisodeId: 'episode-1' }), /provided together/);
  const corrected = finalizePhaseAEvidenceEnvelope({
    ...base,
    supersedesEpisodeId: 'episode-1',
    supersessionReason: 'source file hash corrected from immutable raw archive',
  });
  assert.equal(verifyPhaseAEvidenceEnvelope(corrected), true);
  assert.equal(corrected.supersedesEpisodeId, 'episode-1');
});
