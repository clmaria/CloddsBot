import type { CausalSnapshotFailure } from './causal-market-buffer';
import type { PhaseATargetSnapshotResult } from './phase-a-collector-core';
import {
  buildPhaseADislocationObservation,
  PHASE_A_HORIZON_SECONDS,
  type PhaseADislocationObservation,
  type PhaseAEpisode,
} from './phase-a-episode-detector';
import type { PhaseATargetAlignmentState } from './phase-a-target-coordinator';

export type PhaseAHorizonSeconds = (typeof PHASE_A_HORIZON_SECONDS)[number];
export type PhaseAHorizonKey = `${PhaseAHorizonSeconds}s`;

export interface PhaseAHorizonRecorderConfig {
  /**
   * Maximum permitted delay between the preregistered horizon deadline and the
   * first new target-alignment observation received afterwards. This value is
   * cohort configuration and must be frozen before representative outcomes are
   * inspected; the recorder deliberately does not choose a default.
   */
  maxHorizonLatenessMs: number;
}

export interface PhaseAHorizonAlignmentObservation {
  /** Same-process monotonic receive time at which this state became observable. */
  observedMonoNs: string;
  alignment: PhaseATargetAlignmentState;
  /** Required only for aligned states; must be the causal collector result for the same actionable target. */
  snapshotResult?: PhaseATargetSnapshotResult;
}

interface PhaseAHorizonRecordBase {
  episodeId: string;
  sessionId: string;
  horizonSeconds: PhaseAHorizonSeconds;
  dueMonoNs: string;
  resolvedAtMonoNs: string;
}

export type PhaseAHorizonRecord =
  | (PhaseAHorizonRecordBase & {
      status: 'observed';
      stateObservedMonoNs: string;
      lateByNs: string;
      observation: PhaseADislocationObservation;
    })
  | (PhaseAHorizonRecordBase & {
      status: 'missing';
      stateObservedMonoNs: string;
      lateByNs: string;
      missing: readonly ('book' | 'ticker')[];
    })
  | (PhaseAHorizonRecordBase & {
      status: 'mismatched';
      stateObservedMonoNs: string;
      lateByNs: string;
      bookReceivedMonoNs: string;
      tickerReceivedMonoNs: string;
    })
  | (PhaseAHorizonRecordBase & {
      status: 'quality_rejected';
      stateObservedMonoNs: string;
      lateByNs: string;
      failures: readonly CausalSnapshotFailure[];
    })
  | (PhaseAHorizonRecordBase & {
      status: 'no_timely_state';
      lateByNs: string;
    })
  | (PhaseAHorizonRecordBase & {
      status: 'invalidated';
      invalidatedAtMonoNs: string;
      reason: string;
    });

