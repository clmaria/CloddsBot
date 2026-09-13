export interface CausalMarketStream {
  venue: string;
  symbol: string;
}

export interface CausalMarketEventInput extends CausalMarketStream {
  bid: number;
  ask: number;
  /** Same-process monotonic receive clock. This is the causal clock. */
  receivedMonoNs: string;
  /** Wall clock retained for audit only; it is never used for causal eligibility. */
  receivedAtMs: number;
  /** Exchange/source time retained as provenance only. */
  sourceObservedAtMs?: number;
  /** Exchange/source sequence retained as provenance only. */
  sourceSequence?: number | string;
}

export interface CausalMarketEvent extends CausalMarketEventInput {
  /** Process/session epoch that owns the monotonic clock domain. */
  sessionId: string;
  /** Global session-local ingest order used to disambiguate equal monotonic timestamps. */
  ingestSeq: number;
  mid: number;
}

export interface CausalMarketBufferConfig {
  sessionId: string;
  target: CausalMarketStream;
  references: CausalMarketStream[];
  maxHistoryPerStream: number;
  maxReferenceAgeMs: number;
  maxReferenceReceiveSkewMs: number;
  maxReferenceDispersionBps: number;
}

export type CausalSnapshotFailureCode =
  | 'MISSING_REFERENCE'
  | 'STALE_REFERENCE'
  | 'REFERENCE_RECEIVE_SKEW_EXCEEDED'
  | 'REFERENCE_DISPERSION_EXCEEDED';

export interface CausalSnapshotFailure {
  code: CausalSnapshotFailureCode;
  stream?: CausalMarketStream;
  detail?: string;
}

export interface CausalSnapshotSuccess {
  ok: true;
  target: CausalMarketEvent;
  references: readonly CausalMarketEvent[];
  referenceMid: number;
  referenceDispersionBps: number;
  referenceReceiveSkewNs: string;
}

export interface CausalSnapshotRejected {
  ok: false;
  target: CausalMarketEvent;
  failures: CausalSnapshotFailure[];
}

export type CausalSnapshot = CausalSnapshotSuccess | CausalSnapshotRejected;

function normalizeText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function normalizeStream(stream: CausalMarketStream, label: string): CausalMarketStream {
  return {
    venue: normalizeText(stream.venue, `${label} venue`),
    symbol: normalizeText(stream.symbol, `${label} symbol`),
  };
}

function streamKey(stream: CausalMarketStream): string {
  return `${stream.venue}\u0000${stream.symbol}`;
}

function assertPositiveFinite(value: number, label: string): void {
  if (!(Number.isFinite(value) && value > 0)) throw new Error(`${label} must be positive and finite`);
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!(Number.isFinite(value) && value >= 0)) throw new Error(`${label} must be non-negative and finite`);
}

