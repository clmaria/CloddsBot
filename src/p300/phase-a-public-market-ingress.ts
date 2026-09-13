import {
  applyBitvavoBookUpdate,
  synchronizeBitvavoBook,
  type BitvavoBookUpdateLike,
  type BitvavoLocalBookState,
} from './bitvavo-book-sync';
import type { CausalMarketEvent } from './causal-market-buffer';
import {
  PhaseACollectorCore,
  type PhaseATargetSnapshotResult,
} from './phase-a-collector-core';
import {
  parseBinanceBookTickerRaw,
  parseBitvavoBookRaw,
  parseKrakenTickerV2Raw,
  type PhaseAReceiveStamp,
} from './phase-a-public-feed-parsers';
import { parseBitvavoTickerRaw } from './phase-a-bitvavo-ticker';
import { PhaseATargetCoordinator } from './phase-a-target-coordinator';

export interface PhaseAPublicMarketIngressConfig {
  /** Hard cap while waiting for a Bitvavo snapshot. Overflow fails closed. */
  maxBufferedBitvavoUpdates: number;
}

export type PhaseAPublicMarketIngressResult =
  | Readonly<{ kind: 'ignored' }>
  | Readonly<{ kind: 'reference'; event: CausalMarketEvent }>
  | Readonly<{ kind: 'bitvavo_book_buffered'; bufferedUpdates: number; needsSnapshot: true }>
  | Readonly<{
      kind: 'bitvavo_snapshot_rejected';
      reason: string;
      bufferedUpdates: number;
      needsSnapshot: true;
    }>
  | Readonly<{
      kind: 'bitvavo_book_resync_required';
      reason: string;
      bufferedUpdates: number;
      needsSnapshot: true;
    }>
  | Readonly<{
      kind: 'bitvavo_book_ready';
      bookNonce: number;
      target?: PhaseATargetSnapshotResult;
    }>
  | Readonly<{
      kind: 'bitvavo_ticker';
      target?: PhaseATargetSnapshotResult;
    }>;

interface BufferedBitvavoUpdate {
  update: BitvavoBookUpdateLike;
  stamp: PhaseAReceiveStamp;
}

function parseMonoNs(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error('receivedMonoNs must be a precision-safe integer nanosecond string');
  }
  return BigInt(value);
}

function parseSafeNonce(value: unknown): number {
  const nonce = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    throw new Error('Bitvavo nonce must be a non-negative safe integer');
  }
  return nonce;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Pure Phase-A composition boundary for public market data.
 *
 * It owns no socket and performs no network I/O. Callers must capture the
 * same-process monotonic receive stamp at the transport callback boundary and
 * then pass raw messages here. This class reuses the existing parsers,
 * Bitvavo book-sync state machine, target coordinator and the one
 * PhaseACollectorCore causal authority.
 */
export class PhaseAPublicMarketIngress {
  private readonly collector: PhaseACollectorCore;
  private readonly targetCoordinator = new PhaseATargetCoordinator();
  private readonly maxBufferedBitvavoUpdates: number;
  private bitvavoBook?: BitvavoLocalBookState;
  private bufferedBitvavoUpdates: BufferedBitvavoUpdate[] = [];
  private lastObservedMonoNs?: bigint;

  constructor(collector: PhaseACollectorCore, config: PhaseAPublicMarketIngressConfig) {
    if (!Number.isSafeInteger(config.maxBufferedBitvavoUpdates) || config.maxBufferedBitvavoUpdates < 1) {
      throw new Error('maxBufferedBitvavoUpdates must be a positive safe integer');
    }
    this.collector = collector;
    this.maxBufferedBitvavoUpdates = config.maxBufferedBitvavoUpdates;
  }

  get sessionId(): string {
    return this.collector.sessionId;
  }

  get bitvavoBookSynchronized(): boolean {
    return this.bitvavoBook !== undefined;
  }

  get bufferedBitvavoUpdateCount(): number {
    return this.bufferedBitvavoUpdates.length;
  }

  ingestKrakenRaw(raw: string, stamp: PhaseAReceiveStamp): PhaseAPublicMarketIngressResult {
    this.observeStamp(stamp);
    const parsed = parseKrakenTickerV2Raw(raw, stamp);
    if (!parsed) return Object.freeze({ kind: 'ignored' });
    return Object.freeze({ kind: 'reference', event: this.collector.ingestReference(parsed) });
  }

  ingestBinanceRaw(raw: string, stamp: PhaseAReceiveStamp): PhaseAPublicMarketIngressResult {
    this.observeStamp(stamp);
    const parsed = parseBinanceBookTickerRaw(raw, stamp);
    if (!parsed) return Object.freeze({ kind: 'ignored' });
    return Object.freeze({ kind: 'reference', event: this.collector.ingestReference(parsed) });
  }

  ingestBitvavoTickerRaw(raw: string, stamp: PhaseAReceiveStamp): PhaseAPublicMarketIngressResult {
    this.observeStamp(stamp);
    const ticker = parseBitvavoTickerRaw(raw, stamp);
    if (!ticker) return Object.freeze({ kind: 'ignored' });
    const actionable = this.targetCoordinator.updateTicker(ticker);
    const target = actionable ? this.collector.ingestActionableTarget(actionable) : undefined;
    return Object.freeze({ kind: 'bitvavo_ticker', target });
  }

