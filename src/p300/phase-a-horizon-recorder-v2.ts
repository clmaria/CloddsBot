import type {
  CausalAsOfSnapshot,
  CausalSnapshotFailure,
} from './causal-market-buffer';
import {
  PHASE_A_HORIZON_SECONDS,
  type PhaseAEpisode,
} from './phase-a-episode-detector';

export type PhaseAHorizonSeconds = (typeof PHASE_A_HORIZON_SECONDS)[number];
export type PhaseAHorizonKey = `${PhaseAHorizonSeconds}s`;

/**
 * Minimal read contract for the owner of Phase-A causal market state.
 * CausalMarketBuffer and PhaseACollectorCore both satisfy this structurally,
 * but production composition should pass the collector that already owns
 * ingestion rather than construct a parallel buffer.
 */
export interface PhaseAHorizonSnapshotSource {
  readonly sessionId: string;
  readonly ingestSeq: number;
  snapshotAsOf(cutoffMonoNs: string, nowMonoNs: string): CausalAsOfSnapshot;
}

interface PhaseAHorizonOutcomeBase {
  episodeId: string;
  sessionId: string;
  horizonSeconds: PhaseAHorizonSeconds;
  dueMonoNs: string;
  sealedAtMonoNs: string;
  cutoffIngestSeq: number;
}

export type PhaseAHorizonOutcome =
  | (PhaseAHorizonOutcomeBase & {
      status: 'observed';
      targetReceivedMonoNs: string;
      referenceReceivedMonoNs: readonly string[];
      targetMid: number;
      referenceMid: number;
      deviationBps: number;
      absoluteDeviationBps: number;
      grossConvergenceBps: number;
      targetReturnBps: number;
      referenceReturnBps: number;
      referenceDispersionBps: number;
      referenceReceiveSkewNs: string;
    })
  | (PhaseAHorizonOutcomeBase & {
      status: 'quality_rejected';
      targetReceivedMonoNs: string;
      targetMid: number;
      failures: readonly CausalSnapshotFailure[];
    })
  | (PhaseAHorizonOutcomeBase & {
      status: 'unavailable';
      reason: 'NO_TARGET_STATE_AT_OR_BEFORE_HORIZON';
    });

