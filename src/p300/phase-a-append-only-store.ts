import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  writeFileSync,
  type WriteStream,
} from 'node:fs';
import { join, resolve } from 'node:path';
import {
  canonicalPhaseAJson,
  createPhaseARawEventRecord,
  encodePhaseARawEventNdjson,
  hashPhaseAConfig,
  verifyPhaseAEvidenceEnvelope,
  type PhaseAEvidenceEnvelope,
} from './phase-a-evidence-integrity';
import type { PhaseAPublicRawMarketData } from './phase-a-public-transport';

export interface PhaseAAppendOnlyStoreConfig {
  rootDir: string;
  cohortId: string;
  runId: string;
  collectorCommitSha: string;
  config: Record<string, unknown>;
  configHash: string;
  createdAtUtc: string;
  rawHighWaterMarkBytes?: number;
  nowUtc?: () => string;
  onFatal?: (error: Error) => void;
}

export interface PhaseARawCursor {
  path: 'raw.ndjson';
  recordIndex: number;
  byteStart: number;
  byteEnd: number;
}

export interface PhaseAStoreManifest {
  schemaVersion: 'p300.phase-a.store-manifest.v1';
  cohortId: string;
  runId: string;
  collectorCommitSha: string;
  configHash: string;
  createdAtUtc: string;
  finalizedAtUtc: string;
  raw: {
    path: 'raw.ndjson';
    records: number;
    bytes: number;
    sha256: string;
  };
  episodes: Array<{
    path: string;
    contentHash: string;
    sha256: string;
  }>;
}

function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertSafeSegment(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized)) {
    throw new Error(`${label} must be a safe path segment`);
  }
  return normalized;
}

