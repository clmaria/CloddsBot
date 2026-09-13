import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
  PhaseAKeylessRuntimeCore,
  type PhaseAKeylessRuntimeCoreEvent,
} from './phase-a-keyless-runtime-core';
import type { PhaseAReceiveStamp } from './phase-a-public-feed-parsers';

export const PHASE_A_PUBLIC_ENDPOINTS = Object.freeze({
  bitvavoWs: 'wss://ws.bitvavo.com/v2/',
  bitvavoBookRest: 'https://api.bitvavo.com/v2/BTC-USDC/book?depth=1000',
  krakenWs: 'wss://ws.kraken.com/v2',
  // Binance's market-data-only endpoint cannot expose account/user streams.
  binanceWs: 'wss://data-stream.binance.vision/ws/btcusdc@bookTicker',
});

export type PhaseAPublicVenue = 'bitvavo' | 'kraken' | 'binance';
export type PhaseAPublicRawChannel = 'websocket' | 'book_snapshot_rest';

export interface PhaseAPublicRawMarketData {
  source: PhaseAPublicVenue;
  channel: PhaseAPublicRawChannel;
  rawPayload: string;
  stamp: PhaseAReceiveStamp;
}

export interface PhaseAWebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: unknown) => void): this;
  on(event: 'close', listener: () => void): this;
  on(event: 'error', listener: (error: unknown) => void): this;
  on(event: 'pong', listener: () => void): this;
  ping?(): void;
}

export interface PhaseAHttpResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export interface PhaseAPublicTransportDependencies {
  webSocketFactory: (url: string) => PhaseAWebSocketLike;
  fetchFn: (url: string, init?: RequestInit) => Promise<PhaseAHttpResponseLike>;
  monotonicNowNs: () => bigint;
  wallNowMs: () => number;
  makeSessionId: () => string;
  setTimeoutFn: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface PhaseAPublicTransportConfig {
  runtime: PhaseAKeylessRuntimeCore;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  dependencies?: Partial<PhaseAPublicTransportDependencies>;
  /** Must complete successfully before the corresponding payload may be parsed. */
  onRawMarketData?: (event: PhaseAPublicRawMarketData) => void | Promise<void>;
  /** Runtime evidence consumers may also fail closed asynchronously. */
  onRuntimeEvent?: (event: PhaseAKeylessRuntimeCoreEvent) => void | Promise<void>;
  onTransportEvent?: (event: PhaseAPublicTransportEvent) => void;
}

export type PhaseAPublicTransportEvent =
  | { kind: 'session_started'; sessionId: string; generation: number }
  | { kind: 'venue_open'; venue: PhaseAPublicVenue; generation: number }
  | { kind: 'session_invalidated'; reason: string; generation: number }
  | { kind: 'reconnect_scheduled'; delayMs: number; generation: number }
  | { kind: 'message_rejected'; venue: PhaseAPublicVenue; reason: string; generation: number };

interface SocketSlot {
  venue: PhaseAPublicVenue;
  socket: PhaseAWebSocketLike;
  generation: number;
}

function asMessageText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof Buffer) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  if (data && typeof data === 'object' && 'toString' in data) {
    const text = String(data);
    if (text !== '[object Object]') return text;
  }
  throw new Error('WebSocket message is not text-compatible');
}

function validatePositiveSafeInteger(value: number, label: string): void {
  if (!(Number.isSafeInteger(value) && value > 0)) throw new Error(`${label} must be a positive safe integer`);
}

function defaultDependencies(): PhaseAPublicTransportDependencies {
  return {
    webSocketFactory: (url) => new WebSocket(url) as unknown as PhaseAWebSocketLike,
    fetchFn: async (url, init) => fetch(url, init),
    monotonicNowNs: () => process.hrtime.bigint(),
    wallNowMs: () => Date.now(),
    makeSessionId: () => `phase-a-${randomUUID()}`,
    setTimeoutFn: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeoutFn: (timer) => clearTimeout(timer),
  };
}

