import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import {
  canonicalPhaseAJson,
  createPhaseARawEventRecord,
  encodePhaseARawEventNdjson,
  hashPhaseAConfig,
  verifyPhaseAEvidenceEnvelope,
  type PhaseAEvidenceEnvelope,
  type PhaseARawEventInput,
  type PhaseARawEventRecord,
} from './phase-a-evidence-integrity';

export interface PhaseAEvidenceStoreConfig {
  rootDir: string;
  cohortId: string;
  collectorCommitSha: string;
  frozenConfig: Record<string, unknown>;
  configHash: string;
}

export interface PhaseARawCursorRange {
  file: string;
  startByte: number;
  endByte: number;
  startRecord: number;
  endRecord: number;
  rawPayloadSha256: string;
}

export interface PhaseAStoredRawEvent {
  record: PhaseARawEventRecord;
  range: PhaseARawCursorRange;
}

export interface PhaseAStoreManifestEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface PhaseAEvidenceStoreManifest {
  schemaVersion: 'p300.phase-a.store-manifest.v1';
  cohortId: string;
  collectorCommitSha: string;
  configHash: string;
  finalizedAtUtc: string;
  files: readonly PhaseAStoreManifestEntry[];
}

interface AppendState {
  bytes: number;
  records: number;
}

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertSha256(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error(`${label} must be a 64-character SHA-256 digest`);
  return normalized;
}

function assertCommitSha(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) throw new Error('collectorCommitSha must be a full 40-character Git commit SHA');
  return normalized;
}

function assertSafePathSegment(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(normalized) || normalized === '.' || normalized === '..') {
    throw new Error(`${label} must be a non-empty path-safe identifier`);
  }
  return normalized;
}

function assertUtcIso(value: string): string {
  const normalized = value.trim();
  if (!normalized.endsWith('Z') || !Number.isFinite(Date.parse(normalized))) {
    throw new Error('finalizedAtUtc must be a valid UTC ISO timestamp');
  }
  return normalized;
}

function auditDay(receivedWallMs: number): string {
  if (!Number.isFinite(receivedWallMs)) throw new Error('receivedWallMs must be finite');
  const date = new Date(receivedWallMs);
  if (!Number.isFinite(date.getTime())) throw new Error('receivedWallMs is outside the supported date range');
  return date.toISOString().slice(0, 10);
}

function normalizeRelativePath(value: string): string {
  return value.split(sep).join('/');
}

async function listFilesRecursively(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const output: string[] = [];
  for (const entry of entries) {
    const absolute = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      output.push(...await listFilesRecursively(rootDir, absolute));
    } else if (entry.isFile()) {
      output.push(normalizeRelativePath(relative(rootDir, absolute)));
    } else {
      throw new Error(`unsupported evidence-store filesystem entry: ${entry.name}`);
    }
  }
  return output.sort();
}

/**
 * Append-only, non-resumable Phase-A evidence store.
 *
 * A cohort directory is created exclusively and can never be reopened by this
 * class. Raw market payloads are appended as canonical NDJSON, envelopes are
 * immutable content-addressed JSON files, and finalization writes a manifest
 * that hashes every pre-existing cohort/raw/episode file. No database, queue,
 * credential or execution capability is present here.
 */
export class PhaseAEvidenceStore {
  readonly cohortDir: string;
  readonly cohortId: string;
  readonly collectorCommitSha: string;
  readonly configHash: string;

  private readonly appendState = new Map<string, AppendState>();
  private mutationTail: Promise<void> = Promise.resolve();
  private finalized = false;

  private constructor(
    private readonly rootDir: string,
    cohortId: string,
    collectorCommitSha: string,
    configHash: string,
  ) {
    this.cohortId = cohortId;
    this.collectorCommitSha = collectorCommitSha;
    this.configHash = configHash;
    this.cohortDir = join(rootDir, cohortId);
  }

