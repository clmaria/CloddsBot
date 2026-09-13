import {
  CausalMarketBuffer,
  type CausalAsOfSnapshot,
  type CausalMarketBufferConfig,
  type CausalMarketEvent,
  type CausalMarketEventInput,
  type CausalSnapshot,
} from './causal-market-buffer';
import type { PhaseAActionableTarget } from './phase-a-target-coordinator';

export const PHASE_A_TARGET_STREAM = Object.freeze({ venue: 'bitvavo', symbol: 'BTC-USDC' });
export const PHASE_A_REFERENCE_STREAMS = Object.freeze([
  Object.freeze({ venue: 'kraken', symbol: 'BTC/USDC' }),
  Object.freeze({ venue: 'binance', symbol: 'BTCUSDC' }),
] as const);

export interface PhaseACollectorCoreConfig {
  sessionId: string;
  maxHistoryPerStream: number;
  maxReferenceAgeMs: number;
  maxReferenceReceiveSkewMs: number;
  maxReferenceDispersionBps: number;
}

export interface PhaseATargetSnapshotResult {
  targetEvent: CausalMarketEvent;
  snapshot: CausalSnapshot;
  actionable: PhaseAActionableTarget;
}

function parseMonoNs(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${label} must be a precision-safe integer nanosecond string`);
  }
  return BigInt(value);
}

function sameNumber(left: number, right: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const tolerance = Math.max(1e-12, Math.max(Math.abs(left), Math.abs(right)) * 1e-12);
  return Math.abs(left - right) <= tolerance;
}

function assertPositiveFinite(value: number, label: string): void {
  if (!(Number.isFinite(value) && value > 0)) throw new Error(`${label} must be positive and finite`);
}

function validateActionableTarget(actionable: PhaseAActionableTarget): void {
  const target = actionable.target;
  if (target.venue !== PHASE_A_TARGET_STREAM.venue || target.symbol !== PHASE_A_TARGET_STREAM.symbol) {
    throw new Error('actionable target does not match the frozen Phase-A target stream');
  }
  if (target.sourceObservedAtMs !== undefined) {
    throw new Error('Bitvavo target sourceObservedAtMs must remain unset; exchange book time is not target event time');
  }
  if (target.sourceSequence !== actionable.bookNonce) {
    throw new Error('actionable target source sequence does not match synchronized book nonce');
  }
  if (target.receivedMonoNs !== actionable.actionableReceivedMonoNs) {
    throw new Error('actionable target causal timestamp does not match coordinator timestamp');
  }
  if (actionable.ticker.market !== PHASE_A_TARGET_STREAM.symbol) {
    throw new Error('actionable ticker market does not match the frozen Phase-A target');
  }
  if (actionable.ticker.stamp.receivedMonoNs !== actionable.tickerReceivedMonoNs) {
    throw new Error('actionable ticker receive timestamp is inconsistent');
  }

  const bookMono = parseMonoNs(actionable.bookReceivedMonoNs, 'bookReceivedMonoNs');
  const tickerMono = parseMonoNs(actionable.tickerReceivedMonoNs, 'tickerReceivedMonoNs');
  const actionableMono = parseMonoNs(actionable.actionableReceivedMonoNs, 'actionableReceivedMonoNs');
  const expectedActionableMono = bookMono > tickerMono ? bookMono : tickerMono;
  if (actionableMono !== expectedActionableMono) {
    throw new Error('actionable target is backdated or does not use the later agreeing receive instant');
  }

  if (!actionable.book.bids.length || !actionable.book.asks.length) {
    throw new Error('actionable target book requires bids and asks');
  }
  const bestBid = [...actionable.book.bids].sort((a, b) => b.price - a.price)[0];
  const bestAsk = [...actionable.book.asks].sort((a, b) => a.price - b.price)[0];
  assertPositiveFinite(bestBid.price, 'actionable book best bid');
  assertPositiveFinite(bestBid.baseQty, 'actionable book best bid size');
  assertPositiveFinite(bestAsk.price, 'actionable book best ask');
  assertPositiveFinite(bestAsk.baseQty, 'actionable book best ask size');
  if (bestBid.price > bestAsk.price) throw new Error('actionable target book is crossed');

  const consistent =
    sameNumber(target.bid, bestBid.price) &&
    sameNumber(target.ask, bestAsk.price) &&
    sameNumber(actionable.ticker.bid, bestBid.price) &&
    sameNumber(actionable.ticker.ask, bestAsk.price) &&
    sameNumber(actionable.ticker.bidSize, bestBid.baseQty) &&
    sameNumber(actionable.ticker.askSize, bestAsk.baseQty);
  if (!consistent) throw new Error('actionable target no longer proves ticker/book BBO agreement');
}

function isReferenceStream(input: CausalMarketEventInput): boolean {
  return PHASE_A_REFERENCE_STREAMS.some(
    (stream) => stream.venue === input.venue && stream.symbol === input.symbol,
  );
}

/**
 * Pure composition layer for the frozen Phase-A direct-USDC cohort.
 *
 * This class is the owner of the one CausalMarketBuffer for a collector
 * session. Feed adapters ingest through it and horizon readers seal through
 * it; callers must not construct a parallel market-state buffer for the same
 * session. Wall/exchange timestamps remain provenance-only in the underlying
 * causal buffer.
 */
export class PhaseACollectorCore {
  private readonly buffer: CausalMarketBuffer;

  constructor(config: PhaseACollectorCoreConfig) {
    const bufferConfig: CausalMarketBufferConfig = {
      sessionId: config.sessionId,
      target: PHASE_A_TARGET_STREAM,
      references: PHASE_A_REFERENCE_STREAMS.map((stream) => ({ ...stream })),
      maxHistoryPerStream: config.maxHistoryPerStream,
      maxReferenceAgeMs: config.maxReferenceAgeMs,
      maxReferenceReceiveSkewMs: config.maxReferenceReceiveSkewMs,
      maxReferenceDispersionBps: config.maxReferenceDispersionBps,
    };
    this.buffer = new CausalMarketBuffer(bufferConfig);
  }

  get sessionId(): string {
    return this.buffer.sessionId;
  }

  get ingestSeq(): number {
    return this.buffer.ingestSeq;
  }

  ingestReference(input: CausalMarketEventInput): CausalMarketEvent {
    if (!isReferenceStream(input)) {
      throw new Error('reference event is outside the frozen Phase-A direct-USDC cohort');
    }
    return this.buffer.ingest(input);
  }

  ingestActionableTarget(actionable: PhaseAActionableTarget): PhaseATargetSnapshotResult {
    validateActionableTarget(actionable);
    const targetEvent = this.buffer.ingest(actionable.target);
    return {
      targetEvent,
      snapshot: this.buffer.snapshotForTarget(targetEvent),
      actionable,
    };
  }

  /** Rebuild an old target snapshot without permitting later arrivals to backfill it. */
  snapshotForTarget(targetEvent: CausalMarketEvent): CausalSnapshot {
    return this.buffer.snapshotForTarget(targetEvent);
  }

  /**
   * Seal a preregistered monotonic horizon through the same causal authority
   * that owns ingestion. This is deliberately read-only: no second buffer,
   * replay cache or wall-clock lookup is introduced here.
   */
  snapshotAsOf(cutoffMonoNs: string, nowMonoNs: string): CausalAsOfSnapshot {
    return this.buffer.snapshotAsOf(cutoffMonoNs, nowMonoNs);
  }

  /** New process/clock domain: all old histories and target handles become invalid. */
  resetSession(newSessionId: string): void {
    this.buffer.resetSession(newSessionId);
  }
}
