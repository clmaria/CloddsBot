import {
  applyBitvavoBookUpdate,
  synchronizeBitvavoBook,
  type BitvavoBookUpdateLike,
  type BitvavoLocalBookState,
} from './bitvavo-book-sync';
import {
  PhaseACollectorCore,
  type PhaseACollectorCoreConfig,
  type PhaseATargetSnapshotResult,
} from './phase-a-collector-core';
import { parseBitvavoTickerRaw } from './phase-a-bitvavo-ticker';
import {
  parseBinanceBookTickerRaw,
  parseBitvavoBookRaw,
  parseKrakenTickerV2Raw,
  type PhaseAReceiveStamp,
} from './phase-a-public-feed-parsers';
import {
  PhaseATargetCoordinator,
  type PhaseATargetAlignmentState,
} from './phase-a-target-coordinator';

export interface PhaseAKeylessRuntimeCoreConfig {
  sessionId: string;
  maxBufferedBookUpdates: number;
  collector: Omit<PhaseACollectorCoreConfig, 'sessionId'>;
}

export type PhaseAKeylessRuntimeCoreEvent =
  | {
      kind: 'bitvavo_snapshot_request';
      requestId: number;
      market: 'BTC-USDC';
    }
  | {
      kind: 'bitvavo_book_synchronized';
      nonce: number;
      observedMonoNs: string;
    }
  | {
      kind: 'bitvavo_book_invalidated';
      reason: string;
      observedMonoNs: string;
    }
  | {
      kind: 'reference';
      venue: 'kraken' | 'binance';
      observedMonoNs: string;
    }
  | {
      kind: 'target_state';
      observedMonoNs: string;
      alignment: PhaseATargetAlignmentState;
      snapshotResult?: PhaseATargetSnapshotResult;
      /** True only when the coordinator emits a fresh ticker-triggered candidate. */
      signalCandidate: boolean;
    };

interface BufferedBookUpdate {
  update: BitvavoBookUpdateLike;
  stamp: PhaseAReceiveStamp;
}