function parseMonoNs(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${label} must be a precision-safe integer nanosecond string`);
  }
  return BigInt(value);
}

function horizonKey(seconds: PhaseAHorizonSeconds): PhaseAHorizonKey {
  return `${seconds}s`;
}

function validateEpisode(episode: PhaseAEpisode): void {
  if (!episode.episodeId.trim()) throw new Error('episodeId is required');
  if (!episode.sessionId.trim()) throw new Error('episode sessionId is required');
  const start = parseMonoNs(episode.startMonoNs, 'episode startMonoNs');
  if (episode.startObservation.sessionId !== episode.sessionId) {
    throw new Error('episode start observation belongs to a different clock session');
  }
  if (episode.startObservation.receivedMonoNs !== episode.startMonoNs) {
    throw new Error('episode start observation time does not match startMonoNs');
  }
  for (const seconds of PHASE_A_HORIZON_SECONDS) {
    const due = parseMonoNs(episode.horizonDueMonoNs[horizonKey(seconds)], `episode horizon ${seconds}s`);
    const expected = start + BigInt(seconds) * 1_000_000_000n;
    if (due !== expected) throw new Error(`episode horizon ${seconds}s does not match its preregistered deadline`);
  }
}

function freezeFailures(failures: readonly CausalSnapshotFailure[]): readonly CausalSnapshotFailure[] {
  return Object.freeze(failures.map((failure) => Object.freeze({
    ...failure,
    ...(failure.stream ? { stream: Object.freeze({ ...failure.stream }) } : {}),
  })));
}

function bpsReturn(current: number, start: number): number {
  const value = ((current - start) / start) * 10_000;
  if (!Number.isFinite(value)) throw new Error('derived horizon return is not finite');
  return value;
}

/**
 * Records preregistered Phase-A outcomes from the existing causal-state owner.
 * It owns no market-data state and cannot backfill from exchange or wall time.
 */
export class PhaseAHorizonOutcomeRecorder {
  private readonly source: PhaseAHorizonSnapshotSource;
  private readonly episodeValue: PhaseAEpisode;
  private readonly outcomesByHorizon = new Map<PhaseAHorizonSeconds, PhaseAHorizonOutcome>();
  private lastSealMonoNs?: bigint;

  constructor(source: PhaseAHorizonSnapshotSource, episode: PhaseAEpisode) {
    validateEpisode(episode);
    if (source.sessionId !== episode.sessionId) {
      throw new Error('horizon recorder causal source belongs to a different clock session');
    }
    this.source = source;
    this.episodeValue = episode;
  }

  get episode(): PhaseAEpisode {
    return this.episodeValue;
  }

  get complete(): boolean {
    return this.outcomesByHorizon.size === PHASE_A_HORIZON_SECONDS.length;
  }

  get outcomes(): readonly PhaseAHorizonOutcome[] {
    return Object.freeze(
      PHASE_A_HORIZON_SECONDS
        .map((seconds) => this.outcomesByHorizon.get(seconds))
        .filter((outcome): outcome is PhaseAHorizonOutcome => outcome !== undefined),
    );
  }

  /** Seal every unresolved horizon whose preregistered monotonic deadline has passed. */
  recordDue(nowMonoNs: string): PhaseAHorizonOutcome[] {
    if (this.source.sessionId !== this.episodeValue.sessionId) {
      throw new Error('horizon recorder clock session is no longer valid');
    }
    const now = parseMonoNs(nowMonoNs, 'horizon recorder nowMonoNs');
    if (this.lastSealMonoNs !== undefined && now < this.lastSealMonoNs) {
      throw new Error('Phase-A horizon recorder monotonic clock regressed');
    }
    this.lastSealMonoNs = now;

    const created: PhaseAHorizonOutcome[] = [];
    for (const seconds of PHASE_A_HORIZON_SECONDS) {
      if (this.outcomesByHorizon.has(seconds)) continue;
      const dueMonoNs = this.episodeValue.horizonDueMonoNs[horizonKey(seconds)];
      const due = parseMonoNs(dueMonoNs, `episode horizon ${seconds}s`);
      if (now < due) continue;

      const outcome = this.sealOne(seconds, dueMonoNs, nowMonoNs);
      this.outcomesByHorizon.set(seconds, outcome);
      created.push(outcome);
    }
    return created;
  }

  private sealOne(
    seconds: PhaseAHorizonSeconds,
    dueMonoNs: string,
    nowMonoNs: string,
  ): PhaseAHorizonOutcome {
    let asOf: CausalAsOfSnapshot;
    try {
      asOf = this.source.snapshotAsOf(dueMonoNs, nowMonoNs);
    } catch (error) {
      if (error instanceof Error && /no target state exists/.test(error.message)) {
        return Object.freeze({
          ...this.base(seconds, dueMonoNs, nowMonoNs, this.source.ingestSeq),
          status: 'unavailable' as const,
          reason: 'NO_TARGET_STATE_AT_OR_BEFORE_HORIZON' as const,
        });
      }
      throw error;
    }

    const snapshot = asOf.snapshot;
    const base = this.base(seconds, dueMonoNs, asOf.sealedAtMonoNs, asOf.cutoffIngestSeq);
    if (!snapshot.ok) {
      return Object.freeze({
        ...base,
        status: 'quality_rejected' as const,
        targetReceivedMonoNs: snapshot.target.receivedMonoNs,
        targetMid: snapshot.target.mid,
        failures: freezeFailures(snapshot.failures),
      });
    }

    const deviationBps = ((snapshot.target.mid - snapshot.referenceMid) / snapshot.referenceMid) * 10_000;
    if (!Number.isFinite(deviationBps)) throw new Error('derived horizon deviation is not finite');
    const absoluteDeviationBps = Math.abs(deviationBps);
    const start = this.episodeValue.startObservation;
    const grossConvergenceBps = start.absoluteDeviationBps - absoluteDeviationBps;
    if (!Number.isFinite(grossConvergenceBps)) throw new Error('derived gross convergence is not finite');

    return Object.freeze({
      ...base,
      status: 'observed' as const,
      targetReceivedMonoNs: snapshot.target.receivedMonoNs,
      referenceReceivedMonoNs: Object.freeze(snapshot.references.map((reference) => reference.receivedMonoNs)),
      targetMid: snapshot.target.mid,
      referenceMid: snapshot.referenceMid,
      deviationBps,
      absoluteDeviationBps,
      grossConvergenceBps,
      targetReturnBps: bpsReturn(snapshot.target.mid, start.targetMid),
      referenceReturnBps: bpsReturn(snapshot.referenceMid, start.referenceMid),
      referenceDispersionBps: snapshot.referenceDispersionBps,
      referenceReceiveSkewNs: snapshot.referenceReceiveSkewNs,
    });
  }

  private base(
    seconds: PhaseAHorizonSeconds,
    dueMonoNs: string,
    sealedAtMonoNs: string,
    cutoffIngestSeq: number,
  ): PhaseAHorizonOutcomeBase {
    return {
      episodeId: this.episodeValue.episodeId,
      sessionId: this.episodeValue.sessionId,
      horizonSeconds: seconds,
      dueMonoNs,
      sealedAtMonoNs,
      cutoffIngestSeq,
    };
  }
}