  ingestBitvavoBookRaw(raw: string, stamp: PhaseAReceiveStamp): PhaseAPublicMarketIngressResult {
    this.observeStamp(stamp);
    const parsed = parseBitvavoBookRaw(raw, stamp);
    if (!parsed) return Object.freeze({ kind: 'ignored' });

    if (parsed.kind === 'snapshot') {
      try {
        const state = synchronizeBitvavoBook(
          parsed.snapshot,
          this.bufferedBitvavoUpdates.map((item) => item.update),
        );
        // A buffered reconstruction only becomes knowable when this snapshot
        // is received and validated. Never backdate it to an earlier update.
        this.bitvavoBook = state;
        this.bufferedBitvavoUpdates = [];
        const actionable = this.targetCoordinator.updateBookState(state, parsed.stamp);
        const target = actionable ? this.collector.ingestActionableTarget(actionable) : undefined;
        return Object.freeze({ kind: 'bitvavo_book_ready', bookNonce: state.nonce, target });
      } catch (error) {
        this.bitvavoBook = undefined;
        this.targetCoordinator.invalidateBook();
        return Object.freeze({
          kind: 'bitvavo_snapshot_rejected',
          reason: errorMessage(error),
          bufferedUpdates: this.bufferedBitvavoUpdates.length,
          needsSnapshot: true,
        });
      }
    }

    if (!this.bitvavoBook) {
      this.bufferBitvavoUpdate(parsed.update, parsed.stamp);
      return Object.freeze({
        kind: 'bitvavo_book_buffered',
        bufferedUpdates: this.bufferedBitvavoUpdates.length,
        needsSnapshot: true,
      });
    }

    const receivedNonce = parseSafeNonce(parsed.update.nonce);
    const expectedNonce = this.bitvavoBook.nonce + 1;
    if (!Number.isSafeInteger(expectedNonce) || receivedNonce !== expectedNonce) {
      this.bitvavoBook = undefined;
      this.targetCoordinator.invalidateBook();
      this.bufferedBitvavoUpdates = [];
      this.bufferBitvavoUpdate(parsed.update, parsed.stamp);
      return Object.freeze({
        kind: 'bitvavo_book_resync_required',
        reason: `expected Bitvavo nonce ${expectedNonce}, received ${receivedNonce}`,
        bufferedUpdates: this.bufferedBitvavoUpdates.length,
        needsSnapshot: true,
      });
    }

    // Non-sequence corruption (crossed/empty/malformed state) is not silently
    // converted into a retry loop. Invalidate first, then surface the error.
    let state: BitvavoLocalBookState;
    try {
      state = applyBitvavoBookUpdate(this.bitvavoBook, parsed.update);
    } catch (error) {
      this.bitvavoBook = undefined;
      this.bufferedBitvavoUpdates = [];
      this.targetCoordinator.invalidateBook();
      throw error;
    }

    this.bitvavoBook = state;
    const actionable = this.targetCoordinator.updateBookState(state, parsed.stamp);
    const target = actionable ? this.collector.ingestActionableTarget(actionable) : undefined;
    return Object.freeze({ kind: 'bitvavo_book_ready', bookNonce: state.nonce, target });
  }

  /** Transport disconnect/gap: discard unverifiable local state and start fresh. */
  invalidateBitvavoBook(): void {
    this.bitvavoBook = undefined;
    this.bufferedBitvavoUpdates = [];
    this.targetCoordinator.invalidateBook();
  }

  /** New process/clock domain invalidates every retained causal handle. */
  resetForNewClockDomain(newSessionId: string): void {
    this.collector.resetSession(newSessionId);
    this.targetCoordinator.resetForNewClockDomain();
    this.bitvavoBook = undefined;
    this.bufferedBitvavoUpdates = [];
    this.lastObservedMonoNs = undefined;
  }

  private observeStamp(stamp: PhaseAReceiveStamp): void {
    const mono = parseMonoNs(stamp.receivedMonoNs);
    if (!Number.isFinite(stamp.receivedAtMs)) throw new Error('receivedAtMs must be finite');
    if (this.lastObservedMonoNs !== undefined && mono < this.lastObservedMonoNs) {
      throw new Error('Phase-A public ingress receive clock regressed; serialize callbacks or reset the clock domain');
    }
    this.lastObservedMonoNs = mono;
  }

  private bufferBitvavoUpdate(update: BitvavoBookUpdateLike, stamp: PhaseAReceiveStamp): void {
    if (this.bufferedBitvavoUpdates.length >= this.maxBufferedBitvavoUpdates) {
      this.bufferedBitvavoUpdates = [];
      this.bitvavoBook = undefined;
      this.targetCoordinator.invalidateBook();
      throw new Error('Bitvavo pre-snapshot update buffer exceeded configured bound; reconnect and resync');
    }
    this.bufferedBitvavoUpdates.push({ update, stamp: { ...stamp } });
  }
}
