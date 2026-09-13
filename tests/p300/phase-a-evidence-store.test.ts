import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  finalizePhaseAEvidenceEnvelope,
  hashPhaseAConfig,
} from '../../src/p300/phase-a-evidence-integrity';
import { PhaseAEvidenceStore } from '../../src/p300/phase-a-evidence-store';

const COMMIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const CONFIG = Object.freeze({
  market: 'BTC-USDC',
  triggerBps: 10,
  horizonsSeconds: Object.freeze([1, 2, 5, 15, 30, 60]),
});

async function withTempStore(
  fn: (root: string, store: PhaseAEvidenceStore) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'p300-phase-a-store-'));
  try {
    const store = await PhaseAEvidenceStore.create({
      rootDir: root,
      cohortId: 'cohort-001',
      collectorCommitSha: COMMIT_SHA,
      frozenConfig: CONFIG,
      configHash: hashPhaseAConfig(CONFIG),
    });
    await fn(root, store);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function rawInput(receivedMonoNs: string, rawPayload: string) {
  return {
    source: 'binance',
    channel: 'websocket',
    sessionId: 'session-001',
    receivedWallMs: Date.UTC(2026, 8, 13, 10, 0, 0),
    receivedMonoNs,
    rawPayload,
    exchangeEventTimeSemantics: 'not_available' as const,
  };
}

test('rejects a frozen config that does not match configHash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'p300-phase-a-store-'));
  try {
    await assert.rejects(
      () => PhaseAEvidenceStore.create({
        rootDir: root,
        cohortId: 'cohort-001',
        collectorCommitSha: COMMIT_SHA,
        frozenConfig: CONFIG,
        configHash: '0'.repeat(64),
      }),
      /does not match configHash/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a cohort directory is non-resumable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'p300-phase-a-store-'));
  try {
    const create = () => PhaseAEvidenceStore.create({
      rootDir: root,
      cohortId: 'cohort-001',
      collectorCommitSha: COMMIT_SHA,
      frozenConfig: CONFIG,
      configHash: hashPhaseAConfig(CONFIG),
    });
    await create();
    await assert.rejects(create, /cannot be resumed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('raw evidence is appended with exact byte and record cursors', async () => {
  await withTempStore(async (root, store) => {
    const first = await store.appendRawEvent(rawInput('1000000000', '{"b":"1"}'));
    const second = await store.appendRawEvent(rawInput('1000000001', '{"b":"2"}'));

    assert.equal(first.range.startByte, 0);
    assert.equal(first.range.startRecord, 1);
    assert.equal(first.range.endRecord, 1);
    assert.equal(second.range.startByte, first.range.endByte);
    assert.equal(second.range.startRecord, 2);
    assert.equal(second.range.endRecord, 2);
    assert.equal(second.range.file, first.range.file);

    const absolute = join(root, 'cohort-001', first.range.file);
    const bytes = await readFile(absolute);
    assert.equal(bytes.byteLength, second.range.endByte);
    const lines = bytes.toString('utf8').trimEnd().split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[0].includes('"rawPayload":"{\\"b\\":\\"1\\"}"'));
    assert.ok(lines[1].includes('"rawPayload":"{\\"b\\":\\"2\\"}"'));

    const index = await readFile(join(root, 'cohort-001', 'raw-index.ndjson'), 'utf8');
    const indexLines = index.trimEnd().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(indexLines.length, 2);
    assert.equal(indexLines[0].startByte, 0);
    assert.equal(indexLines[1].startByte, first.range.endByte);
  });
});

test('concurrent raw appends are serialized into non-overlapping cursors', async () => {
  await withTempStore(async (_root, store) => {
    const [first, second] = await Promise.all([
      store.appendRawEvent(rawInput('1000000000', '{"b":"1"}')),
      store.appendRawEvent(rawInput('1000000001', '{"b":"2"}')),
    ]);
    assert.equal(first.range.startRecord, 1);
    assert.equal(second.range.startRecord, 2);
    assert.equal(first.range.endByte, second.range.startByte);
  });
});

test('envelopes are immutable, cohort-bound, and content-addressed', async () => {
  await withTempStore(async (root, store) => {
    const envelope = finalizePhaseAEvidenceEnvelope({
      cohortId: 'cohort-001',
      episodeId: 'episode-001',
      kind: 'underpriced_episode',
      collectorCommitSha: COMMIT_SHA,
      configHash: hashPhaseAConfig(CONFIG),
      createdAtUtc: '2026-09-13T10:00:00.000Z',
      body: { startMonoNs: '1000000000', status: 'screening' },
    });
    const relativePath = await store.writeEnvelope(envelope);
    assert.equal(relativePath, `episodes/${envelope.contentHash}.json`);
    const stored = await readFile(join(root, 'cohort-001', relativePath), 'utf8');
    assert.ok(stored.includes(envelope.contentHash));

    await assert.rejects(() => store.writeEnvelope(envelope), /EEXIST|file already exists/i);

    const wrongCohort = finalizePhaseAEvidenceEnvelope({
      cohortId: 'cohort-999',
      episodeId: 'episode-002',
      kind: 'underpriced_episode',
      collectorCommitSha: COMMIT_SHA,
      configHash: hashPhaseAConfig(CONFIG),
      createdAtUtc: '2026-09-13T10:01:00.000Z',
      body: { startMonoNs: '1000000000', status: 'screening' },
    });
    await assert.rejects(() => store.writeEnvelope(wrongCohort), /cohortId does not match/);
  });
});

test('finalization rejects raw-file tampering instead of blessing altered evidence', async () => {
  await withTempStore(async (root, store) => {
    const stored = await store.appendRawEvent(rawInput('1000000000', '{"b":"1"}'));
    await writeFile(join(root, 'cohort-001', stored.range.file), 'tampered\n', 'utf8');
    await assert.rejects(
      () => store.finalize('2026-09-13T11:00:00.000Z'),
      /append-only Phase-A evidence file changed/,
    );
  });
});

test('finalization rejects unexpected files injected into the cohort', async () => {
  await withTempStore(async (root, store) => {
    await store.appendRawEvent(rawInput('1000000000', '{"b":"1"}'));
    await writeFile(join(root, 'cohort-001', 'injected.txt'), 'not evidence', 'utf8');
    await assert.rejects(
      () => store.finalize('2026-09-13T11:00:00.000Z'),
      /unexpected file appeared/,
    );
  });
});

test('final manifest hashes all pre-existing evidence files and freezes the store', async () => {
  await withTempStore(async (root, store) => {
    await store.appendRawEvent(rawInput('1000000000', '{"b":"1"}'));
    const envelope = finalizePhaseAEvidenceEnvelope({
      cohortId: 'cohort-001',
      episodeId: 'episode-001',
      kind: 'background_control',
      collectorCommitSha: COMMIT_SHA,
      configHash: hashPhaseAConfig(CONFIG),
      createdAtUtc: '2026-09-13T10:00:00.000Z',
      body: { status: 'control' },
    });
    await store.writeEnvelope(envelope);

    const manifest = await store.finalize('2026-09-13T11:00:00.000Z');
    assert.ok(manifest.files.some((entry) => entry.path === 'cohort.json'));
    assert.ok(manifest.files.some((entry) => entry.path === 'raw-index.ndjson'));
    assert.ok(manifest.files.some((entry) => entry.path === `episodes/${envelope.contentHash}.json`));
    assert.equal(manifest.files.some((entry) => entry.path === 'manifest.json'), false);

    for (const entry of manifest.files) {
      const content = await readFile(join(root, 'cohort-001', entry.path));
      assert.equal(content.byteLength, entry.bytes);
      assert.equal(createHash('sha256').update(content).digest('hex'), entry.sha256);
    }

    await assert.rejects(
      () => store.appendRawEvent(rawInput('1000000001', '{"b":"2"}')),
      /finalized and immutable/,
    );
    await assert.rejects(() => store.writeEnvelope(envelope), /finalized and immutable/);
    await assert.rejects(() => store.finalize('2026-09-13T12:00:00.000Z'), /finalized and immutable/);

    const manifestOnDisk = JSON.parse(await readFile(join(root, 'cohort-001', 'manifest.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(manifestOnDisk.schemaVersion, 'p300.phase-a.store-manifest.v1');
  });
});