function parseMonoNs(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${label} must be a precision-safe integer nanosecond string`);
  }
  return BigInt(value);
}

function msToNs(valueMs: number, label: string): bigint {
  if (!(Number.isFinite(valueMs) && valueMs >= 0)) {
    throw new Error(`${label} must be non-negative and finite`);
  }
  const ns = valueMs * 1_000_000;
  if (!Number.isSafeInteger(ns)) throw new Error(`${label} is too large for safe nanosecond conversion`);
  return BigInt(ns);
}

function normalizeReason(reasonInput: string): string {
  const reason = reasonInput.trim();
  if (!reason) throw new Error('invalidation reason is required');
  return reason;
}

function horizonKey(seconds: PhaseAHorizonSeconds): PhaseAHorizonKey {
  return `${seconds}s`;
}

function validateEpisode(episode: PhaseAEpisode): void {
  if (!episode.episodeId.trim()) throw new Error('episodeId is required');
  if (!episode.sessionId.trim()) throw new Error('episode sessionId is required');
  const start = parseMonoNs(episode.startMonoNs, 'episode startMonoNs');
  const end = parseMonoNs(episode.endMonoNs, 'episode endMonoNs');
  if (end !== start + 60_000_000_000n) throw new Error('episode endMonoNs does not match the frozen 60-second horizon');

  for (const seconds of PHASE_A_HORIZON_SECONDS) {
    const key = horizonKey(seconds);
    const due = parseMonoNs(episode.horizonDueMonoNs[key], `episode horizon ${key}`);
    const expected = start + BigInt(seconds) * 1_000_000_000n;
    if (due !== expected) throw new Error(`episode horizon ${key} does not match its preregistered deadline`);
  }
}

function validateAlignedSnapshot(
  episode: PhaseAEpisode,
  alignment: Extract<PhaseATargetAlignmentState, { status: 'aligned' }>,
  result: PhaseATargetSnapshotResult | undefined,
): PhaseATargetSnapshotResult {
  if (!result) throw new Error('aligned horizon state requires its causal snapshot result');
  const actionable = alignment.actionable;
  if (result.targetEvent.sessionId !== episode.sessionId) {
    throw new Error('aligned horizon snapshot belongs to a different clock session');
  }
  if (result.targetEvent.receivedMonoNs !== actionable.actionableReceivedMonoNs) {
    throw new Error('aligned horizon snapshot target time does not match the alignment state');
  }
  if (result.actionable.actionableReceivedMonoNs !== actionable.actionableReceivedMonoNs) {
    throw new Error('aligned horizon snapshot actionable time does not match the alignment state');
  }
  if (result.actionable.bookNonce !== actionable.bookNonce) {
    throw new Error('aligned horizon snapshot book nonce does not match the alignment state');
  }
  if (
    result.targetEvent.bid !== actionable.target.bid
    || result.targetEvent.ask !== actionable.target.ask
    || result.targetEvent.venue !== actionable.target.venue
    || result.targetEvent.symbol !== actionable.target.symbol
  ) {
    throw new Error('aligned horizon snapshot target BBO does not match the alignment state');
  }
  return result;
}

function frozenFailures(failures: readonly CausalSnapshotFailure[]): readonly CausalSnapshotFailure[] {
  return Object.freeze(failures.map((failure) => Object.freeze({
    ...failure,
    ...(failure.stream ? { stream: Object.freeze({ ...failure.stream }) } : {}),
  })));
}

/**
 * Causal horizon sampler for one preregistered Phase-A episode.
 *
 * The recorder never forward-fills a state that was observed before a horizon.
 * A horizon is resolved only by the first target-alignment observation received
 * at-or-after its deadline and no later than the preregistered lateness window.
 * If no such observation arrives, the horizon is explicit missing evidence.
 * This makes scheduler delay harmless: a late timer cannot backfill a horizon
 * with information that arrived after the permitted window.
 */
export class PhaseAHorizonRecorder {
  private readonly episodeValue: PhaseAEpisode;
  private readonly maxLatenessNs: bigint;
  private readonly recordsByHorizon = new Map<PhaseAHorizonSeconds, PhaseAHorizonRecord>();
  private lastClockNs?: bigint;
  private invalidated = false;

  constructor(episode: PhaseAEpisode, config: PhaseAHorizonRecorderConfig) {
    validateEpisode(episode);
    this.episodeValue = episode;
    this.maxLatenessNs = msToNs(config.maxHorizonLatenessMs, 'maxHorizonLatenessMs');
  }

  get episode(): PhaseAEpisode {
    return this.episodeValue;
  }

  get complete(): boolean {
    return this.recordsByHorizon.size === PHASE_A_HORIZON_SECONDS.length;
  }

  get records(): readonly PhaseAHorizonRecord[] {
    return Object.freeze(
      PHASE_A_HORIZON_SECONDS
        .map((seconds) => this.recordsByHorizon.get(seconds))
        .filter((record): record is PhaseAHorizonRecord => record !== undefined),
    );
  }

  observe(input: PhaseAHorizonAlignmentObservation): PhaseAHorizonRecord[] {
    if (this.invalidated) throw new Error('cannot observe a Phase-A episode after invalidation');
    const observedAt = this.observeClock(input.observedMonoNs);
    const start = parseMonoNs(this.episodeValue.startMonoNs, 'episode startMonoNs');
    if (observedAt < start) throw new Error('horizon state cannot predate the episode start');

    const stateObservedThrough = input.alignment.observedThroughMonoNs;
    if (stateObservedThrough !== undefined) {
      const through = parseMonoNs(stateObservedThrough, 'alignment observedThroughMonoNs');
      if (through > observedAt) throw new Error('alignment state cannot contain future evidence');
    }

    if (input.alignment.status === 'aligned') {
      validateAlignedSnapshot(this.episodeValue, input.alignment, input.snapshotResult);
    } else if (input.snapshotResult !== undefined) {
      throw new Error('non-aligned horizon state cannot carry a causal snapshot result');
    }

    const created: PhaseAHorizonRecord[] = [];
    for (const seconds of PHASE_A_HORIZON_SECONDS) {
      if (this.recordsByHorizon.has(seconds)) continue;
      const due = this.dueNs(seconds);
      if (observedAt < due) continue;

      const lateBy = observedAt - due;
      const record = lateBy > this.maxLatenessNs
        ? this.makeNoTimelyState(seconds, due, observedAt, lateBy)
        : this.makeStateRecord(seconds, due, observedAt, lateBy, input);
      this.recordsByHorizon.set(seconds, record);
      created.push(record);
    }
    return created;
  }

  /**
   * Advance the same monotonic clock without inventing a market observation.
   * A horizon becomes no_timely_state only after its acceptance window has
   * strictly expired, leaving an event exactly at the boundary eligible.
   */
  advanceClock(nowMonoNs: string): PhaseAHorizonRecord[] {
    if (this.invalidated) return [];
    const now = this.observeClock(nowMonoNs);
    const created: PhaseAHorizonRecord[] = [];
    for (const seconds of PHASE_A_HORIZON_SECONDS) {
      if (this.recordsByHorizon.has(seconds)) continue;
      const due = this.dueNs(seconds);
      const latestPermitted = due + this.maxLatenessNs;
      if (now <= latestPermitted) continue;
      const record = this.makeNoTimelyState(seconds, due, now, now - due);
      this.recordsByHorizon.set(seconds, record);
      created.push(record);
    }
    return created;
  }

  /** Invalidate all unresolved horizons; they can never be repaired retrospectively. */
  invalidate(atMonoNs: string, reasonInput: string): PhaseAHorizonRecord[] {
    if (this.invalidated) return [];
    const at = this.observeClock(atMonoNs);
    const reason = normalizeReason(reasonInput);
    const created: PhaseAHorizonRecord[] = [];
    for (const seconds of PHASE_A_HORIZON_SECONDS) {
      if (this.recordsByHorizon.has(seconds)) continue;
      const due = this.dueNs(seconds);
      const record: PhaseAHorizonRecord = Object.freeze({
        episodeId: this.episodeValue.episodeId,
        sessionId: this.episodeValue.sessionId,
        horizonSeconds: seconds,
        dueMonoNs: due.toString(),
        resolvedAtMonoNs: at.toString(),
        status: 'invalidated',
        invalidatedAtMonoNs: at.toString(),
        reason,
      });
      this.recordsByHorizon.set(seconds, record);
      created.push(record);
    }
    this.invalidated = true;
    return created;
  }

  private observeClock(value: string): bigint {
    const mono = parseMonoNs(value, 'horizon recorder monotonic time');
    if (this.lastClockNs !== undefined && mono < this.lastClockNs) {
      throw new Error('Phase-A horizon recorder monotonic clock regressed');
    }
    this.lastClockNs = mono;
    return mono;
  }

  private dueNs(seconds: PhaseAHorizonSeconds): bigint {
    return parseMonoNs(this.episodeValue.horizonDueMonoNs[horizonKey(seconds)], `episode horizon ${seconds}s`);
  }

  private base(seconds: PhaseAHorizonSeconds, due: bigint, resolvedAt: bigint): PhaseAHorizonRecordBase {
    return {
      episodeId: this.episodeValue.episodeId,
      sessionId: this.episodeValue.sessionId,
      horizonSeconds: seconds,
      dueMonoNs: due.toString(),
      resolvedAtMonoNs: resolvedAt.toString(),
    };
  }

  private makeNoTimelyState(
    seconds: PhaseAHorizonSeconds,
    due: bigint,
    resolvedAt: bigint,
    lateBy: bigint,
  ): PhaseAHorizonRecord {
    return Object.freeze({
      ...this.base(seconds, due, resolvedAt),
      status: 'no_timely_state' as const,
      lateByNs: lateBy.toString(),
    });
  }

  private makeStateRecord(
    seconds: PhaseAHorizonSeconds,
    due: bigint,
    observedAt: bigint,
    lateBy: bigint,
    input: PhaseAHorizonAlignmentObservation,
  ): PhaseAHorizonRecord {
    const base = {
      ...this.base(seconds, due, observedAt),
      stateObservedMonoNs: observedAt.toString(),
      lateByNs: lateBy.toString(),
    };

    if (input.alignment.status === 'missing') {
      return Object.freeze({
        ...base,
        status: 'missing' as const,
        missing: Object.freeze([...input.alignment.missing]),
      });
    }

    if (input.alignment.status === 'mismatched') {
      return Object.freeze({
        ...base,
        status: 'mismatched' as const,
        bookReceivedMonoNs: input.alignment.bookReceivedMonoNs,
        tickerReceivedMonoNs: input.alignment.tickerReceivedMonoNs,
      });
    }

    const result = validateAlignedSnapshot(this.episodeValue, input.alignment, input.snapshotResult);
    if (!result.snapshot.ok) {
      return Object.freeze({
        ...base,
        status: 'quality_rejected' as const,
        failures: frozenFailures(result.snapshot.failures),
      });
    }

    return Object.freeze({
      ...base,
      status: 'observed' as const,
      observation: buildPhaseADislocationObservation(result),
    });
  }
}
