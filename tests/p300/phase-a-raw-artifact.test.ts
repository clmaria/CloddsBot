import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhaseARawEventRecord } from '../../src/p300/phase-a-evidence-integrity';
import { PhaseARawArtifactBuilder, verifyPhaseARawArtifact } from '../../src/p300/phase-a-raw-artifact';

function record(source: string, sessionId: string, mono: string, payload: string) {
  return createPhaseARawEventRecord({
    source,
    channel: 'bbo',
    sessionId,
    receivedWallMs: 1,
    receivedMonoNs: mono,
    rawPayload: payload,
    exchangeEventTimeSemantics: 'not_available',
  });
}

test('builds deterministic append-only NDJSON with stable offsets and artifact hash', () => {
  const builder = new PhaseARawArtifactBuilder('raw/kraken/session.ndjson', 'kraken', 'session-1');
  assert.equal(builder.append(record('kraken', 'session-1', '10', '{"x":1}')), 0);
  assert.equal(builder.append(record('kraken', 'session-1', '11', '{"x":2}')), 1);
  const artifact = builder.finalize();

  assert.equal(artifact.descriptor.firstRecordOffset, 0);
  assert.equal(artifact.descriptor.lastRecordOffset, 1);
  assert.equal(artifact.descriptor.recordCount, 2);
  assert.match(artifact.descriptor.sha256, /^[0-9a-f]{64}$/);
  assert.equal(verifyPhaseARawArtifact(artifact), true);
  assert.equal(Object.isFrozen(artifact), true);
  assert.equal(Object.isFrozen(artifact.descriptor), true);
  assert.equal(builder.finalize(), artifact);
});

test('source and monotonic clock session mixing fail closed before append', () => {
  const builder = new PhaseARawArtifactBuilder('raw/bitvavo/session.ndjson', 'bitvavo', 'session-1');
  assert.throws(() => builder.append(record('kraken', 'session-1', '10', '{}')), /source does not match/);
  assert.throws(() => builder.append(record('bitvavo', 'session-2', '10', '{}')), /different clock session/);
  assert.equal(builder.recordCount, 0);
});

test('finalization is one-way and empty artifacts are rejected', () => {
  const empty = new PhaseARawArtifactBuilder('raw/binance/empty.ndjson', 'binance', 'session-1');
  assert.throws(() => empty.finalize(), /empty/);

  const builder = new PhaseARawArtifactBuilder('raw/binance/session.ndjson', 'binance', 'session-1');
  builder.append(record('binance', 'session-1', '10', '{}'));
  builder.finalize();
  assert.throws(() => builder.append(record('binance', 'session-1', '11', '{}')), /finalized/);
});

test('tampered bytes, descriptor hash, offsets or embedded raw-event integrity are rejected', () => {
  const builder = new PhaseARawArtifactBuilder('raw/kraken/session.ndjson', 'kraken', 'session-1');
  builder.append(record('kraken', 'session-1', '10', '{"x":1}'));
  const artifact = builder.finalize();

  assert.equal(verifyPhaseARawArtifact({ ...artifact, ndjson: artifact.ndjson.replace('{\\"x\\":1}', '{\\"x\\":9}') }), false);
  assert.equal(verifyPhaseARawArtifact({
    ...artifact,
    descriptor: { ...artifact.descriptor, sha256: '0'.repeat(64) },
  }), false);
  assert.equal(verifyPhaseARawArtifact({
    ...artifact,
    descriptor: { ...artifact.descriptor, lastRecordOffset: 9 },
  }), false);

  const parsed = JSON.parse(artifact.ndjson.trim());
  parsed.rawPayloadSha256 = '0'.repeat(64);
  const forgedNdjson = `${JSON.stringify(parsed)}\n`;
  const forgedBuilderDescriptor = {
    ...artifact.descriptor,
    byteLength: Buffer.byteLength(forgedNdjson, 'utf8'),
  };
  assert.equal(verifyPhaseARawArtifact({ descriptor: forgedBuilderDescriptor, ndjson: forgedNdjson }), false);
});

test('UTF-8 byte length is measured as bytes rather than JavaScript code units', () => {
  const builder = new PhaseARawArtifactBuilder('raw/bitvavo/utf8.ndjson', 'bitvavo', 'session-1');
  builder.append(record('bitvavo', 'session-1', '10', '{"note":"€"}'));
  const artifact = builder.finalize();
  assert.equal(artifact.descriptor.byteLength, Buffer.byteLength(artifact.ndjson, 'utf8'));
  assert.ok(artifact.descriptor.byteLength > artifact.ndjson.length);
  assert.equal(verifyPhaseARawArtifact(artifact), true);
});
