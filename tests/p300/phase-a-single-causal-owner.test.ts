import assert from 'node:assert/strict';
import test from 'node:test';
import type { BitvavoLocalBookState } from '../../src/p300/bitvavo-book-sync';
import type { CausalMarketEventInput } from '../../src/p300/causal-market-buffer';
import { PhaseACollectorCore } from '../../src/p300/phase-a-collector-core';
import { parseBitvavoTickerRaw } from '../../src/p300/phase-a-bitvavo-ticker';
import {
  PHASE_A_HORIZON_SECONDS,
  classifyPhaseADeviationBin,
  type PhaseADislocationObservation,
  type PhaseAEpisode,
} from '../../src/p300/phase-a-episode-detector';
import { PhaseAHorizonOutcomeRecorder } from '../../src/p300/phase-a-horizon-recorder-v2';
import type { PhaseAReceiveStamp } from '../../src/p300/phase-a-public-feed-parsers';
import { PhaseATargetCoordinator, type PhaseAActionableTarget } from '../../src/p300/phase-a-target-coordinator';

const SESSION = 'phase-a-single-owner';
const START = 1_000_000_000n;

function stamp(ns: bigint): PhaseAReceiveStamp {
  return { receivedMonoNs: ns.toString(), receivedAtMs: Number(ns / 1_000_000n) };
}

function reference(venue: 'kraken' | 'binance', ns: bigint): CausalMarketEventInput {
  return {
    venue,
    symbol: venue === 'kraken' ? 'BTC/USDC' : 'BTCUSDC',
    bid: 99,
    ask: 101,
    receivedMonoNs: ns.toString(),
    receivedAtMs: Number(ns / 1_000_000n),
  };
}

function actionableTarget(ns: bigint, bid = 97, ask = 99, nonce = 1): PhaseAActionableTarget {
  const coordinator = new PhaseATargetCoordinator();
  const state: BitvavoLocalBookState = {
    market: 'BTC-USDC',
    nonce,
    bids: { [String(bid)]: '1.5' },
    asks: { [String(ask)]: '2' },
  };
  assert.equal(coordinator.updateBookState(state, stamp(ns)), null);
  const ticker = parseBitvavoTickerRaw(JSON.stringify({
    event: 'ticker',
    market: 'BTC-USDC',
    bestBid: String(bid),
    bestBidSize: '1.5',
    bestAsk: String(ask),
    bestAskSize: '2',
    lastPrice: String((bid + ask) / 2),
  }), stamp(ns));
  assert.ok(ticker);
  const actionable = coordinator.updateTicker(ticker);
  assert.ok(actionable);
  return actionable;
}

function makeEpisode(observation: PhaseADislocationObservation): PhaseAEpisode {
  const horizonDueMonoNs: Record<string, string> = {};
  const start = BigInt(observation.receivedMonoNs);
  for (const seconds of PHASE_A_HORIZON_SECONDS) {
    horizonDueMonoNs[`${seconds}s`] = (start + BigInt(seconds) * 1_000_000_000n).toString();
  }
  return Object.freeze({
    episodeId: `${SESSION}:${observation.targetIngestSeq}:${observation.receivedMonoNs}`,
    sessionId: SESSION,
    startMonoNs: observation.receivedMonoNs,
    endMonoNs: (start + 60_000_000_000n).toString(),
    startObservation: observation,
    horizonDueMonoNs: Object.freeze(horizonDueMonoNs),
  });
}

test('collector core is the single causal owner used by ingestion and horizon sealing', () => {
  const collector = new PhaseACollectorCore({
    sessionId: SESSION,
    maxHistoryPerStream: 50,
    maxReferenceAgeMs: 1_000,
    maxReferenceReceiveSkewMs: 500,
    maxReferenceDispersionBps: 100,
  });

  collector.ingestReference(reference('kraken', START - 2n));
  collector.ingestReference(reference('binance', START - 1n));
  const startResult = collector.ingestActionableTarget(actionableTarget(START));
  assert.equal(startResult.snapshot.ok, true);
  if (!startResult.snapshot.ok) return;

  const deviationBps = ((startResult.targetEvent.mid - startResult.snapshot.referenceMid)
    / startResult.snapshot.referenceMid) * 10_000;
  const observation: PhaseADislocationObservation = Object.freeze({
    sessionId: SESSION,
    targetIngestSeq: startResult.targetEvent.ingestSeq,
    receivedMonoNs: startResult.targetEvent.receivedMonoNs,
    receivedAtMs: startResult.targetEvent.receivedAtMs,
    targetBid: startResult.targetEvent.bid,
    targetAsk: startResult.targetEvent.ask,
    targetMid: startResult.targetEvent.mid,
    referenceMid: startResult.snapshot.referenceMid,
    referenceDispersionBps: startResult.snapshot.referenceDispersionBps,
    referenceReceiveSkewNs: startResult.snapshot.referenceReceiveSkewNs,
    deviationBps,
    absoluteDeviationBps: Math.abs(deviationBps),
    deviationBin: classifyPhaseADeviationBin(Math.abs(deviationBps)),
    direction: 'underpriced',
    executableLongOnly: true,
  });

  const episode = makeEpisode(observation);
  const due1s = START + 1_000_000_000n;
  collector.ingestReference(reference('kraken', due1s - 3n));
  collector.ingestReference(reference('binance', due1s - 2n));
  collector.ingestActionableTarget(actionableTarget(due1s - 1n, 98, 100, 2));

  const asOf = collector.snapshotAsOf(due1s.toString(), due1s.toString());
  assert.equal(asOf.snapshot.ok, true);
  assert.equal(asOf.cutoffIngestSeq, collector.ingestSeq);

  const recorder = new PhaseAHorizonOutcomeRecorder(collector, episode);
  const created = recorder.recordDue(due1s.toString());
  assert.equal(created.length, 1);
  assert.equal(created[0].status, 'observed');
  assert.equal(created[0].cutoffIngestSeq, collector.ingestSeq);

  collector.resetSession('phase-a-single-owner-reset');
  assert.throws(
    () => recorder.recordDue((due1s + 1_000_000_000n).toString()),
    /clock session is no longer valid/,
  );
});