  static async create(config: PhaseAEvidenceStoreConfig): Promise<PhaseAEvidenceStore> {
    const rootDir = config.rootDir.trim();
    if (!rootDir) throw new Error('rootDir is required');
    const cohortId = assertSafePathSegment(config.cohortId, 'cohortId');
    const collectorCommitSha = assertCommitSha(config.collectorCommitSha);
    const configHash = assertSha256(config.configHash, 'configHash');
    const computedConfigHash = hashPhaseAConfig(config.frozenConfig);
    if (computedConfigHash !== configHash) throw new Error('frozenConfig does not match configHash');

    await mkdir(rootDir, { recursive: true });
    const store = new PhaseAEvidenceStore(rootDir, cohortId, collectorCommitSha, configHash);
    try {
      await mkdir(store.cohortDir, { recursive: false });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') throw new Error(`Phase-A cohort already exists and cannot be resumed: ${cohortId}`);
      throw error;
    }

    const cohortRecord = {
      schemaVersion: 'p300.phase-a.cohort.v1' as const,
      cohortId,
      collectorCommitSha,
      configHash,
      frozenConfig: config.frozenConfig,
    };
    await writeFile(
      join(store.cohortDir, 'cohort.json'),
      `${canonicalPhaseAJson(cohortRecord)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    return store;
  }

  async appendRawEvent(input: PhaseARawEventInput): Promise<PhaseAStoredRawEvent> {
    return this.serialized(async () => {
      this.assertMutable();
      const record = createPhaseARawEventRecord(input);
      const source = assertSafePathSegment(record.source, 'raw source');
      const sessionId = assertSafePathSegment(record.sessionId, 'raw sessionId');
      const channel = assertSafePathSegment(record.channel, 'raw channel');
      const day = auditDay(record.receivedWallMs);
      const relativePath = normalizeRelativePath(join('raw', source, sessionId, day, `${channel}.ndjson`));
      const encoded = encodePhaseARawEventNdjson(record);
      const range = await this.appendCanonicalRecord(relativePath, encoded, record.rawPayloadSha256);

      const indexEntry = {
        schemaVersion: 'p300.phase-a.raw-cursor.v1' as const,
        source: record.source,
        channel: record.channel,
        sessionId: record.sessionId,
        receivedMonoNs: record.receivedMonoNs,
        receivedWallMs: record.receivedWallMs,
        ...range,
      };
      await this.appendText('raw-index.ndjson', `${canonicalPhaseAJson(indexEntry)}\n`);
      return Object.freeze({ record, range: Object.freeze(range) });
    });
  }

  async writeEnvelope(envelope: PhaseAEvidenceEnvelope): Promise<string> {
    return this.serialized(async () => {
      this.assertMutable();
      if (!verifyPhaseAEvidenceEnvelope(envelope)) throw new Error('Phase-A envelope failed integrity validation');
      if (envelope.collectorCommitSha !== this.collectorCommitSha) {
        throw new Error('envelope collectorCommitSha does not match the cohort');
      }
      if (envelope.configHash !== this.configHash) throw new Error('envelope configHash does not match the cohort');
      if (envelope.cohortId !== this.cohortId) throw new Error('envelope cohortId does not match the store');

      const relativePath = normalizeRelativePath(join('episodes', `${envelope.contentHash}.json`));
      const absolute = this.absolutePath(relativePath);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, `${canonicalPhaseAJson(envelope)}\n`, { encoding: 'utf8', flag: 'wx' });
      return relativePath;
    });
  }

  async finalize(finalizedAtUtc = new Date().toISOString()): Promise<PhaseAEvidenceStoreManifest> {
    return this.serialized(async () => {
      this.assertMutable();
      const finalizedAt = assertUtcIso(finalizedAtUtc);
      const files = (await listFilesRecursively(this.cohortDir))
        .filter((path) => path !== 'manifest.json');
      const entries: PhaseAStoreManifestEntry[] = [];
      for (const path of files) {
        const absolute = this.absolutePath(path);
        const bytes = await readFile(absolute);
        const metadata = await stat(absolute);
        if (!metadata.isFile()) throw new Error(`manifest entry is not a regular file: ${path}`);
        entries.push(Object.freeze({ path, bytes: bytes.byteLength, sha256: sha256Hex(bytes) }));
      }
      entries.sort((a, b) => a.path.localeCompare(b.path));
      const manifest: PhaseAEvidenceStoreManifest = Object.freeze({
        schemaVersion: 'p300.phase-a.store-manifest.v1',
        cohortId: this.cohortId,
        collectorCommitSha: this.collectorCommitSha,
        configHash: this.configHash,
        finalizedAtUtc: finalizedAt,
        files: Object.freeze(entries),
      });
      await writeFile(
        join(this.cohortDir, 'manifest.json'),
        `${canonicalPhaseAJson(manifest)}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
      this.finalized = true;
      return manifest;
    });
  }

  private async appendCanonicalRecord(
    relativePath: string,
    encoded: string,
    rawPayloadSha256: string,
  ): Promise<PhaseARawCursorRange> {
    const state = this.appendState.get(relativePath) ?? { bytes: 0, records: 0 };
    const encodedBytes = Buffer.byteLength(encoded, 'utf8');
    const range: PhaseARawCursorRange = {
      file: relativePath,
      startByte: state.bytes,
      endByte: state.bytes + encodedBytes,
      startRecord: state.records + 1,
      endRecord: state.records + 1,
      rawPayloadSha256,
    };
    await this.appendText(relativePath, encoded, state.records === 0);
    this.appendState.set(relativePath, { bytes: range.endByte, records: range.endRecord });
    return range;
  }

  private async appendText(relativePath: string, content: string, firstWrite = false): Promise<void> {
    const absolute = this.absolutePath(relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    await appendFile(absolute, content, { encoding: 'utf8', flag: firstWrite ? 'ax' : 'a' });
  }

  private absolutePath(relativePath: string): string {
    const absolute = join(this.cohortDir, relativePath);
    const rel = relative(this.cohortDir, absolute);
    if (!rel || rel.startsWith('..') || rel.includes(`${sep}..${sep}`)) {
      throw new Error('evidence path escaped the cohort directory');
    }
    return absolute;
  }

  private assertMutable(): void {
    if (this.finalized) throw new Error('Phase-A evidence store is finalized and immutable');
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
