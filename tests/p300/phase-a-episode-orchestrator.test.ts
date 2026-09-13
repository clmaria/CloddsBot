import assert from 'node:assert/strict';
import test from 'node:test';
import type { BitvavoLocalBookState } from '../../src/p300/bitvavo-book-sync';
import type { CausalMarketEventInput } from '../../src/p300/causal-market-buffer';
import { PhaseACollectorCore, type PhaseATargetSnapshotResult } from '../../src/p300/phase-a-collector-core';
import type { PhaseAEvidenceEnvelope } from '../../src/p300/phase-a-evidence-integrity';
import { PhaseAEpisodeEvidenceOrchestrator } from '../../src/p300/phase-a-episode-orchestrator';
import type { PhaseAKeylessRuntimeCoreEvent } from '../../src/p300/phase-a-keyless-runtime-core';
import { parseBitvavoTickerRaw } from '../../src/p300/phase-a-bitvavo-ticker';
import { PhaseATargetCoordinator, type PhaseATargetAlignmentState } from '../../src/p300/phase-a-target-coordinator';
import type { PhaseAReceiveStamp } from '../../src/p300/phase-a-public-feed-parsers';

const SESSION = 'orchestrator-session-1';
const COMMIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const CONFIG_HASH = 'a'.repeat(64);
const MS = 1_000_000n;
const SECOND = 1_000_000_000n;
const ARM_AT = 9n * SECOND;
const START = 10n * SECOND;

class FakeSink {
  readonly cohortId = 'cohort-001';
  readonly collectorCommitSha = COMMIT_SHA;
  readonly configHash = CONFIG_HASH;
  readonly envelopes: PhaseAEvidenceEnvelope[] = [];
  fail = false;

  async writeEnvelope(envelope: PhaseAEvidenceEnvelope): Promise<string> {
    if (this.fail) throw new Error('evidence disk unavailable');
    this.envelopes.push(envelope);
    return `episodes/${envelope.contentHash}.json`;
  }
}

function stamp(ns: bigint): PhaseAReceiveStamp {
  return { receivedMonoNs: ns.toString(), receivedAtMs: Number(ns / MS) };
}

function reference(venue: 'kraken' | 'binance', ns: bigint): CausalMarketEventInput {
  return {
    venue,
    symbol: venue === 'kraken' ? 'BTC/USDC' : 'BTCUSDC',
    bid: 99.9,
    ask: 100.1,
    receivedMonoNs: ns.toString(),
    receivedAtMs: Number(ns / MS),
  };
}

function localBook(bid: number, ask: number, nonce = 10): BitvavoLocalBookState {
  return {
    market: 'BTC-USDC',
    nonce,
    bids: { [bid.toString()]: '1.5' },
    asks: { [ask.toString()]: '2' },
    exchangeTimestampNs: '1752139200123456789',
  };
}

function actionableAt(ns: bigint, bid: number, ask: number) {
  const coordinator = new PhaseATargetCoordinator();
  coordinator.updateBookState(localBook(bid, ask), stamp(ns));
  const ticker = parseBitvavoTickerRaw(JSON.stringify({
    event: 'ticker',
    market: 'BTC-USDC',
    bestBid: bid.toString(),
    bestBidSize: '1.5',
    bestAsk: ask.toString(),
    bestAskSize: '2',
    lastPrice: ((bid + ask) / 2).toString(),
  }), stamp(ns));
  assert.ok(ticker);
  const actionable = coordinator.updateTicker(ticker);
  assert.ok(actionable);
  return actionable;
}

function snapshotAt(ns: bigint, bid: number, ask: number): PhaseATargetSnapshotResult {
  const collector = new PhaseACollectorCore({
    sessionId: SESSION,
    maxHistoryPerStream: 10,
    maxReferenceAgeMs: 1_000,
    maxReferenceReceiveSkewMs: 500,
    maxReferenceDispersionBps: 100,
  });
  collector.ingestReference(reference('kraken', ns - 20n * MS));
  collector.ingestReference(reference('binance', ns - 10n * MS));
  return collector.ingestActionableTarget(actionableAt(ns, bid, ask));
}

function targetState(result: PhaseATargetSnapshotResult, signalCandidate: boolean): PhaseAKeylessRuntimeCoreEvent {
  const alignment: PhaseATargetAlignmentState = {
    status: 'aligned',
    actionable: result.actionable,
    observedThroughMonoNs: result.actionable.actionableReceivedMonoNs,
  };
  return {
    kind: 'target_state',
    observedMonoNs: result.targetEvent.receivedMonoNs,
    alignment,
    snapshotResult: result,
    signalCandidate,
  };
}

function makeOrchestrator(sink = new FakeSink()) {
  const orchestrator = new PhaseAEpisodeEvidenceOrchestrator({
    sessionId: SESSION,
    maxHorizonLatenessMs: 100,
    sink,
    utcNow: () => '2026-09-13T12:30:00.000Z',
  });
  return { orchestrator, sink };
}

