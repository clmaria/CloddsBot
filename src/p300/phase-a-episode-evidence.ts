import { finalizePhaseAEvidenceEnvelope, verifyPhaseAEvidenceEnvelope, type PhaseAEvidenceEnvelope } from './phase-a-evidence-integrity';
import { PHASE_A_HORIZON_SECONDS, type PhaseAEpisode } from './phase-a-episode-detector';
import type { PhaseAHorizonOutcome } from './phase-a-horizon-recorder-v2';

export type PhaseAQualityStatus = 'pass' | 'fail' | 'not_evaluated';
export type PhaseAQualityCheckName =
  | 'targetBookContinuity'
  | 'targetTickerBookAgreement'
  | 'marketStatus'
  | 'monotonicClockDomain'
  | 'sourceFreshness'
  | 'referenceDispersion'
  | 'crossFeedReceiveSkew'
  | 'rawPayloadParse'
  | 'forwardHorizonCompleteness';

export interface PhaseAQualityCheck {
  name: PhaseAQualityCheckName;
  status: PhaseAQualityStatus;
  reason?: string;
}

export interface PhaseARawRangePointer {
  source: 'bitvavo' | 'kraken' | 'binance';
  sessionId: string;
  artifactId: string;
  sha256: string;
  firstOffset: number;
  lastOffset: number;
}

export type PhaseAEpisodeEvidenceBody = Record<string, unknown> & {
  schemaVersion: 'p300.phase-a.episode-body.v1';
  episode: PhaseAEpisode;
  horizons: readonly PhaseAHorizonOutcome[];
  rawRanges: readonly PhaseARawRangePointer[];
  qualityChecks: readonly PhaseAQualityCheck[];
  fillEvidenceStatus: 'not_evaluated_clock_gate';
  sampleEligible: boolean;
};

export interface FinalizePhaseAEpisodeEvidenceInput {
  cohortId: string;
  collectorCommitSha: string;
  configHash: string;
  createdAtUtc: string;
  episode: PhaseAEpisode;
  horizons: readonly PhaseAHorizonOutcome[];
  rawRanges: readonly PhaseARawRangePointer[];
  qualityChecks: readonly PhaseAQualityCheck[];
}

const REQUIRED_CHECKS: readonly PhaseAQualityCheckName[] = Object.freeze([
  'targetBookContinuity', 'targetTickerBookAgreement', 'marketStatus', 'monotonicClockDomain',
  'sourceFreshness', 'referenceDispersion', 'crossFeedReceiveSkew', 'rawPayloadParse',
  'forwardHorizonCompleteness',
]);

function validateHorizons(episode: PhaseAEpisode, outcomes: readonly PhaseAHorizonOutcome[]): void {
  if (outcomes.length !== PHASE_A_HORIZON_SECONDS.length) throw new Error('exactly six horizon outcomes are required');
  const seen = new Set<number>();
  for (const outcome of outcomes) {
    if (outcome.episodeId !== episode.episodeId || outcome.sessionId !== episode.sessionId) {
      throw new Error('horizon outcome belongs to another episode or clock session');
    }
    if (seen.has(outcome.horizonSeconds)) throw new Error('duplicate horizon outcome');
    if (outcome.dueMonoNs !== episode.horizonDueMonoNs[`${outcome.horizonSeconds}s`]) {
      throw new Error('horizon deadline does not match preregistration');
    }
    seen.add(outcome.horizonSeconds);
  }
  for (const seconds of PHASE_A_HORIZON_SECONDS) if (!seen.has(seconds)) throw new Error(`missing ${seconds}s horizon`);
}

function validateRawRanges(sessionId: string, ranges: readonly PhaseARawRangePointer[]): void {
  const expected = new Set(['bitvavo', 'kraken', 'binance']);
  if (ranges.length !== expected.size) throw new Error('exactly one raw range per primary venue is required');
  for (const range of ranges) {
    if (!expected.delete(range.source)) throw new Error('duplicate or unsupported raw evidence source');
    if (range.sessionId !== sessionId) throw new Error('raw evidence belongs to another clock session');
    if (!range.artifactId.trim()) throw new Error('raw evidence artifactId is required');
    if (!/^[0-9a-f]{64}$/i.test(range.sha256)) throw new Error('raw evidence sha256 is invalid');
    if (!Number.isSafeInteger(range.firstOffset) || range.firstOffset < 0) throw new Error('raw firstOffset is invalid');
    if (!Number.isSafeInteger(range.lastOffset) || range.lastOffset < range.firstOffset) throw new Error('raw lastOffset is invalid');
  }
  if (expected.size) throw new Error('missing primary raw evidence source');
}

