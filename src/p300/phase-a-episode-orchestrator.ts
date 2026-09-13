import {
  buildPhaseADislocationObservation,
  PhaseAEpisodeDetector,
  type PhaseAEpisode,
  type PhaseAEpisodeDetectorEvent,
} from './phase-a-episode-detector';
import {
  finalizePhaseAEvidenceEnvelope,
  type PhaseAEvidenceEnvelope,
  type PhaseAEvidenceKind,
} from './phase-a-evidence-integrity';
import {
  PhaseAHorizonRecorder,
  type PhaseAHorizonRecord,
} from './phase-a-horizon-recorder';
import type { PhaseAKeylessRuntimeCoreEvent } from './phase-a-keyless-runtime-core';

export interface PhaseAEvidenceEnvelopeSink {
  readonly cohortId: string;
  readonly collectorCommitSha: string;
  readonly configHash: string;
  writeEnvelope(envelope: PhaseAEvidenceEnvelope): Promise<string>;
}

export interface PhaseAEpisodeEvidenceOrchestratorConfig {
  sessionId: string;
  maxHorizonLatenessMs: number;
  sink: PhaseAEvidenceEnvelopeSink;
  utcNow: () => string;
}

export type PhaseAEpisodeTerminal =
  | { status: 'closed'; atMonoNs: string }
  | { status: 'invalidated'; atMonoNs: string; reason: string };

export type PhaseAEpisodeEvidenceOrchestratorEvent =
  | { kind: 'episode_armed'; atMonoNs: string }
  | { kind: 'episode_started'; episodeId: string; startMonoNs: string }
  | { kind: 'episode_closed'; episodeId: string; atMonoNs: string }
  | { kind: 'episode_invalidated'; episodeId: string; atMonoNs: string; reason: string }
  | { kind: 'horizon_resolved'; episodeId: string; record: PhaseAHorizonRecord }
  | { kind: 'envelope_written'; episodeId: string; path: string; contentHash: string };

interface PendingEpisode {
  episode: PhaseAEpisode;
  recorder: PhaseAHorizonRecorder;
  terminal?: PhaseAEpisodeTerminal;
}