async function armAndStart(orchestrator: PhaseAEpisodeEvidenceOrchestrator): Promise<string> {
  const armed = await orchestrator.handleRuntimeEvent(targetState(snapshotAt(ARM_AT, 99.95, 100.05), true));
  assert.ok(armed.some((event) => event.kind === 'episode_armed'));

  const started = await orchestrator.handleRuntimeEvent(targetState(snapshotAt(START, 98, 99), true));
  const event = started.find((item) => item.kind === 'episode_started');
  assert.ok(event && event.kind === 'episode_started');
  return event.episodeId;
}

function bodyOf(envelope: PhaseAEvidenceEnvelope): {
  horizons: Array<{ status: string; horizonSeconds: number }>;
  fillability: string;
  executionAuthorized: boolean;
  terminal: { status: string };
} {
  return envelope.body as {
    horizons: Array<{ status: string; horizonSeconds: number }>;
    fillability: string;
    executionAuthorized: boolean;
    terminal: { status: string };
  };
}

test('writes one underpriced envelope only after all six preregistered horizons resolve', async () => {
  const { orchestrator, sink } = makeOrchestrator();
  const episodeId = await armAndStart(orchestrator);
  const horizons = [1, 2, 5, 15, 30, 60];
  for (const seconds of horizons) {
    const at = START + BigInt(seconds) * SECOND;
    await orchestrator.handleRuntimeEvent(targetState(snapshotAt(at, 99, 100), false));
  }

  assert.equal(sink.envelopes.length, 1);
  const envelope = sink.envelopes[0];
  assert.equal(envelope.episodeId, episodeId);
  assert.equal(envelope.kind, 'underpriced_episode');
  const body = bodyOf(envelope);
  assert.deepEqual(body.horizons.map((record) => [record.horizonSeconds, record.status]), [
    [1, 'observed'],
    [2, 'observed'],
    [5, 'observed'],
    [15, 'observed'],
    [30, 'observed'],
    [60, 'observed'],
  ]);
  assert.equal(body.terminal.status, 'closed');
  assert.equal(body.fillability, 'not_evaluated');
  assert.equal(body.executionAuthorized, false);
  assert.equal(orchestrator.pendingEpisodeCount, 0);
});

test('episode close alone is not enough: silence waits through lateness then records no_timely_state', async () => {
  const { orchestrator, sink } = makeOrchestrator();
  await armAndStart(orchestrator);

  await orchestrator.advanceClock((START + 60n * SECOND).toString());
  assert.equal(sink.envelopes.length, 0, '60s close must not invent a 60s horizon state');
  assert.equal(orchestrator.pendingEpisodeCount, 1);

  await orchestrator.advanceClock((START + 60n * SECOND + 100n * MS + 1n).toString());
  assert.equal(sink.envelopes.length, 1);
  const body = bodyOf(sink.envelopes[0]);
  assert.equal(body.horizons.length, 6);
  assert.ok(body.horizons.every((record) => record.status === 'no_timely_state'));
  assert.equal(body.terminal.status, 'closed');
});

test('causal session invalidation seals unresolved horizons and emits invalid_episode', async () => {
  const { orchestrator, sink } = makeOrchestrator();
  await armAndStart(orchestrator);
  await orchestrator.invalidateSession((START + 500n * MS).toString(), 'public transport disconnected');

  assert.equal(sink.envelopes.length, 1);
  assert.equal(sink.envelopes[0].kind, 'invalid_episode');
  const body = bodyOf(sink.envelopes[0]);
  assert.ok(body.horizons.every((record) => record.status === 'invalidated'));
  assert.equal(body.terminal.status, 'invalidated');
  assert.equal(orchestrator.pendingEpisodeCount, 0);
});

test('cannot cross into a new clock session while evidence remains unresolved', async () => {
  const { orchestrator } = makeOrchestrator();
  await armAndStart(orchestrator);
  assert.throws(() => orchestrator.resetSession('orchestrator-session-2'), /episodes remain unresolved/);

  await orchestrator.invalidateSession((START + 500n * MS).toString(), 'session reset');
  assert.doesNotThrow(() => orchestrator.resetSession('orchestrator-session-2'));
  assert.equal(orchestrator.sessionId, 'orchestrator-session-2');
});

test('evidence sink failure propagates and leaves the completed episode pending instead of pretending success', async () => {
  const sink = new FakeSink();
  const { orchestrator } = makeOrchestrator(sink);
  await armAndStart(orchestrator);
  sink.fail = true;

  await assert.rejects(
    () => orchestrator.advanceClock((START + 60n * SECOND + 100n * MS + 1n).toString()),
    /evidence disk unavailable/,
  );
  assert.equal(sink.envelopes.length, 0);
  assert.equal(orchestrator.pendingEpisodeCount, 1);

  sink.fail = false;
  await orchestrator.advanceClock((START + 60n * SECOND + 100n * MS + 1n).toString());
  assert.equal(sink.envelopes.length, 1);
  assert.equal(orchestrator.pendingEpisodeCount, 0);
});

test('clock regression fails closed rather than reordering episode evidence', async () => {
  const { orchestrator } = makeOrchestrator();
  await orchestrator.handleRuntimeEvent(targetState(snapshotAt(ARM_AT, 99.95, 100.05), true));
  await assert.rejects(
    () => orchestrator.advanceClock((ARM_AT - 1n).toString()),
    /monotonic clock regressed/,
  );
});
