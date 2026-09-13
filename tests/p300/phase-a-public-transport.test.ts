import assert from 'node:assert/strict';
import test from 'node:test';
import { PhaseAKeylessRuntimeCore } from '../../src/p300/phase-a-keyless-runtime-core';
import {
  PHASE_A_PUBLIC_ENDPOINTS,
  PhaseAPublicMarketTransport,
  type PhaseAHttpResponseLike,
  type PhaseAPublicTransportEvent,
  type PhaseAWebSocketLike,
} from '../../src/p300/phase-a-public-transport';

class FakeSocket implements PhaseAWebSocketLike {
  readyState = 1;
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: unknown) => void): this;
  on(event: 'close', listener: () => void): this;
  on(event: 'error', listener: (error: unknown) => void): this;
  on(event: 'pong', listener: () => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit('close');
  }

  ping(): void {}

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

function runtime(): PhaseAKeylessRuntimeCore {
  return new PhaseAKeylessRuntimeCore({
    sessionId: 'transport-session-1',
    maxBufferedBookUpdates: 20,
    collector: {
      maxHistoryPerStream: 50,
      maxReferenceAgeMs: 1_000,
      maxReferenceReceiveSkewMs: 500,
      maxReferenceDispersionBps: 100,
    },
  });
}

function snapshotBody(timestampLiteral = '1752139200123456789'): string {
  return `{"market":"BTC-USDC","nonce":11,"bids":[["98","1.5"]],"asks":[["99","2"]],"timestamp":${timestampLiteral}}`;
}

function firstBitvavoBookUpdate(): string {
  return '{"event":"book","market":"BTC-USDC","nonce":10,"bids":[],"asks":[],"timestamp":1752139200123456700}';
}

function buildHarness(snapshot = snapshotBody()) {
  const sockets = new Map<string, FakeSocket>();
  const transportEvents: PhaseAPublicTransportEvent[] = [];
  const runtimeEvents: string[] = [];
  const timers: Array<{ callback: () => void; delayMs: number }> = [];
  const sessionIds = ['transport-session-2', 'transport-session-3', 'transport-session-4'];
  let mono = 1_000_000_000n;
  let wall = 1_000;
  let stampCalls = 0;
  let fetchCalls = 0;
  const core = runtime();

  const transport = new PhaseAPublicMarketTransport({
    runtime: core,
    reconnectBaseMs: 10,
    reconnectMaxMs: 100,
    dependencies: {
      webSocketFactory: (url) => {
        const socket = new FakeSocket();
        sockets.set(url, socket);
        return socket;
      },
      fetchFn: async (): Promise<PhaseAHttpResponseLike> => {
        fetchCalls += 1;
        return { ok: true, status: 200, text: async () => snapshot };
      },
      monotonicNowNs: () => {
        stampCalls += 1;
        mono += 1_000_000n;
        return mono;
      },
      wallNowMs: () => ++wall,
      makeSessionId: () => sessionIds.shift() ?? `transport-session-extra-${wall}`,
      setTimeoutFn: (callback, delayMs) => {
        timers.push({ callback, delayMs });
        return ({ fake: timers.length } as unknown) as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {},
    },
    onRuntimeEvent: (event) => runtimeEvents.push(event.kind),
    onTransportEvent: (event) => transportEvents.push(event),
  });

  return {
    core,
    transport,
    sockets,
    timers,
    transportEvents,
    runtimeEvents,
    get stampCalls() { return stampCalls; },
    get fetchCalls() { return fetchCalls; },
  };
}

function openAll(harness: ReturnType<typeof buildHarness>): void {
  harness.sockets.get(PHASE_A_PUBLIC_ENDPOINTS.bitvavoWs)?.emit('open');
  harness.sockets.get(PHASE_A_PUBLIC_ENDPOINTS.krakenWs)?.emit('open');
  harness.sockets.get(PHASE_A_PUBLIC_ENDPOINTS.binanceWs)?.emit('open');
}

async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test('uses only public endpoints and waits for live Bitvavo book overlap before snapshot', async () => {
  const h = buildHarness();
  h.transport.start();
  assert.deepEqual([...h.sockets.keys()].sort(), [
    PHASE_A_PUBLIC_ENDPOINTS.binanceWs,
    PHASE_A_PUBLIC_ENDPOINTS.bitvavoWs,
    PHASE_A_PUBLIC_ENDPOINTS.krakenWs,
  ].sort());

  openAll(h);
  const bitvavo = h.sockets.get(PHASE_A_PUBLIC_ENDPOINTS.bitvavoWs);
  const kraken = h.sockets.get(PHASE_A_PUBLIC_ENDPOINTS.krakenWs);
  assert.ok(bitvavo);
  assert.ok(kraken);

  const bitvavoSubscribe = JSON.parse(bitvavo.sent[0]) as { action: string; channels: Array<{ name: string; markets: string[] }> };
  assert.equal(bitvavoSubscribe.action, 'subscribe');
  assert.deepEqual(bitvavoSubscribe.channels, [
    { name: 'ticker', markets: ['BTC-USDC'] },
    { name: 'book', markets: ['BTC-USDC'] },
  ]);

  const krakenSubscribe = JSON.parse(kraken.sent[0]) as { method: string; params: Record<string, unknown> };
  assert.equal(krakenSubscribe.method, 'subscribe');
  assert.deepEqual(krakenSubscribe.params.symbol, ['BTC/USDC']);
  assert.equal(krakenSubscribe.params.channel, 'ticker');
  assert.equal(krakenSubscribe.params.event_trigger, 'bbo');

  const serialized = JSON.stringify({ endpoints: PHASE_A_PUBLIC_ENDPOINTS, bitvavoSubscribe, krakenSubscribe });
  assert.doesNotMatch(serialized, /api[_-]?key|secret|signature|listenKey/i);

  await flushAsync();
  assert.equal(h.fetchCalls, 0, 'opening/subscribing alone must not mark a REST snapshot as overlapped');
  assert.equal(h.core.bitvavoSynchronized, false);

  bitvavo.emit('message', firstBitvavoBookUpdate());
  await flushAsync();
  assert.equal(h.fetchCalls, 1);
  assert.ok(h.runtimeEvents.includes('bitvavo_book_synchronized'));
  h.transport.stop();
});

test('captures the monotonic receive stamp before decoding a websocket message', () => {
  const h = buildHarness();
  h.transport.start();
  const binance = h.sockets.get(PHASE_A_PUBLIC_ENDPOINTS.binanceWs);
  assert.ok(binance);

  const before = h.stampCalls;
  const message = {
    toString() {
      assert.ok(h.stampCalls > before, 'message decoding occurred before monotonic stamping');
      return JSON.stringify({ u: 1, s: 'BTCUSDC', b: '99.9', B: '1', a: '100.1', A: '1' });
    },
  };
  binance.emit('message', message);
  assert.ok(h.runtimeEvents.includes('reference'));
  h.transport.stop();
});

test('any venue close resets the full causal session and stale socket callbacks become inert', () => {
  const h = buildHarness();
  h.transport.start();
  const oldBinance = h.sockets.get(PHASE_A_PUBLIC_ENDPOINTS.binanceWs);
  const oldKraken = h.sockets.get(PHASE_A_PUBLIC_ENDPOINTS.krakenWs);
  assert.ok(oldBinance);
  assert.ok(oldKraken);
  const initialGeneration = h.transport.currentGeneration;

  oldKraken.emit('close');
  assert.equal(h.core.sessionId, 'transport-session-2');
  assert.equal(h.transport.currentGeneration, initialGeneration + 1);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].delayMs, 10);

  const eventCount = h.transportEvents.length;
  oldBinance.emit('message', '{ definitely-not-json');
  oldKraken.emit('close');
  assert.equal(h.core.sessionId, 'transport-session-2');
  assert.equal(h.timers.length, 1);
  assert.equal(h.transportEvents.length, eventCount);
  h.transport.stop();
});