function normalizeSessionId(value: string, label = 'sessionId'): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function parseMonoNs(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${label} must be a precision-safe integer nanosecond string`);
  }
  return BigInt(value);
}

function eventMonoNs(event: PhaseAKeylessRuntimeCoreEvent): string | undefined {
  switch (event.kind) {
    case 'reference':
    case 'bitvavo_book_synchronized':
    case 'bitvavo_book_invalidated':
    case 'target_state':
      return event.observedMonoNs;
    case 'bitvavo_snapshot_request':
      return undefined;
  }
}

function evidenceKind(pending: PendingEpisode): PhaseAEvidenceKind {
  if (!pending.terminal) throw new Error('cannot classify a non-terminal episode');
  if (pending.terminal.status === 'invalidated') return 'invalid_episode';
  if (pending.recorder.records.some((record) => record.status === 'invalidated')) return 'invalid_episode';
  if (pending.episode.startObservation.direction === 'underpriced') return 'underpriced_episode';
  if (pending.episode.startObservation.direction === 'overpriced') return 'overpriced_control';
  return 'background_control';
}

/**
 * Phase-A episode/horizon orchestration only.
 *
 * Inputs are already-causal runtime events. This class does not parse feeds,
 * read sockets, choose thresholds, estimate fills, authorize trades, or submit
 * orders. It composes the preregistered detector + horizon recorder and emits a
 * single immutable envelope only after an episode is terminal and every frozen
 * horizon has an explicit outcome.
 */
export class PhaseAEpisodeEvidenceOrchestrator {
  private sessionIdValue: string;
  private readonly maxHorizonLatenessMs: number;
  private readonly sink: PhaseAEvidenceEnvelopeSink;
  private readonly utcNow: () => string;
  private readonly detector: PhaseAEpisodeDetector;
  private readonly pending = new Map<string, PendingEpisode>();
  private lastMonoNs?: bigint;

  constructor(config: PhaseAEpisodeEvidenceOrchestratorConfig) {
    this.sessionIdValue = normalizeSessionId(config.sessionId);
    if (!(Number.isFinite(config.maxHorizonLatenessMs) && config.maxHorizonLatenessMs >= 0)) {
      throw new Error('maxHorizonLatenessMs must be non-negative and finite');
    }
    const latenessNs = config.maxHorizonLatenessMs * 1_000_000;
    if (!Number.isSafeInteger(latenessNs) || latenessNs >= 1_000_000_000) {
      throw new Error('maxHorizonLatenessMs must be safely representable and less than one second');
    }
    this.maxHorizonLatenessMs = config.maxHorizonLatenessMs;
    this.sink = config.sink;
    this.utcNow = config.utcNow;
    this.detector = new PhaseAEpisodeDetector(this.sessionIdValue);
  }

  get sessionId(): string {
    return this.sessionIdValue;
  }

  get pendingEpisodeCount(): number {
    return this.pending.size;
  }

  async handleRuntimeEvent(
    event: PhaseAKeylessRuntimeCoreEvent,
  ): Promise<readonly PhaseAEpisodeEvidenceOrchestratorEvent[]> {
    const mono = eventMonoNs(event);
    if (mono === undefined) return Object.freeze([]);
    this.observeClock(mono);
    const output: PhaseAEpisodeEvidenceOrchestratorEvent[] = [];

    if (event.kind === 'bitvavo_book_invalidated') {
      return this.invalidateSession(event.observedMonoNs, event.reason);
    }

    if (event.kind === 'target_state') {
      for (const pending of this.pending.values()) {
        const records = pending.recorder.observe({
          observedMonoNs: event.observedMonoNs,
          alignment: event.alignment,
          snapshotResult: event.snapshotResult,
        });
        this.pushHorizonEvents(output, pending.episode.episodeId, records);
      }

      if (event.signalCandidate && event.alignment.status === 'aligned') {
        if (!event.snapshotResult) throw new Error('signalCandidate aligned target requires snapshotResult');
        if (event.snapshotResult.snapshot.ok) {
          this.handleDetectorEvents(
            this.detector.observe(buildPhaseADislocationObservation(event.snapshotResult)),
            output,
          );
        } else {
          this.handleDetectorEvents(this.detector.advanceClock(event.observedMonoNs), output);
        }
      } else {
        this.handleDetectorEvents(this.detector.advanceClock(event.observedMonoNs), output);
      }
    } else {
      this.advanceRecorders(mono, output);
      this.handleDetectorEvents(this.detector.advanceClock(mono), output);
    }

    await this.flushFinalizable(output);
    return Object.freeze(output);
  }

  /** Same-process heartbeat for quiet markets; it never invents target state. */
  async advanceClock(nowMonoNs: string): Promise<readonly PhaseAEpisodeEvidenceOrchestratorEvent[]> {
    this.observeClock(nowMonoNs);
    const output: PhaseAEpisodeEvidenceOrchestratorEvent[] = [];
    this.advanceRecorders(nowMonoNs, output);
    this.handleDetectorEvents(this.detector.advanceClock(nowMonoNs), output);
    await this.flushFinalizable(output);
    return Object.freeze(output);
  }

  /**
   * Invalidate unresolved evidence at a same-process monotonic instant. The
   * caller must stamp a transport-level failure with the same clock function
   * used by the public transport; no exchange or wall-clock time belongs here.
   */
  async invalidateSession(
    atMonoNs: string,
    reasonInput: string,
  ): Promise<readonly PhaseAEpisodeEvidenceOrchestratorEvent[]> {
    this.observeClock(atMonoNs);
    const reason = reasonInput.trim();
    if (!reason) throw new Error('session invalidation reason is required');
    const output: PhaseAEpisodeEvidenceOrchestratorEvent[] = [];

    this.handleDetectorEvents(this.detector.invalidate(atMonoNs, reason), output);
    for (const pending of this.pending.values()) {
      if (!pending.recorder.complete) {
        const records = pending.recorder.invalidate(atMonoNs, reason);
        this.pushHorizonEvents(output, pending.episode.episodeId, records);
      }
      if (!pending.terminal) {
        pending.terminal = { status: 'invalidated', atMonoNs, reason };
        output.push({
          kind: 'episode_invalidated',
          episodeId: pending.episode.episodeId,
          atMonoNs,
          reason,
        });
      }
    }

    await this.flushFinalizable(output);
    return Object.freeze(output);
  }

  /** New monotonic clock domain; old unresolved evidence must be sealed first. */
  resetSession(newSessionIdInput: string): void {
    const newSessionId = normalizeSessionId(newSessionIdInput, 'newSessionId');
    if (newSessionId === this.sessionIdValue) throw new Error('newSessionId must identify a new clock domain');
    if (this.pending.size > 0) {
      throw new Error('cannot reset Phase-A evidence session while episodes remain unresolved or unpersisted');
    }
    this.detector.resetSession(newSessionId);
    this.sessionIdValue = newSessionId;
    this.lastMonoNs = undefined;
  }

  private observeClock(value: string): bigint {
    const mono = parseMonoNs(value, 'orchestrator monotonic time');
    if (this.lastMonoNs !== undefined && mono < this.lastMonoNs) {
      throw new Error('Phase-A episode orchestrator monotonic clock regressed');
    }
    this.lastMonoNs = mono;
    return mono;
  }

  private advanceRecorders(
    nowMonoNs: string,
    output: PhaseAEpisodeEvidenceOrchestratorEvent[],
  ): void {
    for (const pending of this.pending.values()) {
      const records = pending.recorder.advanceClock(nowMonoNs);
      this.pushHorizonEvents(output, pending.episode.episodeId, records);
    }
  }

  private handleDetectorEvents(
    events: readonly PhaseAEpisodeDetectorEvent[],
    output: PhaseAEpisodeEvidenceOrchestratorEvent[],
  ): void {
    for (const event of events) {
      if (event.type === 'armed') {
        output.push({ kind: 'episode_armed', atMonoNs: event.atMonoNs });
        continue;
      }

      if (event.type === 'started') {
        if (this.pending.has(event.episode.episodeId)) throw new Error('duplicate Phase-A episode id');
        this.pending.set(event.episode.episodeId, {
          episode: event.episode,
          recorder: new PhaseAHorizonRecorder(event.episode, {
            maxHorizonLatenessMs: this.maxHorizonLatenessMs,
          }),
        });
        output.push({
          kind: 'episode_started',
          episodeId: event.episode.episodeId,
          startMonoNs: event.episode.startMonoNs,
        });
        continue;
      }

      const pending = this.pending.get(event.episode.episodeId);
      if (!pending) throw new Error(`detector emitted terminal state for unknown episode: ${event.episode.episodeId}`);
      if (pending.terminal) throw new Error(`episode already has terminal state: ${event.episode.episodeId}`);

      if (event.type === 'closed') {
        pending.terminal = { status: 'closed', atMonoNs: event.closedAtMonoNs };
        output.push({ kind: 'episode_closed', episodeId: event.episode.episodeId, atMonoNs: event.closedAtMonoNs });
      } else {
        pending.terminal = { status: 'invalidated', atMonoNs: event.atMonoNs, reason: event.reason };
        output.push({
          kind: 'episode_invalidated',
          episodeId: event.episode.episodeId,
          atMonoNs: event.atMonoNs,
          reason: event.reason,
        });
      }
    }
  }

  private pushHorizonEvents(
    output: PhaseAEpisodeEvidenceOrchestratorEvent[],
    episodeId: string,
    records: readonly PhaseAHorizonRecord[],
  ): void {
    for (const record of records) output.push({ kind: 'horizon_resolved', episodeId, record });
  }

  private async flushFinalizable(output: PhaseAEpisodeEvidenceOrchestratorEvent[]): Promise<void> {
    for (const [episodeId, pending] of [...this.pending.entries()]) {
      if (!pending.terminal || !pending.recorder.complete) continue;
      const body = {
        schemaVersion: 'p300.phase-a.episode-evidence.v1' as const,
        episode: pending.episode,
        terminal: pending.terminal,
        horizons: pending.recorder.records,
        fillability: 'not_evaluated' as const,
        executionAuthorized: false as const,
      };
      const envelope = finalizePhaseAEvidenceEnvelope({
        cohortId: this.sink.cohortId,
        episodeId,
        kind: evidenceKind(pending),
        collectorCommitSha: this.sink.collectorCommitSha,
        configHash: this.sink.configHash,
        createdAtUtc: this.utcNow(),
        body,
      });
      const path = await this.sink.writeEnvelope(envelope);
      this.pending.delete(episodeId);
      output.push({ kind: 'envelope_written', episodeId, path, contentHash: envelope.contentHash });
    }
  }
}
