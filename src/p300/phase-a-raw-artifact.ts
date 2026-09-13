import { createHash } from 'node:crypto';
import {
  encodePhaseARawEventNdjson,
  verifyPhaseARawEventRecord,
  type PhaseARawEventRecord,
} from './phase-a-evidence-integrity';

export interface PhaseARawArtifactDescriptor {
  schemaVersion: 'p300.phase-a.raw-artifact.v1';
  artifactId: string;
  source: string;
  sessionId: string;
  firstRecordOffset: number;
  lastRecordOffset: number;
  recordCount: number;
  byteLength: number;
  sha256: string;
}

export interface PhaseARawArtifact {
  descriptor: PhaseARawArtifactDescriptor;
  ndjson: string;
}

function assertText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Small Phase-A-only append-only assembler. It does not own a filesystem,
 * socket or transport. Records are validated by the existing raw-event
 * integrity authority before being appended as canonical NDJSON.
 */
export class PhaseARawArtifactBuilder {
  private readonly artifactIdValue: string;
  private readonly sourceValue: string;
  private readonly sessionIdValue: string;
  private readonly lines: string[] = [];
  private finalized?: PhaseARawArtifact;

  constructor(artifactId: string, source: string, sessionId: string) {
    this.artifactIdValue = assertText(artifactId, 'artifactId');
    this.sourceValue = assertText(source, 'source');
    this.sessionIdValue = assertText(sessionId, 'sessionId');
  }

  get artifactId(): string { return this.artifactIdValue; }
  get source(): string { return this.sourceValue; }
  get sessionId(): string { return this.sessionIdValue; }
  get recordCount(): number { return this.lines.length; }
  get isFinalized(): boolean { return this.finalized !== undefined; }

  append(record: PhaseARawEventRecord): number {
    if (this.finalized) throw new Error('cannot append to a finalized Phase-A raw artifact');
    if (!verifyPhaseARawEventRecord(record)) throw new Error('raw event failed integrity validation');
    if (record.source !== this.sourceValue) throw new Error('raw event source does not match artifact source');
    if (record.sessionId !== this.sessionIdValue) throw new Error('raw event belongs to a different clock session');
    const offset = this.lines.length;
    this.lines.push(encodePhaseARawEventNdjson(record));
    return offset;
  }

  finalize(): PhaseARawArtifact {
    if (this.finalized) return this.finalized;
    if (!this.lines.length) throw new Error('cannot finalize an empty Phase-A raw artifact');
    const ndjson = this.lines.join('');
    const descriptor: PhaseARawArtifactDescriptor = Object.freeze({
      schemaVersion: 'p300.phase-a.raw-artifact.v1',
      artifactId: this.artifactIdValue,
      source: this.sourceValue,
      sessionId: this.sessionIdValue,
      firstRecordOffset: 0,
      lastRecordOffset: this.lines.length - 1,
      recordCount: this.lines.length,
      byteLength: Buffer.byteLength(ndjson, 'utf8'),
      sha256: sha256Hex(ndjson),
    });
    this.finalized = Object.freeze({ descriptor, ndjson });
    return this.finalized;
  }
}

export function verifyPhaseARawArtifact(artifact: PhaseARawArtifact): boolean {
  try {
    const { descriptor, ndjson } = artifact;
    if (descriptor.schemaVersion !== 'p300.phase-a.raw-artifact.v1') return false;
    if (!descriptor.artifactId.trim() || !descriptor.source.trim() || !descriptor.sessionId.trim()) return false;
    if (!Number.isSafeInteger(descriptor.recordCount) || descriptor.recordCount <= 0) return false;
    if (descriptor.firstRecordOffset !== 0 || descriptor.lastRecordOffset !== descriptor.recordCount - 1) return false;
    if (!Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength !== Buffer.byteLength(ndjson, 'utf8')) return false;
    if (!/^[0-9a-f]{64}$/.test(descriptor.sha256) || descriptor.sha256 !== sha256Hex(ndjson)) return false;

    const lines = ndjson.split('\n');
    if (lines.at(-1) !== '') return false;
    lines.pop();
    if (lines.length !== descriptor.recordCount) return false;
    for (const line of lines) {
      const parsed = JSON.parse(line) as PhaseARawEventRecord;
      if (!verifyPhaseARawEventRecord(parsed)) return false;
      if (parsed.source !== descriptor.source || parsed.sessionId !== descriptor.sessionId) return false;
    }
    return true;
  } catch {
    return false;
  }
}