function parseMonoNs(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${label} must be a precision-safe integer nanosecond string`);
  }
  return BigInt(value);
}

function msToNs(valueMs: number, label: string): bigint {
  assertNonNegativeFinite(valueMs, label);
  const ns = valueMs * 1_000_000;
  if (!Number.isSafeInteger(ns)) throw new Error(`${label} is too large for safe nanosecond conversion`);
  return BigInt(ns);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function atOrBefore(event: CausalMarketEvent, cutoff: CausalMarketEvent): boolean {
  const eventMono = BigInt(event.receivedMonoNs);
  const cutoffMono = BigInt(cutoff.receivedMonoNs);
  if (eventMono < cutoffMono) return true;
  if (eventMono > cutoffMono) return false;
  return event.ingestSeq <= cutoff.ingestSeq;
}

/**
 * Read-only causal buffer for Phase A research.
 *
 * Eligibility is determined only by the pair (receivedMonoNs, ingestSeq).
 * Wall-clock and exchange timestamps are deliberately provenance-only so a
 * late message can never travel backwards in time and improve an old target.
 */
export class CausalMarketBuffer {
  private sessionIdValue: string;
  private ingestSeqValue = 0;
  private lastReceivedMonoNs?: bigint;
  private readonly target: CausalMarketStream;
  private readonly references: CausalMarketStream[];
  private readonly allowedKeys: Set<string>;
  private readonly histories = new Map<string, CausalMarketEvent[]>();
  private readonly maxHistoryPerStream: number;
  private readonly maxReferenceAgeNs: bigint;
  private readonly maxReferenceReceiveSkewNs: bigint;
  private readonly maxReferenceDispersionBps: number;

  constructor(config: CausalMarketBufferConfig) {
    this.sessionIdValue = normalizeText(config.sessionId, 'sessionId');
    this.target = normalizeStream(config.target, 'target');
    this.references = config.references.map((stream, index) => normalizeStream(stream, `reference ${index}`));

    if (this.references.length < 2) throw new Error('at least two reference streams are required');
    if (!Number.isSafeInteger(config.maxHistoryPerStream) || config.maxHistoryPerStream <= 0) {
      throw new Error('maxHistoryPerStream must be a positive safe integer');
    }
    assertNonNegativeFinite(config.maxReferenceDispersionBps, 'maxReferenceDispersionBps');

    this.maxHistoryPerStream = config.maxHistoryPerStream;
    this.maxReferenceAgeNs = msToNs(config.maxReferenceAgeMs, 'maxReferenceAgeMs');
    this.maxReferenceReceiveSkewNs = msToNs(config.maxReferenceReceiveSkewMs, 'maxReferenceReceiveSkewMs');
    this.maxReferenceDispersionBps = config.maxReferenceDispersionBps;

    const targetKey = streamKey(this.target);
    const referenceKeys = this.references.map(streamKey);
    if (new Set(referenceKeys).size !== referenceKeys.length) throw new Error('reference streams must be unique');
    if (referenceKeys.includes(targetKey)) throw new Error('target stream cannot also be a reference stream');

    this.allowedKeys = new Set([targetKey, ...referenceKeys]);
    for (const key of this.allowedKeys) this.histories.set(key, []);
  }

  get sessionId(): string {
    return this.sessionIdValue;
  }

  get ingestSeq(): number {
    return this.ingestSeqValue;
  }

  ingest(input: CausalMarketEventInput): CausalMarketEvent {
    const stream = normalizeStream(input, 'event');
    const key = streamKey(stream);
    if (!this.allowedKeys.has(key)) throw new Error('event stream is not configured for this causal buffer');

    assertPositiveFinite(input.bid, 'bid');
    assertPositiveFinite(input.ask, 'ask');
    if (input.bid > input.ask) throw new Error('market top of book is crossed');
    if (!Number.isFinite(input.receivedAtMs)) throw new Error('receivedAtMs must be finite');
    if (input.sourceObservedAtMs !== undefined && !Number.isFinite(input.sourceObservedAtMs)) {
      throw new Error('sourceObservedAtMs must be finite when provided');
    }
    if (typeof input.sourceSequence === 'number' && !Number.isSafeInteger(input.sourceSequence)) {
      throw new Error('numeric sourceSequence must be a safe integer');
    }
    if (typeof input.sourceSequence === 'string' && !input.sourceSequence.trim()) {
      throw new Error('string sourceSequence cannot be empty');
    }

    const receivedMono = parseMonoNs(input.receivedMonoNs, 'receivedMonoNs');
    if (this.lastReceivedMonoNs !== undefined && receivedMono < this.lastReceivedMonoNs) {
      throw new Error('monotonic receive clock regressed within the session');
    }
    if (!Number.isSafeInteger(this.ingestSeqValue + 1)) throw new Error('ingest sequence exhausted safe integer range');

    this.ingestSeqValue += 1;
    this.lastReceivedMonoNs = receivedMono;
    const event: CausalMarketEvent = Object.freeze({
      ...input,
      venue: stream.venue,
      symbol: stream.symbol,
      sessionId: this.sessionIdValue,
      ingestSeq: this.ingestSeqValue,
      mid: (input.bid + input.ask) / 2,
    });
    assertPositiveFinite(event.mid, 'derived mid');

    const history = this.histories.get(key)!;
    history.push(event);
    if (history.length > this.maxHistoryPerStream) history.splice(0, history.length - this.maxHistoryPerStream);
    return event;
  }

  snapshotForTarget(target: CausalMarketEvent): CausalSnapshot {
    this.assertTarget(target);
    const selected: CausalMarketEvent[] = [];
    const failures: CausalSnapshotFailure[] = [];
    const targetMono = BigInt(target.receivedMonoNs);

    for (const referenceStream of this.references) {
      const reference = this.latestAt(referenceStream, target);
      if (!reference) {
        failures.push({ code: 'MISSING_REFERENCE', stream: { ...referenceStream } });
        continue;
      }
      const referenceMono = BigInt(reference.receivedMonoNs);
      if (targetMono - referenceMono > this.maxReferenceAgeNs) {
        failures.push({ code: 'STALE_REFERENCE', stream: { ...referenceStream } });
        continue;
      }
      selected.push(reference);
    }

    if (failures.length > 0) return { ok: false, target, failures };

    const receiveTimes = selected.map((event) => BigInt(event.receivedMonoNs));
    const minReceive = receiveTimes.reduce((min, value) => value < min ? value : min);
    const maxReceive = receiveTimes.reduce((max, value) => value > max ? value : max);
    const receiveSkew = maxReceive - minReceive;
    if (receiveSkew > this.maxReferenceReceiveSkewNs) {
      failures.push({
        code: 'REFERENCE_RECEIVE_SKEW_EXCEEDED',
        detail: `reference receive skew ${receiveSkew.toString()}ns exceeds configured maximum`,
      });
    }

    const mids = selected.map((event) => event.mid);
    const referenceMid = median(mids);
    assertPositiveFinite(referenceMid, 'referenceMid');
    const minMid = Math.min(...mids);
    const maxMid = Math.max(...mids);
    const dispersionBps = ((maxMid - minMid) / referenceMid) * 10_000;
    if (!Number.isFinite(dispersionBps) || dispersionBps < 0) throw new Error('derived reference dispersion is invalid');
    if (dispersionBps > this.maxReferenceDispersionBps) {
      failures.push({
        code: 'REFERENCE_DISPERSION_EXCEEDED',
        detail: `reference dispersion ${dispersionBps}bps exceeds configured maximum`,
      });
    }

    if (failures.length > 0) return { ok: false, target, failures };
    return {
      ok: true,
      target,
      references: Object.freeze([...selected]),
      referenceMid,
      referenceDispersionBps: dispersionBps,
      referenceReceiveSkewNs: receiveSkew.toString(),
    };
  }

  historySize(stream: CausalMarketStream): number {
    const normalized = normalizeStream(stream, 'stream');
    const key = streamKey(normalized);
    const history = this.histories.get(key);
    if (!history) throw new Error('stream is not configured for this causal buffer');
    return history.length;
  }

  resetSession(newSessionId: string): void {
    const normalized = normalizeText(newSessionId, 'newSessionId');
    if (normalized === this.sessionIdValue) throw new Error('newSessionId must identify a new clock domain');
    this.sessionIdValue = normalized;
    this.ingestSeqValue = 0;
    this.lastReceivedMonoNs = undefined;
    for (const history of this.histories.values()) history.length = 0;
  }

  private latestAt(stream: CausalMarketStream, cutoff: CausalMarketEvent): CausalMarketEvent | undefined {
    const history = this.histories.get(streamKey(stream));
    if (!history) return undefined;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const event = history[index];
      if (event.sessionId === cutoff.sessionId && atOrBefore(event, cutoff)) return event;
    }
    return undefined;
  }

  private assertTarget(target: CausalMarketEvent): void {
    if (target.sessionId !== this.sessionIdValue) throw new Error('target belongs to a different clock session');
    if (streamKey(target) !== streamKey(this.target)) throw new Error('snapshot target does not match configured target stream');
    parseMonoNs(target.receivedMonoNs, 'target receivedMonoNs');
    if (!Number.isSafeInteger(target.ingestSeq) || target.ingestSeq <= 0 || target.ingestSeq > this.ingestSeqValue) {
      throw new Error('target ingest sequence is outside the current session');
    }
    const targetHistory = this.histories.get(streamKey(this.target));
    if (!targetHistory?.some((event) => event === target)) {
      throw new Error('target was not ingested or is no longer retained by this causal buffer');
    }
  }
}
