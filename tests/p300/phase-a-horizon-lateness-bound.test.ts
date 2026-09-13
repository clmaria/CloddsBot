import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PHASE_A_HORIZON_SECONDS,
  type PhaseADislocationObservation,
  type PhaseAEpisode,
} from '../../src/p300/phase-a-episode-detector';
import { PhaseAHorizonRecorder } from '../../src/p300/phase-a-horizon-recorder';

function episode(): PhaseAEpisode {
  const start = 1_000_000_000n;
  const horizonDueMonoNs: Record<string, string> = {};
  for (const seconds of PHASE_A_HORIZON_SECONDS) {
    horizonDueMonoNs[`${seconds}s`] = (start + BigInt(seconds) * 1_000_000_000n).toString();
  }
  const startObservation: PhaseADislocationObservation = {
    sessionId: 'lateness-bound-session',
    targetIngestSeq: 1,
    receivedMonoNs: start.toString(),
    receivedAtMs: 1_000,
    targetBid: 98,
    targetAsk: 99,
    targetMid: 98.5,
    referenceMid: 100,
    referenceDispersionBps: 1,
    referenceReceiveSkewNs: '0',
    deviationBps: -150,
    absoluteDeviationBps: 150,
    deviationBin: 'gte100',
    direction: 'underpriced',
    executableLongOnly: true,
  };
  return {
    episodeId: 'lateness-bound-session:1:1000000000',
    sessionId: 'lateness-bound-session',
    startMonoNs: start.toString(),
    endMonoNs: (start + 60_000_000_000n).toString(),
    startObservation,
    horizonDueMonoNs,
  };
}

test('horizon lateness must be strictly smaller than the minimum one-second spacing', () => {
  assert.doesNotThrow(() => new PhaseAHorizonRecorder(episode(), { maxHorizonLatenessMs: 999.999 }));
  assert.throws(
    () => new PhaseAHorizonRecorder(episode(), { maxHorizonLatenessMs: 1_000 }),
    /less than the minimum 1-second horizon spacing/,
  );
});