function validateQuality(outcomes: readonly PhaseAHorizonOutcome[], checks: readonly PhaseAQualityCheck[]): boolean {
  const expected = new Set<PhaseAQualityCheckName>(REQUIRED_CHECKS);
  if (checks.length !== REQUIRED_CHECKS.length) throw new Error('all required quality checks must be present exactly once');
  for (const check of checks) {
    if (!expected.delete(check.name)) throw new Error('duplicate or unsupported quality check');
    if (!['pass', 'fail', 'not_evaluated'].includes(check.status)) throw new Error('unsupported quality status');
    if (check.status !== 'pass' && !check.reason?.trim()) throw new Error('non-PASS quality check requires a reason');
    if (check.status === 'pass' && check.reason?.trim()) throw new Error('PASS quality check cannot carry a failure reason');
  }
  if (expected.size) throw new Error('missing required quality check');
  const horizonComplete = outcomes.every((outcome) => outcome.status === 'observed');
  const declared = checks.find((check) => check.name === 'forwardHorizonCompleteness')!;
  if ((declared.status === 'pass') !== horizonComplete) throw new Error('forwardHorizonCompleteness contradicts recorded outcomes');
  return horizonComplete && checks.every((check) => check.status === 'pass');
}

function expectedKind(episode: PhaseAEpisode): 'underpriced_episode' | 'overpriced_control' | 'background_control' {
  if (episode.startObservation.direction === 'underpriced') return 'underpriced_episode';
  if (episode.startObservation.direction === 'overpriced') return 'overpriced_control';
  return 'background_control';
}

export function finalizePhaseAEpisodeEvidenceEnvelope(input: FinalizePhaseAEpisodeEvidenceInput): PhaseAEvidenceEnvelope<PhaseAEpisodeEvidenceBody> {
  validateHorizons(input.episode, input.horizons);
  validateRawRanges(input.episode.sessionId, input.rawRanges);
  const sampleEligible = validateQuality(input.horizons, input.qualityChecks);
  const body: PhaseAEpisodeEvidenceBody = {
    schemaVersion: 'p300.phase-a.episode-body.v1',
    episode: input.episode,
    horizons: Object.freeze([...input.horizons]),
    rawRanges: Object.freeze([...input.rawRanges]),
    qualityChecks: Object.freeze([...input.qualityChecks]),
    fillEvidenceStatus: 'not_evaluated_clock_gate',
    sampleEligible,
  };
  return finalizePhaseAEvidenceEnvelope({
    cohortId: input.cohortId,
    episodeId: input.episode.episodeId,
    kind: expectedKind(input.episode),
    collectorCommitSha: input.collectorCommitSha,
    configHash: input.configHash,
    createdAtUtc: input.createdAtUtc,
    body,
  });
}

export function verifyPhaseAEpisodeEvidenceEnvelope(envelope: PhaseAEvidenceEnvelope<PhaseAEpisodeEvidenceBody>): boolean {
  try {
    if (!verifyPhaseAEvidenceEnvelope(envelope)) return false;
    if (envelope.body.schemaVersion !== 'p300.phase-a.episode-body.v1') return false;
    if (envelope.episodeId !== envelope.body.episode.episodeId) return false;
    if (envelope.kind !== expectedKind(envelope.body.episode)) return false;
    validateHorizons(envelope.body.episode, envelope.body.horizons);
    validateRawRanges(envelope.body.episode.sessionId, envelope.body.rawRanges);
    const eligible = validateQuality(envelope.body.horizons, envelope.body.qualityChecks);
    return envelope.body.fillEvidenceStatus === 'not_evaluated_clock_gate' && envelope.body.sampleEligible === eligible;
  } catch {
    return false;
  }
}