/**
 * Public, credential-free transport for Phase A research.
 *
 * Every payload is stamped at callback entry, then globally serialized across
 * venues. The raw evidence sink is awaited before parsing/runtime mutation, so
 * durable-evidence failure cannot race ahead of a market observation. Old
 * generation work is discarded after any session invalidation. No credential,
 * account, order or cancel capability exists in this module.
 */
export class PhaseAPublicMarketTransport {
  private readonly runtime: PhaseAKeylessRuntimeCore;
  private readonly deps: PhaseAPublicTransportDependencies;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly onRawMarketData?: (event: PhaseAPublicRawMarketData) => void | Promise<void>;
  private readonly onRuntimeEvent?: (event: PhaseAKeylessRuntimeCoreEvent) => void | Promise<void>;
  private readonly onTransportEvent?: (event: PhaseAPublicTransportEvent) => void;

  private running = false;
  private startedOnce = false;
  private generation = 0;
  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private sockets = new Map<PhaseAPublicVenue, SocketSlot>();
  private openVenues = new Set<PhaseAPublicVenue>();
  private snapshotInFlight = new Set<string>();
  /** One causal ingress queue for all venues and REST snapshot responses. */
  private ingressTail: Promise<void> = Promise.resolve();

  constructor(config: PhaseAPublicTransportConfig) {
    const defaults = defaultDependencies();
    this.runtime = config.runtime;
    this.reconnectBaseMs = config.reconnectBaseMs ?? 1_000;
    this.reconnectMaxMs = config.reconnectMaxMs ?? 30_000;
    validatePositiveSafeInteger(this.reconnectBaseMs, 'reconnectBaseMs');
    validatePositiveSafeInteger(this.reconnectMaxMs, 'reconnectMaxMs');
    if (this.reconnectBaseMs > this.reconnectMaxMs) {
      throw new Error('reconnectBaseMs must not exceed reconnectMaxMs');
    }
    this.deps = { ...defaults, ...config.dependencies };
    this.onRawMarketData = config.onRawMarketData;
    this.onRuntimeEvent = config.onRuntimeEvent;
    this.onTransportEvent = config.onTransportEvent;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get currentGeneration(): number {
    return this.generation;
  }

  start(): void {
    if (this.running) return;
    if (this.startedOnce) this.runtime.resetSession(this.freshSessionId());
    this.startedOnce = true;
    this.running = true;
    this.reconnectAttempts = 0;
    this.openVenues.clear();
    this.generation += 1;
    this.connectGeneration(this.generation);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.generation += 1;
    if (this.reconnectTimer !== undefined) {
      this.deps.clearTimeoutFn(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.snapshotInFlight.clear();
    this.openVenues.clear();
    this.closeAllSockets();
  }

  private connectGeneration(generation: number): void {
    if (!this.isCurrent(generation)) return;
    this.onTransportEvent?.({ kind: 'session_started', sessionId: this.runtime.sessionId, generation });

    this.openVenue('bitvavo', PHASE_A_PUBLIC_ENDPOINTS.bitvavoWs, generation);
    if (!this.isCurrent(generation)) return;
    this.openVenue('kraken', PHASE_A_PUBLIC_ENDPOINTS.krakenWs, generation);
    if (!this.isCurrent(generation)) return;
    this.openVenue('binance', PHASE_A_PUBLIC_ENDPOINTS.binanceWs, generation);
  }

  private openVenue(venue: PhaseAPublicVenue, url: string, generation: number): void {
    if (!this.isCurrent(generation)) return;
    let socket: PhaseAWebSocketLike;
    try {
      socket = this.deps.webSocketFactory(url);
    } catch (error) {
      this.invalidateAndReconnect(`${venue} socket creation failed: ${this.errorText(error)}`, generation);
      return;
    }

    this.sockets.set(venue, { venue, socket, generation });

    socket.on('open', () => {
      if (!this.isCurrent(generation)) return;
      this.openVenues.add(venue);
      if (this.openVenues.size === 3) this.reconnectAttempts = 0;
      this.onTransportEvent?.({ kind: 'venue_open', venue, generation });
      try {
        if (venue === 'bitvavo') {
          socket.send(JSON.stringify({
            action: 'subscribe',
            channels: [
              { name: 'ticker', markets: ['BTC-USDC'] },
              { name: 'book', markets: ['BTC-USDC'] },
            ],
          }));
        } else if (venue === 'kraken') {
          socket.send(JSON.stringify({
            method: 'subscribe',
            params: {
              channel: 'ticker',
              symbol: ['BTC/USDC'],
              event_trigger: 'bbo',
              snapshot: true,
            },
          }));
        }
      } catch (error) {
        this.rejectAndRestart(venue, error, generation);
      }
    });

    socket.on('message', (data) => {
      if (!this.isCurrent(generation)) return;
      let stamp: PhaseAReceiveStamp;
      try {
        // Causality is captured before decoding, disk I/O, parsing or runtime work.
        stamp = this.captureStamp();
      } catch (error) {
        this.rejectAndRestart(venue, error, generation);
        return;
      }

      void this.enqueueIngress(venue, generation, async () => {
        const raw = asMessageText(data);
        await this.emitRaw({ source: venue, channel: 'websocket', rawPayload: raw, stamp });
        if (!this.isCurrent(generation)) return;
        const events = venue === 'bitvavo'
          ? this.runtime.ingestBitvavoRaw(raw, stamp)
          : venue === 'kraken'
            ? this.runtime.ingestKrakenRaw(raw, stamp)
            : this.runtime.ingestBinanceRaw(raw, stamp);
        await this.handleRuntimeEvents(events, generation);
      });
    });

    socket.on('error', (error) => {
      if (!this.isCurrent(generation)) return;
      this.invalidateAndReconnect(`${venue} socket error: ${this.errorText(error)}`, generation);
    });

    socket.on('close', () => {
      if (!this.isCurrent(generation)) return;
      this.invalidateAndReconnect(`${venue} socket closed`, generation);
    });

    socket.on('pong', () => {
      // Transport health only; not market evidence.
    });
  }

  private captureStamp(): PhaseAReceiveStamp {
    const mono = this.deps.monotonicNowNs();
    if (mono < 0n) throw new Error('monotonic clock must be non-negative');
    const wall = this.deps.wallNowMs();
    if (!Number.isFinite(wall)) throw new Error('wall clock must be finite');
    return { receivedMonoNs: mono.toString(), receivedAtMs: wall };
  }

  private async emitRaw(event: PhaseAPublicRawMarketData): Promise<void> {
    await this.onRawMarketData?.({
      source: event.source,
      channel: event.channel,
      rawPayload: event.rawPayload,
      stamp: { ...event.stamp },
    });
  }

  private async handleRuntimeEvents(
    events: readonly PhaseAKeylessRuntimeCoreEvent[],
    generation: number,
  ): Promise<void> {
    if (!this.isCurrent(generation)) return;
    for (const event of events) {
      await this.onRuntimeEvent?.(event);
      if (!this.isCurrent(generation)) return;
      if (event.kind === 'bitvavo_snapshot_request') {
        void this.fetchBitvavoSnapshot(event.requestId, generation);
      }
    }
  }

  private async fetchBitvavoSnapshot(requestId: number, generation: number): Promise<void> {
    const inFlightKey = `${generation}:${requestId}`;
    if (!this.isCurrent(generation) || this.snapshotInFlight.has(inFlightKey)) return;
    this.snapshotInFlight.add(inFlightKey);
    try {
      const response = await this.deps.fetchFn(PHASE_A_PUBLIC_ENDPOINTS.bitvavoBookRest, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!this.isCurrent(generation)) return;
      if (!response.ok) throw new Error(`Bitvavo public snapshot HTTP ${response.status}`);
      const rawSnapshot = await response.text();
      if (!this.isCurrent(generation)) return;
      if (!rawSnapshot.trim()) throw new Error('Bitvavo public snapshot body is empty');

      let stamp: PhaseAReceiveStamp;
      try {
        stamp = this.captureStamp();
      } catch (error) {
        this.rejectAndRestart('bitvavo', error, generation);
        return;
      }

      await this.enqueueIngress('bitvavo', generation, async () => {
        await this.emitRaw({ source: 'bitvavo', channel: 'book_snapshot_rest', rawPayload: rawSnapshot, stamp });
        if (!this.isCurrent(generation)) return;
        // Preserve precision-sensitive nanosecond literals until the runtime parser.
        const wrapped = `{"action":"getBook","requestId":${requestId},"response":${rawSnapshot}}`;
        await this.handleRuntimeEvents(this.runtime.ingestBitvavoRaw(wrapped, stamp), generation);
      });
    } catch (error) {
      if (this.isCurrent(generation)) this.rejectAndRestart('bitvavo', error, generation);
    } finally {
      this.snapshotInFlight.delete(inFlightKey);
    }
  }

  /**
   * Serialize all market ingress across venues. A slow durable evidence write
   * delays parsing rather than allowing unaudited state to overtake it.
   */
  private enqueueIngress(
    venue: PhaseAPublicVenue,
    generation: number,
    operation: () => void | Promise<void>,
  ): Promise<void> {
    const scheduled = this.ingressTail.then(async () => {
      if (!this.isCurrent(generation)) return;
      try {
        await operation();
      } catch (error) {
        if (this.isCurrent(generation)) this.rejectAndRestart(venue, error, generation);
      }
    });
    // Keep the queue reusable even if an unexpected implementation error leaks.
    this.ingressTail = scheduled.catch(() => undefined);
    return scheduled;
  }

  private rejectAndRestart(venue: PhaseAPublicVenue, error: unknown, generation: number): void {
    const reason = this.errorText(error);
    this.onTransportEvent?.({ kind: 'message_rejected', venue, reason, generation });
    this.invalidateAndReconnect(`${venue} rejected market data: ${reason}`, generation);
  }

  private invalidateAndReconnect(reason: string, failedGeneration: number): void {
    if (!this.running || failedGeneration !== this.generation) return;

    this.generation += 1;
    const nextGeneration = this.generation;
    this.snapshotInFlight.clear();
    this.openVenues.clear();
    this.closeAllSockets();

    this.runtime.resetSession(this.freshSessionId());
    this.onTransportEvent?.({ kind: 'session_invalidated', reason, generation: nextGeneration });

    const exponent = Math.min(this.reconnectAttempts, 20);
    const delayMs = Math.min(this.reconnectBaseMs * (2 ** exponent), this.reconnectMaxMs);
    this.reconnectAttempts += 1;
    this.onTransportEvent?.({ kind: 'reconnect_scheduled', delayMs, generation: nextGeneration });

    if (this.reconnectTimer !== undefined) this.deps.clearTimeoutFn(this.reconnectTimer);
    this.reconnectTimer = this.deps.setTimeoutFn(() => {
      this.reconnectTimer = undefined;
      if (!this.isCurrent(nextGeneration)) return;
      this.connectGeneration(nextGeneration);
    }, delayMs);
  }

  private freshSessionId(): string {
    const nextSessionId = this.deps.makeSessionId().trim();
    if (!nextSessionId || nextSessionId === this.runtime.sessionId) {
      throw new Error('session id factory must return a fresh non-empty id');
    }
    return nextSessionId;
  }

  private closeAllSockets(): void {
    const slots = [...this.sockets.values()];
    this.sockets.clear();
    for (const { socket } of slots) {
      try {
        socket.close(1000, 'Phase-A session reset');
      } catch {
        // Best-effort teardown only; state was invalidated before close.
      }
    }
  }

  private isCurrent(generation: number): boolean {
    return this.running && generation === this.generation;
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
