import type { PhaseATargetSnapshotResult } from './phase-a-collector-core';

export const PHASE_A_TRIGGER_BPS = 10;
export const PHASE_A_MAX_EPISODE_NS = 60_000_000_000n;
export const PHASE_A_HORIZON_SECONDS = Object.freeze([1, 2, 5, 15, 30, 60] as const);

export type PhaseADeviationBin =
  | 'below_10'
  | '10_to_lt20'
  | '20_to_lt30'
  | '30_to_lt50'
  | '50_to_lt100'
  | 'gte100';

export type PhaseADislocationDirection = 'underpriced' | 'overpriced' | 'flat';

export interface PhaseADislocationObservation {
  sessionId: string;
  targetIngestSeq: number;
  receivedMonoNs: string;
  receivedAtMs: number;
  targetBid: number;
  targetAsk: number;
  targetMid: number;
  referenceMid: number;
  referenceDispersionBps: number;
  referenceReceiveSkewNs: string;
  deviationBps: number;
  absoluteDeviationBps: number;
  deviationBin: PhaseADeviationBin;
  direction: PhaseADislocationDirection;
  executableLongOnly: boolean;
}

export interface PhaseAEpisode {
  episodeId: string;
  sessionId: string;
  startMonoNs: string;
  endMonoNs: string;
  startObservation: PhaseADislocationObservation;
  horizonDueMonoNs: Readonly<Record<string, string>>;
}

export type PhaseAEpisodeDetectorEvent =
  | { type: 'armed'; atMonoNs: string }
  | { type: 'started'; episode: PhaseAEpisode }
  | { type: 'closed'; episode: PhaseAEpisode; closedAtMonoNs: string }
  | { type: 'invalidated'; episode: PhaseAEpisode; atMonoNs: string; reason: string };