function assertSha256(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 hex digest`);
  return normalized;
}

function assertCommitSha(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) throw new Error('collectorCommitSha must be a full 40-character Git SHA');
  return normalized;
}

function assertUtcIso(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized.endsWith('Z') || !Number.isFinite(Date.parse(normalized))) {
    throw new Error(`${label} must be a valid UTC ISO timestamp`);
  }
  return normalized;
}

function validateHighWaterMark(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_024 || value > 64 * 1024 * 1024) {
    throw new Error('rawHighWaterMarkBytes must be a safe integer between 1 KiB and 64 MiB');
  }
  return value;
}

/**
 * Minimal non-resumable store for Phase-A evidence.
 *
 * The hot path uses a Node WriteStream rather than synchronous per-message disk
 * writes. A false `write()` return is treated as a fatal backpressure condition:
 * collection must stop and the run can never produce a valid manifest.
 *
 * Cursors describe queued byte/record positions and become durable evidence only
 * after `finalize()` succeeds and verifies the raw file size/hash.
 */
export class PhaseAAppendOnlyEvidenceStore {
  readonly runDir: string;
  readonly rawPath: string;

  private readonly cohortId: string;
  private readonly runId: string;
  private readonly collectorCommitSha: string;
  private readonly configHash: string;
  private readonly createdAtUtc: string;
  private readonly nowUtc: () => string;
  private readonly onFatal?: (error: Error) => void;
  private readonly rawStream: WriteStream;
  private readonly episodeFiles: Array<{ path: string; contentHash: string; sha256: string }> = [];

  private rawRecords = 0;
  private rawBytes = 0;
  private fatalError?: Error;
  private finalized = false;
  private finalizing = false;

  constructor(options: PhaseAAppendOnlyStoreConfig) {
    if (!options.rootDir.trim()) throw new Error('rootDir is required');
    this.cohortId = assertSafeSegment(options.cohortId, 'cohortId');
    this.runId = assertSafeSegment(options.runId, 'runId');
    this.collectorCommitSha = assertCommitSha(options.collectorCommitSha);
    this.configHash = assertSha256(options.configHash, 'configHash');
    this.createdAtUtc = assertUtcIso(options.createdAtUtc, 'createdAtUtc');
    this.nowUtc = options.nowUtc ?? (() => new Date().toISOString());
    this.onFatal = options.onFatal;

    const computedConfigHash = hashPhaseAConfig(options.config);
    if (computedConfigHash !== this.configHash) throw new Error('configHash does not match canonical Phase-A config');

    const root = resolve(options.rootDir);
    const cohortDir = join(root, this.cohortId);
    this.runDir = join(cohortDir, this.runId);
    mkdirSync(root, { recursive: true });
    mkdirSync(cohortDir, { recursive: true });
    // No resume: an existing run directory is a hard failure.
    mkdirSync(this.runDir);
    mkdirSync(join(this.runDir, 'episodes'));

    writeFileSync(
      join(this.runDir, 'config.json'),
      `${canonicalPhaseAJson({
        schemaVersion: 'p300.phase-a.store-config.v1',
        cohortId: this.cohortId,
        runId: this.runId,
        collectorCommitSha: this.collectorCommitSha,
        configHash: this.configHash,
        createdAtUtc: this.createdAtUtc,
        config: options.config,
      })}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );

    this.rawPath = join(this.runDir, 'raw.ndjson');
    const highWaterMark = validateHighWaterMark(options.rawHighWaterMarkBytes ?? 1024 * 1024);
    this.rawStream = createWriteStream(this.rawPath, {
      flags: 'wx',
      encoding: 'utf8',
      highWaterMark,
    });
    this.rawStream.on('error', (error) => this.markFatal(error instanceof Error ? error : new Error(String(error))));
  }

  get isHealthy(): boolean {
    return !this.fatalError && !this.finalized && !this.finalizing;
  }

  get rawRecordCount(): number {
    return this.rawRecords;
  }

  appendPublicRaw(event: PhaseAPublicRawMarketData, sessionId: string): PhaseARawCursor {
    this.assertWritable();
    const record = createPhaseARawEventRecord({
      source: event.source,
      channel: event.channel,
      sessionId,
      receivedWallMs: event.stamp.receivedAtMs,
      receivedMonoNs: event.stamp.receivedMonoNs,
      rawPayload: event.rawPayload,
      exchangeEventTimeSemantics: 'not_available',
    });
    const line = encodePhaseARawEventNdjson(record);
    const byteLength = Buffer.byteLength(line, 'utf8');
    const cursor: PhaseARawCursor = {
      path: 'raw.ndjson',
      recordIndex: this.rawRecords,
      byteStart: this.rawBytes,
      byteEnd: this.rawBytes + byteLength,
    };

    // Node accepts the chunk even when write() returns false, but false means
    // the bounded buffer has crossed its high-water mark. For Phase A we stop
    // the cohort rather than let evidence acquisition lag arbitrarily behind.
    const withinBuffer = this.rawStream.write(line, 'utf8');
    this.rawRecords += 1;
    this.rawBytes += byteLength;
    if (!withinBuffer) {
      const error = new Error('raw evidence backpressure exceeded configured high-water mark');
      this.markFatal(error);
      throw error;
    }
    return Object.freeze(cursor);
  }

  writeEnvelope(envelope: PhaseAEvidenceEnvelope): string {
    this.assertWritable();
    if (!verifyPhaseAEvidenceEnvelope(envelope)) throw new Error('Phase-A envelope failed integrity validation');
    if (envelope.cohortId !== this.cohortId) throw new Error('envelope cohortId does not match store cohort');
    if (envelope.collectorCommitSha !== this.collectorCommitSha) {
      throw new Error('envelope collectorCommitSha does not match store collector commit');
    }
    if (envelope.configHash !== this.configHash) throw new Error('envelope configHash does not match store config');

    const relativePath = `episodes/${envelope.contentHash}.json`;
    const content = `${canonicalPhaseAJson(envelope)}\n`;
    writeFileSync(join(this.runDir, relativePath), content, { encoding: 'utf8', flag: 'wx' });
    this.episodeFiles.push({
      path: relativePath,
      contentHash: envelope.contentHash,
      sha256: sha256Hex(content),
    });
    return relativePath;
  }

  async finalize(): Promise<PhaseAStoreManifest> {
    this.assertWritable();
    this.finalizing = true;
    try {
      this.rawStream.end();
      await Promise.race([
        once(this.rawStream, 'finish'),
        once(this.rawStream, 'error').then(([error]) => { throw error; }),
      ]);
      if (this.fatalError) throw this.fatalError;

      const rawBytes = readFileSync(this.rawPath);
      if (rawBytes.byteLength !== this.rawBytes) {
        throw new Error('raw evidence byte count does not match queued evidence');
      }

      const finalizedAtUtc = assertUtcIso(this.nowUtc(), 'finalizedAtUtc');
      const manifest: PhaseAStoreManifest = {
        schemaVersion: 'p300.phase-a.store-manifest.v1',
        cohortId: this.cohortId,
        runId: this.runId,
        collectorCommitSha: this.collectorCommitSha,
        configHash: this.configHash,
        createdAtUtc: this.createdAtUtc,
        finalizedAtUtc,
        raw: {
          path: 'raw.ndjson',
          records: this.rawRecords,
          bytes: this.rawBytes,
          sha256: sha256Hex(rawBytes),
        },
        episodes: [...this.episodeFiles].sort((a, b) => a.path.localeCompare(b.path)),
      };

      writeFileSync(
        join(this.runDir, 'manifest.json'),
        `${canonicalPhaseAJson(manifest)}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
      this.finalized = true;
      return Object.freeze(manifest);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.markFatal(normalized);
      throw normalized;
    } finally {
      this.finalizing = false;
    }
  }

  abort(): void {
    if (this.finalized) throw new Error('cannot abort a finalized Phase-A evidence store');
    if (!this.rawStream.destroyed) this.rawStream.destroy();
    this.markFatal(new Error('Phase-A evidence run aborted before manifest finalization'));
  }

  private assertWritable(): void {
    if (this.finalized) throw new Error('Phase-A evidence store is finalized and immutable');
    if (this.finalizing) throw new Error('Phase-A evidence store is finalizing');
    if (this.fatalError) throw new Error(`Phase-A evidence store is invalid: ${this.fatalError.message}`);
  }

  private markFatal(error: Error): void {
    if (this.fatalError) return;
    this.fatalError = error;
    this.onFatal?.(error);
  }
}