test('malformed public data fails closed and schedules a fresh causal session', () => {
  const h = buildHarness();
  h.transport.start();
  const binance = h.sockets.get(PHASE_A_PUBLIC_ENDPOINTS.binanceWs);
  assert.ok(binance);

  binance.emit('message', '{bad-json');
  assert.equal(h.core.sessionId, 'transport-session-2');
  assert.equal(h.timers.length, 1);
  assert.ok(h.transportEvents.some((event) => event.kind === 'message_rejected' && event.venue === 'binance'));
  assert.ok(h.transportEvents.some((event) => event.kind === 'session_invalidated'));
  h.transport.stop();
});

test('Bitvavo snapshot keeps an unsafe nanosecond integer raw until precision-preserving parsing', async () => {
  const unsafeTimestamp = '1752139200123456789';
  assert.ok(BigInt(unsafeTimestamp) > BigInt(Number.MAX_SAFE_INTEGER));
  const h = buildHarness(snapshotBody(unsafeTimestamp));
  h.transport.start();
  const bitvavo = h.sockets.get(PHASE_A_PUBLIC_ENDPOINTS.bitvavoWs);
  assert.ok(bitvavo);
  bitvavo.emit('open');
  await flushAsync();
  assert.equal(h.fetchCalls, 0);

  bitvavo.emit('message', firstBitvavoBookUpdate());
  await flushAsync();
  assert.equal(h.fetchCalls, 1);
  assert.equal(h.core.bitvavoSynchronized, true);
  assert.ok(h.runtimeEvents.includes('bitvavo_book_synchronized'));
  h.transport.stop();
});

test('a reconnect callback starts all feeds in the new generation only', () => {
  const h = buildHarness();
  h.transport.start();
  const oldBitvavo = h.sockets.get(PHASE_A_PUBLIC_ENDPOINTS.bitvavoWs);
  assert.ok(oldBitvavo);
  oldBitvavo.emit('error', new Error('network fault'));
  assert.equal(h.timers.length, 1);
  const newGeneration = h.transport.currentGeneration;

  h.timers[0].callback();
  assert.equal(h.transport.currentGeneration, newGeneration);
  assert.equal(h.sockets.size, 3);
  assert.ok(h.transportEvents.some((event) => event.kind === 'session_started' && event.generation === newGeneration));
  h.transport.stop();
});