function parseMonoNs(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${label} must be a precision-safe integer nanosecond string`);
  }
  return BigInt(value);
}

function assertPositiveFinite(value: number, label: string): void {
  if (!(Number.isFinite(value) && value > 0)) throw new Error(`${label} must be positive and finite`);
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!(Number.isFinite(value) && value >= 0)) throw new Error(`${label} must be non-negative and finite`);
}

export function classifyPhaseADeviationBin(absoluteDeviationBps: number): PhaseADeviationBin {
  assertNonNegativeFinite(absoluteDeviationBps, 'absoluteDeviationBps');
  if (absoluteDeviationBps < 10) return 'below_10';
  if (absoluteDeviationBps < 20) return '10_to_lt20';
  if (absoluteDeviationBps < 30) return '20_to_lt30';
  if (absoluteDeviationBps < 50) return '30_to_lt50';
  if (absoluteDeviationBps < 100) return '50_to_lt100';
  return 'gte100';
}

/** Build the preregistered dislocation measurement from a quality-valid causal snapshot. */
export function buildPhaseADislocationObservation(
  result: PhaseATargetSnapshotResult,
): PhaseADislocationObservation {
  if (!result.snapshot.ok) throw new Error('cannot build a Phase-A dislocation observation from a rejected causal snapshot');
  const { target, referenceMid, referenceDispersionBps, referenceReceiveSkewNs } = result.snapshot;
  assertPositiveFinite(target.mid, 'target mid');
  assertPositiveFinite(referenceMid, 'reference mid');

  const deviationBps = ((target.mid - referenceMid) / referenceMid) * 10_000;
  if (!Number.isFinite(deviationBps)) throw new Error('derived Phase-A deviation is not finite');
  const absoluteDeviationBps = Math.abs(deviationBps);
  const epsilon = 1e-9;
  const direction: PhaseADislocationDirection = absoluteDeviationBps <= epsilon
    ? 'flat'
    : deviationBps < 0
      ? 'underpriced'
      : 'overpriced';

  return Object.freeze({
    sessionId: target.sessionId,
    targetIngestSeq: target.ingestSeq,
    receivedMonoNs: target.receivedMonoNs,
    receivedAtMs: target.receivedAtMs,
    targetBid: target.bid,
    targetAsk: target.ask,
    targetMid: target.mid,
    referenceMid,
    referenceDispersionBps,
    referenceReceiveSkewNs,
    deviationBps,
    absoluteDeviationBps,
    deviationBin: classifyPhaseADeviationBin(absoluteDeviationBps),
    direction,
    executableLongOnly: direction === 'underpriced',
  });
}

function buildEpisode(observation: PhaseADislocationObservation): PhaseAEpisode {
  const start = parseMonoNs(observation.receivedMonoNs, 'episode start receivedMonoNs');
  const horizonDueMonoNs: Record<string, string> = {};
  for (const seconds of PHASE_A_HORIZON_SECONDS) {
    horizonDueMonoNs[`${seconds}s`] = (start + BigInt(seconds) * 1_000_000_000n).toString();
  }
  return Object.freeze({
    episodeId: `${observation.sessionId}:${observation.targetIngestSeq}:${observation.receivedMonoNs}`,
    sessionId: observation.sessionId,
    startMonoNs: observation.receivedMonoNs,
    endMonoNs: (start + PHASE_A_MAX_EPISODE_NS).toString(),
    startObservation: observation,
    horizonDueMonoNs: Object.freeze(horizonDueMonoNs),
  });
}

/**
 * Pre-registered independence state machine for Phase A.
 *
 * The detector starts unarmed: it must first observe abs(deviation) < 10 bps.
 * A crossing to >= 10 bps then starts exactly one 60-second episode. After
 * closure or invalidation it refuses to count another episode until a fresh
 * valid observation is again below 10 bps. A long shock therefore cannot be
 * chopped into repeated 'independent' observations.
 */
export class PhaseAEpisodeDetector {
  private sessionIdValue: string;
  private state: 'awaiting_rearm' | 'armed' | 'open' = 'awaiting_rearm';
  private openEpisodeValue?: PhaseAEpisode;
  private lastMonoNs?: bigint;

  constructor(sessionId: string) {
    const normalized = sessionId.trim();
    if (!normalized) throw new Error('sessionId is required');
    this.sessionIdValue = normalized;
  }

  get sessionId(): string {
    return this.sessionIdValue;
  }

  get status(): 'awaiting_rearm' | 'armed' | 'open' {
    return this.state;
  }

  get openEpisode(): PhaseAEpisode | undefined {
    return this.openEpisodeValue;
  }

  observe(observation: PhaseADislocationObservation): PhaseAEpisodeDetectorEvent[] {
    if (observation.sessionId !== this.sessionIdValue) throw new Error('observation belongs to a different clock session');
    if (!Number.isSafeInteger(observation.targetIngestSeq) || observation.targetIngestSeq <= 0) {
      throw new Error('targetIngestSeq must be a positive safe integer');
    }
    assertPositiveFinite(observation.targetMid, 'targetMid');
    assertPositiveFinite(observation.referenceMid, 'referenceMid');
    assertNonNegativeFinite(observation.absoluteDeviationBps, 'absoluteDeviationBps');
    const mono = this.observeClock(observation.receivedMonoNs);
    const events: PhaseAEpisodeDetectorEvent[] = [];

    const closed = this.closeIfDue(mono);
    if (closed) events.push(closed);

    if (this.state === 'open') return events;

    if (this.state === 'awaiting_rearm') {
      if (observation.absoluteDeviationBps < PHASE_A_TRIGGER_BPS) {
        this.state = 'armed';
        events.push({ type: 'armed', atMonoNs: observation.receivedMonoNs });
      }
      return events;
    }

    if (observation.absoluteDeviationBps >= PHASE_A_TRIGGER_BPS) {
      const episode = buildEpisode(observation);
      this.openEpisodeValue = episode;
      this.state = 'open';
      events.push({ type: 'started', episode });
    }
    return events;
  }

  /** Advance a same-process timer so a quiet market still closes the 60s window exactly once. */
  advanceClock(nowMonoNs: string): PhaseAEpisodeDetectorEvent[] {
    const now = this.observeClock(nowMonoNs);
    const closed = this.closeIfDue(now);
    return closed ? [closed] : [];
  }

  /** Data-integrity loss invalidates an open episode and requires a fresh below-threshold rearm. */
  invalidate(atMonoNs: string, reasonInput: string): PhaseAEpisodeDetectorEvent[] {
    const at = this.observeClock(atMonoNs);
    const reason = reasonInput.trim();
    if (!reason) throw new Error('invalidation reason is required');
    const closed = this.closeIfDue(at);
    const events: PhaseAEpisodeDetectorEvent[] = closed ? [closed] : [];
    if (!this.openEpisodeValue) return events;

    const episode = this.openEpisodeValue;
    this.openEpisodeValue = undefined;
    this.state = 'awaiting_rearm';
    events.push({ type: 'invalidated', episode, atMonoNs, reason });
    return events;
  }

  /** A new process/monotonic clock domain cannot inherit armed or open state. */
  resetSession(newSessionId: string): void {
    const normalized = newSessionId.trim();
    if (!normalized) throw new Error('newSessionId is required');
    if (normalized === this.sessionIdValue) throw new Error('newSessionId must identify a new clock domain');
    this.sessionIdValue = normalized;
    this.state = 'awaiting_rearm';
    this.openEpisodeValue = undefined;
    this.lastMonoNs = undefined;
  }

  private observeClock(value: string): bigint {
    const mono = parseMonoNs(value, 'detector monotonic time');
    if (this.lastMonoNs !== undefined && mono < this.lastMonoNs) {
      throw new Error('Phase-A episode detector monotonic clock regressed');
    }
    this.lastMonoNs = mono;
    return mono;
  }

  private closeIfDue(now: bigint): PhaseAEpisodeDetectorEvent | null {
    const episode = this.openEpisodeValue;
    if (!episode) return null;
    const end = parseMonoNs(episode.endMonoNs, 'episode endMonoNs');
    if (now < end) return null;
    this.openEpisodeValue = undefined;
    this.state = 'awaiting_rearm';
    return { type: 'closed', episode, closedAtMonoNs: episode.endMonoNs };
  }
}