function parseMonoNs(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${label} must be a precision-safe integer nanosecond string`);
  }
  return BigInt(value);
}

function validateStamp(stamp: PhaseAReceiveStamp): void {
  parseMonoNs(stamp.receivedMonoNs, 'runtime receivedMonoNs');
  if (!Number.isFinite(stamp.receivedAtMs)) throw new Error('runtime receivedAtMs must be finite');
}

function validateConfig(config: PhaseAKeylessRuntimeCoreConfig): void {
  if (!config.sessionId.trim()) throw new Error('runtime sessionId is required');
  if (!(Number.isSafeInteger(config.maxBufferedBookUpdates) && config.maxBufferedBookUpdates > 0)) {
    throw new Error('maxBufferedBookUpdates must be a positive safe integer');
  }
}

/**
 * Transport-independent Phase-A runtime core.
 *
 * This class contains no socket, HTTP, credential or order-submission code. A
 * future keyless transport layer may deliver raw public messages here after it
 * stamps each callback at entry with the same-process monotonic clock.
 */
export class PhaseAKeylessRuntimeCore {
  private sessionIdValue: string;
  private readonly maxBufferedBookUpdates: number;
  private readonly collectorConfig: Omit<PhaseACollectorCoreConfig, 'sessionId'>;
  private collectorValue: PhaseACollectorCore;
  private readonly targetCoordinator = new PhaseATargetCoordinator('BTC-USDC');
  private localBook?: BitvavoLocalBookState;
  private bufferedBookUpdates: BufferedBookUpdate[] = [];
  private pendingSnapshotRequestId?: number;
  private nextSnapshotRequestId = 1;
  private lastRuntimeMonoNs?: bigint;

  constructor(config: PhaseAKeylessRuntimeCoreConfig) {
    validateConfig(config);
    this.sessionIdValue = config.sessionId;
    this.maxBufferedBookUpdates = config.maxBufferedBookUpdates;
    this.collectorConfig = { ...config.collector };
    this.collectorValue = new PhaseACollectorCore({
      sessionId: this.sessionIdValue,
      ...this.collectorConfig,
    });
  }

  get sessionId(): string {
    return this.sessionIdValue;
  }

  get bitvavoSynchronized(): boolean {
    return this.localBook !== undefined && this.pendingSnapshotRequestId === undefined;
  }

  get bufferedBitvavoUpdates(): number {
    return this.bufferedBookUpdates.length;
  }

  get currentTargetAlignment(): PhaseATargetAlignmentState {
    return this.targetCoordinator.currentAlignment();
  }

  /**
   * Start or continue the documented subscribe-buffer-snapshot synchronization.
   * Repeated calls while a request is pending do not create duplicate requests.
   */
  ensureBitvavoSnapshotRequest(): PhaseAKeylessRuntimeCoreEvent[] {
    if (this.pendingSnapshotRequestId !== undefined) return [];
    const requestId = this.nextSnapshotRequestId++;
    if (!Number.isSafeInteger(requestId)) throw new Error('Bitvavo snapshot request id overflow');
    this.pendingSnapshotRequestId = requestId;
    return [{ kind: 'bitvavo_snapshot_request', requestId, market: 'BTC-USDC' }];
  }

  ingestBinanceRaw(raw: string, stamp: PhaseAReceiveStamp): PhaseAKeylessRuntimeCoreEvent[] {
    this.observeRuntimeStamp(stamp);
    const event = parseBinanceBookTickerRaw(raw, stamp, 'BTCUSDC');
    if (!event) return [];
    this.collectorValue.ingestReference(event);
    return [{ kind: 'reference', venue: 'binance', observedMonoNs: stamp.receivedMonoNs }];
  }

  ingestKrakenRaw(raw: string, stamp: PhaseAReceiveStamp): PhaseAKeylessRuntimeCoreEvent[] {
    this.observeRuntimeStamp(stamp);
    const event = parseKrakenTickerV2Raw(raw, stamp, 'BTC/USDC');
    if (!event) return [];
    this.collectorValue.ingestReference(event);
    return [{ kind: 'reference', venue: 'kraken', observedMonoNs: stamp.receivedMonoNs }];
  }

  ingestBitvavoRaw(raw: string, stamp: PhaseAReceiveStamp): PhaseAKeylessRuntimeCoreEvent[] {
    this.observeRuntimeStamp(stamp);

    const ticker = parseBitvavoTickerRaw(raw, stamp, 'BTC-USDC');
    if (ticker) {
      const emitted = this.targetCoordinator.updateTicker(ticker);
      return this.targetStateEvents(stamp.receivedMonoNs, emitted !== null);
    }

    const parsedBook = parseBitvavoBookRaw(raw, stamp, 'BTC-USDC');
    if (!parsedBook) return [];

    if (parsedBook.kind === 'snapshot') {
      return this.acceptBitvavoSnapshot(parsedBook.snapshot, parsedBook.requestId, parsedBook.stamp);
    }

    return this.acceptBitvavoBookUpdate(parsedBook.update, parsedBook.stamp);
  }

  /** Fail closed on disconnect/parse uncertainty and request a fresh snapshot. */
  invalidateBitvavo(reasonInput: string, stamp: PhaseAReceiveStamp): PhaseAKeylessRuntimeCoreEvent[] {
    this.observeRuntimeStamp(stamp);
    const reason = reasonInput.trim();
    if (!reason) throw new Error('Bitvavo invalidation reason is required');
    this.localBook = undefined;
    this.bufferedBookUpdates = [];
    this.pendingSnapshotRequestId = undefined;
    this.targetCoordinator.invalidateBook();
    return [
      {
        kind: 'bitvavo_book_invalidated',
        reason,
        observedMonoNs: stamp.receivedMonoNs,
      },
      ...this.ensureBitvavoSnapshotRequest(),
      ...this.targetStateEvents(stamp.receivedMonoNs, false),
    ];
  }

  /**
   * A collector restart/new process lifetime starts a new causal clock cohort;
   * no market state or reference history crosses this boundary.
   */
  resetSession(newSessionIdInput: string): void {
    const newSessionId = newSessionIdInput.trim();
    if (!newSessionId) throw new Error('new runtime sessionId is required');
    if (newSessionId === this.sessionIdValue) throw new Error('new runtime sessionId must differ from the current session');
    this.sessionIdValue = newSessionId;
    this.collectorValue = new PhaseACollectorCore({ sessionId: newSessionId, ...this.collectorConfig });
    this.targetCoordinator.resetForNewClockDomain();
    this.localBook = undefined;
    this.bufferedBookUpdates = [];
    this.pendingSnapshotRequestId = undefined;
    this.nextSnapshotRequestId = 1;
    this.lastRuntimeMonoNs = undefined;
  }

  private acceptBitvavoBookUpdate(
    update: BitvavoBookUpdateLike,
    stamp: PhaseAReceiveStamp,
  ): PhaseAKeylessRuntimeCoreEvent[] {
    if (!this.localBook) {
      this.bufferUpdate(update, stamp);
      return this.ensureBitvavoSnapshotRequest();
    }

    try {
      this.localBook = applyBitvavoBookUpdate(this.localBook, update);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Bitvavo book update failed';
      this.localBook = undefined;
      this.targetCoordinator.invalidateBook();
      this.bufferedBookUpdates = [];
      this.bufferUpdate(update, stamp);
      this.pendingSnapshotRequestId = undefined;
      return [
        { kind: 'bitvavo_book_invalidated', reason, observedMonoNs: stamp.receivedMonoNs },
        ...this.ensureBitvavoSnapshotRequest(),
        ...this.targetStateEvents(stamp.receivedMonoNs, false),
      ];
    }

    const emitted = this.targetCoordinator.updateBookState(this.localBook, stamp);
    return this.targetStateEvents(stamp.receivedMonoNs, emitted !== null);
  }

  private acceptBitvavoSnapshot(
    snapshot: Parameters<typeof synchronizeBitvavoBook>[0],
    requestId: number | string | undefined,
    stamp: PhaseAReceiveStamp,
  ): PhaseAKeylessRuntimeCoreEvent[] {
    if (this.pendingSnapshotRequestId === undefined) return [];
    if (requestId === undefined || String(requestId) !== String(this.pendingSnapshotRequestId)) {
      // A stale response from an earlier request must never replace the current sync attempt.
      return [];
    }

    try {
      this.localBook = synchronizeBitvavoBook(
        snapshot,
        this.bufferedBookUpdates.map((item) => item.update),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Bitvavo snapshot synchronization failed';
      this.localBook = undefined;
      this.targetCoordinator.invalidateBook();
      this.pendingSnapshotRequestId = undefined;
      return [
        { kind: 'bitvavo_book_invalidated', reason, observedMonoNs: stamp.receivedMonoNs },
        ...this.ensureBitvavoSnapshotRequest(),
        ...this.targetStateEvents(stamp.receivedMonoNs, false),
      ];
    }

    this.bufferedBookUpdates = [];
    this.pendingSnapshotRequestId = undefined;
    const emitted = this.targetCoordinator.updateBookState(this.localBook, stamp);
    return [
      {
        kind: 'bitvavo_book_synchronized',
        nonce: this.localBook.nonce,
        observedMonoNs: stamp.receivedMonoNs,
      },
      ...this.targetStateEvents(stamp.receivedMonoNs, emitted !== null),
    ];
  }

  private bufferUpdate(update: BitvavoBookUpdateLike, stamp: PhaseAReceiveStamp): void {
    if (this.bufferedBookUpdates.length >= this.maxBufferedBookUpdates) {
      this.bufferedBookUpdates = [];
      this.pendingSnapshotRequestId = undefined;
      this.targetCoordinator.invalidateBook();
      throw new Error('Bitvavo pre-snapshot update buffer limit exceeded');
    }
    this.bufferedBookUpdates.push({ update, stamp: { ...stamp } });
  }

  private targetStateEvents(observedMonoNs: string, signalCandidate: boolean): PhaseAKeylessRuntimeCoreEvent[] {
    const alignment = this.targetCoordinator.currentAlignment();
    if (alignment.status !== 'aligned') {
      return [{ kind: 'target_state', observedMonoNs, alignment, signalCandidate: false }];
    }

    const snapshotResult = this.collectorValue.ingestActionableTarget(alignment.actionable);
    return [{
      kind: 'target_state',
      observedMonoNs,
      alignment,
      snapshotResult,
      signalCandidate,
    }];
  }

  private observeRuntimeStamp(stamp: PhaseAReceiveStamp): void {
    validateStamp(stamp);
    const mono = BigInt(stamp.receivedMonoNs);
    if (this.lastRuntimeMonoNs !== undefined && mono < this.lastRuntimeMonoNs) {
      throw new Error('Phase-A runtime monotonic receive clock regressed');
    }
    this.lastRuntimeMonoNs = mono;
  }
}
