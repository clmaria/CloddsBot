import { createHash } from 'node:crypto';

export type PhaseAEvidenceKind =
  | 'underpriced_episode'
  | 'overpriced_control'
  | 'background_control'
  | 'invalid_episode';

export type PhaseAExchangeEventTimeSemantics =
  | 'trade_execution'
  | 'server_event'
  | 'last_transaction'
  | 'not_available';

export interface PhaseARawEventInput {
  source: string;
  channel: string;
  sessionId: string;
  receivedWallMs: number;
  receivedMonoNs: string;
  rawPayload: string;
  exchangeEventTime?: string | number;
  exchangeEventTimeSemantics: PhaseAExchangeEventTimeSemantics;
}

export interface PhaseARawEventRecord extends PhaseARawEventInput {
  schemaVersion: 'p300.phase-a.raw-event.v1';
  rawPayloadSha256: string;
}

export interface PhaseAEvidenceEnvelopeDraft<TBody extends Record<string, unknown> = Record<string, unknown>> {
  cohortId: string;
  episodeId: string;
  kind: PhaseAEvidenceKind;
  collectorCommitSha: string;
  configHash: string;
  createdAtUtc: string;
  supersedesEpisodeId?: string;
  supersessionReason?: string;
  body: TBody;
}

export interface PhaseAEvidenceEnvelope<TBody extends Record<string, unknown> = Record<string, unknown>>
  extends PhaseAEvidenceEnvelopeDraft<TBody> {
  schemaVersion: 'p300.phase-a.envelope.v1';
  contentHash: string;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function assertMonoNs(value: string, label: string): string {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a precision-safe integer nanosecond string`);
  return value;
}

function assertSha256(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error(`${label} must be a 64-character SHA-256 hex digest`);
  return normalized;
}

function assertCommitSha(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) throw new Error('collectorCommitSha must be a full 40-character Git commit SHA');
  return normalized;
}

function assertUtcIso(value: string): string {
  const normalized = value.trim();
  if (!normalized || !Number.isFinite(Date.parse(normalized))) throw new Error('createdAtUtc must be a valid ISO timestamp');
  if (!normalized.endsWith('Z')) throw new Error('createdAtUtc must be expressed in UTC with a Z suffix');
  return normalized;
}

function assertEvidenceKind(value: unknown): PhaseAEvidenceKind {
  if (
    value !== 'underpriced_episode'
    && value !== 'overpriced_control'
    && value !== 'background_control'
    && value !== 'invalid_episode'
  ) {
    throw new Error('kind is not a supported Phase-A evidence kind');
  }
  return value;
}

function assertExchangeEventTimeSemantics(value: unknown): PhaseAExchangeEventTimeSemantics {
  if (
    value !== 'trade_execution'
    && value !== 'server_event'
    && value !== 'last_transaction'
    && value !== 'not_available'
  ) {
    throw new Error('exchangeEventTimeSemantics is not supported');
  }
  return value;
}

function assertExchangeEventTimeContract(
  semantics: PhaseAExchangeEventTimeSemantics,
  exchangeEventTime: unknown,
): void {
  if (semantics === 'not_available' && exchangeEventTime !== undefined) {
    throw new Error('exchangeEventTime must be absent when semantics are not_available');
  }
  if (semantics !== 'not_available' && exchangeEventTime === undefined) {
    throw new Error('exchangeEventTime is required when exchange event-time semantics are declared');
  }
  if (typeof exchangeEventTime === 'number' && !Number.isFinite(exchangeEventTime)) {
    throw new Error('numeric exchangeEventTime must be finite');
  }
  if (typeof exchangeEventTime === 'string' && !exchangeEventTime.trim()) {
    throw new Error('string exchangeEventTime cannot be empty');
  }
  if (exchangeEventTime !== undefined && typeof exchangeEventTime !== 'number' && typeof exchangeEventTime !== 'string') {
    throw new Error('exchangeEventTime must be a string or finite number when present');
  }
}

function assertSupersessionPair(supersedesEpisodeId: unknown, supersessionReason: unknown): void {
  if (supersedesEpisodeId !== undefined && (typeof supersedesEpisodeId !== 'string' || !supersedesEpisodeId.trim())) {
    throw new Error('supersedesEpisodeId cannot be empty');
  }
  if (supersessionReason !== undefined && (typeof supersessionReason !== 'string' || !supersessionReason.trim())) {
    throw new Error('supersessionReason cannot be empty');
  }
  if ((supersedesEpisodeId === undefined) !== (supersessionReason === undefined)) {
    throw new Error('supersedesEpisodeId and supersessionReason must be provided together');
  }
}

function canonicalize(value: unknown, seen: WeakSet<object>, path: string): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') throw new Error(`${path} contains bigint; store precision-sensitive integers as decimal strings`);
  if (typeof value === 'undefined') throw new Error(`${path} contains undefined`);
  if (typeof value === 'function' || typeof value === 'symbol') throw new Error(`${path} is not JSON-safe`);
  if (typeof value !== 'object') throw new Error(`${path} is not JSON-safe`);

  if (seen.has(value)) throw new Error(`${path} contains a circular reference`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item, index) => canonicalize(item, seen, `${path}[${index}]`)).join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} must contain only plain JSON objects`);
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key], seen, `${path}.${key}`)}`).join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

/** Deterministic JSON used for config/evidence hashing and NDJSON records. */
export function canonicalPhaseAJson(value: unknown): string {
  return canonicalize(value, new WeakSet<object>(), '$');
}

function assertNoForbiddenEvidenceKeys(value: unknown, path = '$'): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenEvidenceKeys(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'predictedEdge') throw new Error(`${path}.${key} is forbidden in Phase A evidence`);
    if (key === 'contentHash') throw new Error(`${path}.${key} is reserved for finalized envelope integrity`);
    assertNoForbiddenEvidenceKeys(child, `${path}.${key}`);
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === 'object') {
    const object = value as object;
    if (seen.has(object)) return value;
    seen.add(object);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
    Object.freeze(object);
  }
  return value;
}

export function hashPhaseAConfig(config: Record<string, unknown>): string {
  assertNoForbiddenEvidenceKeys(config);
  return sha256Hex(canonicalPhaseAJson(config));
}

export function createPhaseARawEventRecord(input: PhaseARawEventInput): PhaseARawEventRecord {
  const source = assertText(input.source, 'source');
  const channel = assertText(input.channel, 'channel');
  const sessionId = assertText(input.sessionId, 'sessionId');
  if (!Number.isFinite(input.receivedWallMs)) throw new Error('receivedWallMs must be finite');
  const receivedMonoNs = assertMonoNs(input.receivedMonoNs, 'receivedMonoNs');
  if (typeof input.rawPayload !== 'string' || !input.rawPayload.length) throw new Error('rawPayload is required');
  const exchangeEventTimeSemantics = assertExchangeEventTimeSemantics(input.exchangeEventTimeSemantics);
  assertExchangeEventTimeContract(exchangeEventTimeSemantics, input.exchangeEventTime);

  const record: PhaseARawEventRecord = {
    schemaVersion: 'p300.phase-a.raw-event.v1',
    source,
    channel,
    sessionId,
    receivedWallMs: input.receivedWallMs,
    receivedMonoNs,
    rawPayload: input.rawPayload,
    exchangeEventTimeSemantics,
    rawPayloadSha256: sha256Hex(input.rawPayload),
    ...(input.exchangeEventTime !== undefined ? { exchangeEventTime: input.exchangeEventTime } : {}),
  };
  return deepFreeze(record);
}

export function verifyPhaseARawEventRecord(record: PhaseARawEventRecord): boolean {
  try {
    if (record.schemaVersion !== 'p300.phase-a.raw-event.v1') return false;
    assertText(record.source, 'source');
    assertText(record.channel, 'channel');
    assertText(record.sessionId, 'sessionId');
    if (!Number.isFinite(record.receivedWallMs)) return false;
    assertMonoNs(record.receivedMonoNs, 'receivedMonoNs');
    if (typeof record.rawPayload !== 'string' || !record.rawPayload.length) return false;
    const semantics = assertExchangeEventTimeSemantics(record.exchangeEventTimeSemantics);
    assertExchangeEventTimeContract(semantics, record.exchangeEventTime);
    const expected = sha256Hex(record.rawPayload);
    if (assertSha256(record.rawPayloadSha256, 'rawPayloadSha256') !== expected) return false;
    canonicalPhaseAJson(record);
    return true;
  } catch {
    return false;
  }
}

export function encodePhaseARawEventNdjson(record: PhaseARawEventRecord): string {
  if (!verifyPhaseARawEventRecord(record)) throw new Error('raw Phase-A event failed integrity validation');
  return `${canonicalPhaseAJson(record)}\n`;
}

export function finalizePhaseAEvidenceEnvelope<TBody extends Record<string, unknown>>(
  draft: PhaseAEvidenceEnvelopeDraft<TBody>,
): PhaseAEvidenceEnvelope<TBody> {
  assertNoForbiddenEvidenceKeys(draft);
  const cohortId = assertText(draft.cohortId, 'cohortId');
  const episodeId = assertText(draft.episodeId, 'episodeId');
  const kind = assertEvidenceKind(draft.kind);
  const collectorCommitSha = assertCommitSha(draft.collectorCommitSha);
  const configHash = assertSha256(draft.configHash, 'configHash');
  const createdAtUtc = assertUtcIso(draft.createdAtUtc);
  assertSupersessionPair(draft.supersedesEpisodeId, draft.supersessionReason);

  const withoutHash = {
    schemaVersion: 'p300.phase-a.envelope.v1' as const,
    cohortId,
    episodeId,
    kind,
    collectorCommitSha,
    configHash,
    createdAtUtc,
    ...(draft.supersedesEpisodeId !== undefined
      ? { supersedesEpisodeId: draft.supersedesEpisodeId.trim(), supersessionReason: draft.supersessionReason!.trim() }
      : {}),
    body: draft.body,
  };
  const contentHash = sha256Hex(canonicalPhaseAJson(withoutHash));
  return deepFreeze({ ...withoutHash, contentHash }) as PhaseAEvidenceEnvelope<TBody>;
}

export function verifyPhaseAEvidenceEnvelope(envelope: PhaseAEvidenceEnvelope): boolean {
  try {
    const { contentHash, ...withoutHash } = envelope;
    if (withoutHash.schemaVersion !== 'p300.phase-a.envelope.v1') return false;
    assertSha256(contentHash, 'contentHash');
    assertNoForbiddenEvidenceKeys(withoutHash);
    assertText(withoutHash.cohortId, 'cohortId');
    assertText(withoutHash.episodeId, 'episodeId');
    assertEvidenceKind(withoutHash.kind);
    assertCommitSha(withoutHash.collectorCommitSha);
    assertSha256(withoutHash.configHash, 'configHash');
    assertUtcIso(withoutHash.createdAtUtc);
    assertSupersessionPair(withoutHash.supersedesEpisodeId, withoutHash.supersessionReason);
    return sha256Hex(canonicalPhaseAJson(withoutHash)) === contentHash.toLowerCase();
  } catch {
    return false;
  }
}
